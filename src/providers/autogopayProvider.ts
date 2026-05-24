import {
  ChargeRequest,
  ChargeResult,
  PaymentProvider,
  PaymentStatus,
  ProviderError,
  WebhookEvent,
} from "../types";
import { config } from "../config";
import { settingsStore } from "../store/settingsStore";
import { logger } from "../utils/logger";
import { createHmac, timingSafeEqual } from "crypto";

/**
 * AutoGoPay provider — wrapper untuk v1-gateway.autogopay.site QRIS.
 *
 * Karakteristik:
 *  - Auth via Bearer token (API Key) di header Authorization
 *  - Support QRIS dynamic only
 *  - Webhook dengan HMAC-SHA256 signature verification (header X-Signature)
 *  - Real-time status check via POST /qris/status
 *  - Order ID auto-generated oleh AutoGoPay dengan format "AutoGopay-{timestamp}-{random}"
 *
 * Reference: https://v1-gateway.autogopay.site/docs
 */
export class AutogopayProvider implements PaymentProvider {
  readonly name = "autogopay" as const;

  async isHealthy(): Promise<boolean> {
    if (settingsStore.isForceDown("autogopay")) return false;

    const apiKey = settingsStore.getCredential("autogopay", "apiKey");
    if (!apiKey) return false;

    // Cache hasil probe selama 30 detik untuk menghindari spam health check
    const now = Date.now();
    if (
      AutogopayProvider._healthCache &&
      now - AutogopayProvider._healthCache.at < 30_000
    ) {
      return AutogopayProvider._healthCache.healthy;
    }

    let healthy = false;
    try {
      const baseUrl =
        settingsStore.getCredential("autogopay", "baseUrl") ||
        config.autogopay.baseUrl;

      // Probe dengan endpoint /transactions (list transaksi)
      const resp = await fetch(`${baseUrl}/transactions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(10_000),
      });

      // Sukses berarti API key valid & service reachable
      healthy = resp.ok;
    } catch {
      healthy = false;
    }

    AutogopayProvider._healthCache = { healthy, at: now };
    return healthy;
  }

  /** Cache hasil health probe (in-memory, per-instance). */
  private static _healthCache: { healthy: boolean; at: number } | null = null;

  async charge(req: ChargeRequest): Promise<ChargeResult> {
    if (settingsStore.isForceDown("autogopay")) {
      throw new ProviderError(
        this.name,
        "AutoGoPay is currently down (forced)",
        true,
      );
    }

    if (req.method !== "qris") {
      throw new ProviderError(
        this.name,
        "AutoGoPay hanya support method 'qris'",
        false,
      );
    }

    const apiKey = settingsStore.getCredential("autogopay", "apiKey");
    if (!apiKey) {
      throw new ProviderError(
        this.name,
        "AutoGoPay API key belum diset",
        false,
      );
    }

    const baseUrl =
      settingsStore.getCredential("autogopay", "baseUrl") ||
      config.autogopay.baseUrl;

    // Validasi amount range (1 - 10.000.000 IDR sesuai docs)
    if (req.amount < 1 || req.amount > 10_000_000) {
      throw new ProviderError(
        this.name,
        "AutoGoPay amount harus antara 1 - 10.000.000 IDR",
        false,
      );
    }

    let resp: Response;
    try {
      resp = await fetch(`${baseUrl}/qris/generate`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ amount: req.amount }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      throw new ProviderError(
        this.name,
        `Network error to AutoGoPay: ${(err as Error).message}`,
        true,
      );
    }

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new ProviderError(
        this.name,
        `AutoGoPay HTTP ${resp.status}: ${text}`,
        resp.status >= 500,
      );
    }

    const json = (await resp.json()) as Record<string, any>;

    if (!json.success) {
      const msg = json.message || JSON.stringify(json);
      throw new ProviderError(
        this.name,
        `AutoGoPay generate QRIS failed: ${msg}`,
        false,
      );
    }

    const data = json.data;
    if (!data || !data.transaction_id) {
      throw new ProviderError(
        this.name,
        "AutoGoPay tidak return transaction_id",
        true,
      );
    }

    logger.debug(
      {
        provider: this.name,
        transactionId: data.transaction_id,
        orderId: req.orderId,
      },
      "charged",
    );

    return {
      providerName: this.name,
      providerTransactionId: data.transaction_id,
      status: this.mapStatus(data.transaction_status),
      amount: data.amount || req.amount,
      currency: req.currency,
      // qr_url adalah URL gambar QR yang bisa langsung di-render
      paymentUrl: data.qr_url,
      rawResponse: {
        transaction_id: data.transaction_id,
        order_id: data.order_id, // AutoGoPay auto-generated order ID
        amount: data.amount,
        transaction_status: data.transaction_status,
        qr_string: data.qr_string,
        qr_url: data.qr_url,
        transaction_time: data.transaction_time,
        expiry_time: data.expiry_time,
        full: data,
      },
    };
  }

  async getStatus(providerTransactionId: string): Promise<PaymentStatus> {
    const apiKey = settingsStore.getCredential("autogopay", "apiKey");
    if (!apiKey) {
      throw new ProviderError(
        this.name,
        "AutoGoPay API key belum diset",
        false,
      );
    }

    const baseUrl =
      settingsStore.getCredential("autogopay", "baseUrl") ||
      config.autogopay.baseUrl;

    let resp: Response;
    try {
      resp = await fetch(`${baseUrl}/qris/status`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ transaction_id: providerTransactionId }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      throw new ProviderError(
        this.name,
        `Network error checking status: ${(err as Error).message}`,
        true,
      );
    }

    if (!resp.ok) {
      throw new ProviderError(
        this.name,
        `AutoGoPay status check HTTP ${resp.status}`,
        resp.status >= 500,
      );
    }

    const json = (await resp.json()) as Record<string, any>;

    if (!json.success || !json.data) {
      throw new ProviderError(
        this.name,
        `AutoGoPay status check failed: ${json.message || "unknown"}`,
        false,
      );
    }

    return this.mapStatus(
      json.data.transaction_status ||
        json.data.status ||
        json.data.transaction?.transaction_status ||
        json.data.transaction?.status,
    );
  }

  /**
   * Verify webhook signature menggunakan HMAC-SHA256.
   * Signature di header X-Signature, computed dari raw body dengan API key sebagai secret.
   */
  verifyWebhook(
    rawBody: Buffer,
    headers: Record<string, string | undefined>,
  ): boolean {
    const signatureHeader =
      headers["x-signature"] ||
      headers["x-autogopay-signature"] ||
      headers["x-callback-signature"] ||
      headers["signature"] ||
      "";

    if (!signatureHeader) {
      logger.warn(
        {
          provider: this.name,
          headerKeys: Object.keys(headers).filter((h) => h.includes("sign")),
        },
        "Webhook missing signature header",
      );
      return false;
    }

    const apiKey = settingsStore.getCredential("autogopay", "apiKey");
    if (!apiKey) {
      logger.warn(
        { provider: this.name },
        "Cannot verify webhook: AutoGoPay API key not configured",
      );
      return false;
    }

    // AutoGoPay docs mention HMAC-SHA256 using API key. Support common encodings:
    // - raw hex digest
    // - sha256=<hex>
    // - base64 digest
    const provided = signatureHeader.trim().replace(/^sha256=/i, "");
    const expectedHex = createHmac("sha256", apiKey)
      .update(rawBody)
      .digest("hex");
    const expectedBase64 = createHmac("sha256", apiKey)
      .update(rawBody)
      .digest("base64");

    const matches = (a: string, b: string): boolean => {
      const ab = Buffer.from(a, "utf8");
      const bb = Buffer.from(b, "utf8");
      if (ab.length !== bb.length) return false;
      return timingSafeEqual(ab, bb);
    };

    const ok = matches(provided, expectedHex) || matches(provided, expectedBase64);
    if (!ok) {
      logger.warn(
        {
          provider: this.name,
          signatureLength: provided.length,
          hasKnownSignatureHeader: Boolean(signatureHeader),
        },
        "Webhook signature mismatch",
      );
    }
    return ok;
  }

  parseWebhook(payload: Record<string, unknown>): WebhookEvent {
    // AutoGoPay webhook bisa punya berbagai format:
    // 1. { event: "...", transaction: { id, status, ... } }
    // 2. { transaction_id, transaction_status, ... } (flat)
    // 3. Test payload dari dashboard (bisa berbeda)

    let transaction = payload.transaction as Record<string, any> | undefined;

    // AutoGoPay webhook production format:
    // { event: "transaction.received", transaction: { transaction_id, order_id, status: "PAID", ... } }
    // Normalisasi ke bentuk internal { id, status, order_id }.
    if (transaction) {
      transaction = {
        ...transaction,
        id: transaction.id || transaction.transaction_id,
        status: transaction.status || transaction.transaction_status,
      };
    }

    // Fallback: cek apakah payload sendiri adalah transaction (flat format)
    if (!transaction || !transaction.id) {
      const txId = payload.transaction_id || payload.id;
      const txStatus = payload.transaction_status || payload.status;

      if (txId) {
        transaction = {
          id: txId,
          status: txStatus || "pending",
          order_id: payload.order_id || txId,
        };
      }
    }

    if (!transaction || !transaction.id) {
      logger.warn(
        { provider: this.name, payload },
        "Webhook payload format tidak dikenali",
      );
      throw new ProviderError(
        this.name,
        "AutoGoPay webhook payload format tidak dikenali",
        false,
      );
    }

    // AutoGoPay webhook event: "transaction.received"
    // Status bisa: pending, PAID, settlement, expire, cancel
    const status = this.mapStatus(String(transaction.status || "pending"));

    // AutoGoPay tidak mengirim orderId merchant di webhook (order_id adalah
    // auto-generated oleh AutoGoPay). Lookup utama tetap by providerTransactionId.
    const orderId = String(transaction.order_id || transaction.id);

    return {
      orderId,
      providerTransactionId: String(transaction.id),
      status,
      rawPayload: payload,
    };
  }

  /**
   * Map status AutoGoPay ke PaymentStatus gateway.
   * AutoGoPay status: pending, settlement, expire, cancel
   */
  private mapStatus(status: string): PaymentStatus {
    const normalized = (status || "").toLowerCase();
    switch (normalized) {
      case "paid":
      case "settlement":
      case "success":
        return "success";
      case "pending":
        return "pending";
      case "expire":
      case "expired":
        return "expired";
      case "cancel":
      case "cancelled":
      case "failed":
        return "failed";
      default:
        logger.warn(
          { provider: this.name, status },
          "Unknown status from AutoGoPay, defaulting to pending",
        );
        return "pending";
    }
  }
}
