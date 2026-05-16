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
 * Mock Tripay provider.
 *
 * Untuk integrasi real:
 *  - Endpoint: `${config.tripay.baseUrl}/transaction/create`
 *  - Auth: Bearer token (apiKey)
 *  - Signature payload: HMAC-SHA256(privateKey, merchantCode + merchant_ref + amount)
 *  - Webhook signature: HMAC-SHA256(privateKey, rawBody) di header `X-Callback-Signature`
 *  - Docs: https://tripay.co.id/developer?tab=overview
 */
export class TripayProvider implements PaymentProvider {
  readonly name = "tripay" as const;

  async isHealthy(): Promise<boolean> {
    if (settingsStore.tripayForceDown) return false;
    return true;
  }

  async charge(req: ChargeRequest): Promise<ChargeResult> {
    if (settingsStore.tripayForceDown) {
      throw new ProviderError(
        this.name,
        "Tripay is currently down (forced)",
        true,
      );
    }

    await simulateLatency(60, 170);
    if (Math.random() < 0.05) {
      throw new ProviderError(this.name, "Random network error", true);
    }

    const reference = `T${Date.now()}${uuidv4().slice(0, 8).toUpperCase()}`;
    const channelCode = methodToTripayChannel(req.method);
    logger.debug(
      { provider: this.name, reference, orderId: req.orderId },
      "charged",
    );

    return {
      providerName: this.name,
      providerTransactionId: reference,
      status: "pending",
      amount: req.amount,
      currency: req.currency,
      paymentUrl: `https://tripay.co.id/checkout/${reference}`,
      rawResponse: {
        reference,
        merchant_ref: req.orderId,
        payment_method: channelCode,
        amount: req.amount,
        status: "UNPAID",
        expired_time: Math.floor(Date.now() / 1000) + 24 * 3600,
      },
    };
  }

  async getStatus(_providerTransactionId: string): Promise<PaymentStatus> {
    return "pending";
  }

  /**
   * Tripay webhook signature: HMAC-SHA256(privateKey, rawBody)
   * di header `X-Callback-Signature`.
   */
  verifyWebhook(
    rawBody: Buffer,
    headers: Record<string, string | undefined>,
  ): boolean {
    const privateKey = settingsStore.getCredential("tripay", "privateKey");
    if (!privateKey) {
      if (config.nodeEnv === "production") {
        logger.error(
          { provider: this.name },
          "TRIPAY privateKey kosong di production — webhook ditolak",
        );
        return false;
      }
      logger.warn(
        { provider: this.name },
        "TRIPAY privateKey tidak diset, signature verification dilewati (dev only)",
      );
      return true;
    }

    const received = headers["x-callback-signature"];
    if (!received) return false;

    const expected = createHmac("sha256", privateKey)
      .update(new Uint8Array(rawBody))
      .digest("hex");


    const a = new Uint8Array(Buffer.from(received));
    const b = new Uint8Array(Buffer.from(expected));
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  /**
   * Map status Tripay → status internal.
   * Tripay values: UNPAID, PAID, EXPIRED, FAILED, REFUND
   */
  parseWebhook(payload: Record<string, unknown>): WebhookEvent {
    const raw = String(payload.status ?? "").toUpperCase();
    let status: PaymentStatus = "pending";
    if (raw === "PAID") status = "success";
    else if (raw === "UNPAID") status = "pending";
    else if (raw === "FAILED") status = "failed";
    else if (raw === "EXPIRED") status = "expired";
    else if (raw === "REFUND") status = "refunded";

    return {
      orderId: String(payload.merchant_ref ?? ""),
      providerTransactionId: String(payload.reference ?? ""),
      status,
      rawPayload: payload,
    };
  }
}

function methodToTripayChannel(
  method: ChargeRequest["method"],
): string {
  switch (method) {
    case "qris":
      return "QRIS";
    case "ewallet":
      return "OVO";
    case "credit_card":
      return "CREDIT_CARD";
    case "bank_transfer":
    default:
      return "BRIVA";
  }
}

function simulateLatency(min: number, max: number): Promise<void> {
  const ms = min + Math.random() * (max - min);
  return new Promise((r) => setTimeout(r, ms));
}
