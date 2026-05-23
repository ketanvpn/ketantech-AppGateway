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

    return this.mapStatus(json.data.transaction_status);
  }

  /**
   * Verify webhook signature menggunakan HMAC-SHA256.
   * Signature di header X-Signature, computed dari raw body dengan API key sebagai secret.
   */
  verifyWebhook(
    rawBody: Buffer,
    headers: Record<string, string | undefined>,
  ): boolean {
    const signature = headers["x-signature"];
    if (!signature) {
      logger.warn(
        { provider: this.name },
        "Webhook missing X-Signature header",
      );
      return false;
    }

    const apiKey = settingsStore.getCredential("autogopay", "apiKey");
    if (!apiKey) {
      logger.warn(
        { provider: this.name },
        "Cannot verify webhook: API key not configured",
      );
      // Di production strict mode, reject webhook kalau key kosong
      if (config.nodeEnv === "production") return false;
      // Di dev, allow (untuk testing manual)
      return true;
    }

    // Compute expected signature: HMAC-SHA256(rawBody, apiKey)
    const expected = createHmac("sha256", apiKey)
      .update(rawBody)
      .digest("hex");

    // Timing-safe comparison untuk mencegah timing attack
    try {
      return timingSafeEqual(
        Buffer.from(signature, "hex"),
        Buffer.from(expected, "hex"),
      );
    } catch {
      // Length mismatch atau format invalid
      logger.warn(
        { provider: this.name, signatureLength: signature.length },
        "Webhook signature format invalid",
      );
      return false;
    }
  }

  parseWebhook(payload: Record<string, unknown>): WebhookEvent {
    const event = payload.event as string;
    const transaction = payload.transaction as Record<string, any>;

    if (!transaction || !transaction.id) {
      throw new ProviderError(
        this.name,
        "Webhook payload missing transaction data",
        false,
      );
    }

    // AutoGoPay webhook event: "transaction.received"
    // Status bisa: pending, settlement, expire, cancel
    const status = this.mapStatus(transaction.status);

    // AutoGoPay tidak mengirim orderId merchant di webhook (karena order_id
    // adalah auto-generated oleh mereka). Kita perlu lookup dari DB by
    // providerTransactionId untuk dapat orderId asli.
    // Untuk sementara, gunakan transaction.id sebagai fallback.
    const orderId = (transaction.order_id as string) || transaction.id;

    return {
      orderId,
      providerTransactionId: transaction.id,
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
      case "settlement":
        return "success";
      case "pending":
        return "pending";
      case "expire":
        return "expired";
      case "cancel":
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
