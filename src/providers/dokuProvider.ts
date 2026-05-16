import { v4 as uuidv4 } from "uuid";
import { createHmac, timingSafeEqual } from "crypto";
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

/**
 * Mock DOKU provider.
 *
 * Untuk integrasi real:
 *  - Endpoint: `${config.doku.baseUrl}/checkout/v1/payment`
 *  - Auth: Client-Id header + signature HMAC-SHA256 di header Signature
 *  - Webhook: signature dari header `Signature` (HMAC-SHA256 atas raw body + secret)
 *  - Docs: https://docs.doku.com/accept-payment/getting-started
 */
export class DokuProvider implements PaymentProvider {
  readonly name = "doku" as const;

  async isHealthy(): Promise<boolean> {
    if (settingsStore.dokuForceDown) return false;
    return true;
  }

  async charge(req: ChargeRequest): Promise<ChargeResult> {
    if (settingsStore.dokuForceDown) {
      throw new ProviderError(
        this.name,
        "DOKU is currently down (forced)",
        true,
      );
    }

    await simulateLatency(70, 180);
    if (Math.random() < 0.05) {
      throw new ProviderError(this.name, "Random network error", true);
    }

    const txId = `DOKU-${uuidv4()}`;
    logger.debug({ provider: this.name, txId, orderId: req.orderId }, "charged");

    return {
      providerName: this.name,
      providerTransactionId: txId,
      status: "pending",
      amount: req.amount,
      currency: req.currency,
      paymentUrl: `https://app-sandbox.doku.com/checkout/${txId}`,
      rawResponse: {
        order: { invoice_number: req.orderId, amount: req.amount },
        payment: { token_id: txId, expired_date: expiresIn(60) },
        method: req.method,
      },
    };
  }

  async getStatus(_providerTransactionId: string): Promise<PaymentStatus> {
    return "pending";
  }

  /**
   * DOKU webhook signature: HMAC-SHA256 atas raw body, dikirim di header `Signature`.
   * Format real DOKU sebenarnya lebih kompleks (canonicalized request),
   * di sini kita pakai versi sederhana: HMAC(secretKey, rawBody).
   */
  verifyWebhook(
    rawBody: Buffer,
    headers: Record<string, string | undefined>,
  ): boolean {
    const secretKey = settingsStore.getCredential("doku", "secretKey");
    if (!secretKey) {
      if (config.nodeEnv === "production") {
        logger.error(
          { provider: this.name },
          "DOKU secretKey kosong di production — webhook ditolak",
        );
        return false;
      }
      logger.warn(
        { provider: this.name },
        "DOKU secretKey tidak diset, signature verification dilewati (dev only)",
      );
      return true;
    }

    const received = headers["signature"];
    if (!received) return false;

    const expected = createHmac("sha256", secretKey)
      .update(new Uint8Array(rawBody))
      .digest("hex");


    const a = new Uint8Array(Buffer.from(received));
    const b = new Uint8Array(Buffer.from(expected));
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  /**
   * Map status DOKU → status internal.
   * DOKU values: SUCCESS, PENDING, FAILED, EXPIRED, REFUND
   */
  parseWebhook(payload: Record<string, unknown>): WebhookEvent {
    const transactionStatus = String(
      (payload as any)?.transaction?.status ?? payload.status ?? "",
    ).toUpperCase();
    const orderId = String(
      (payload as any)?.order?.invoice_number ??
        (payload as any)?.invoice_number ??
        "",
    );
    const txId = String(
      (payload as any)?.payment?.token_id ??
        (payload as any)?.transaction?.id ??
        "",
    );

    let status: PaymentStatus = "pending";
    if (transactionStatus === "SUCCESS") status = "success";
    else if (transactionStatus === "PENDING") status = "pending";
    else if (transactionStatus === "FAILED") status = "failed";
    else if (transactionStatus === "EXPIRED") status = "expired";
    else if (transactionStatus === "REFUND") status = "refunded";

    return {
      orderId,
      providerTransactionId: txId,
      status,
      rawPayload: payload,
    };
  }
}

function simulateLatency(min: number, max: number): Promise<void> {
  const ms = min + Math.random() * (max - min);
  return new Promise((r) => setTimeout(r, ms));
}

function expiresIn(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}
