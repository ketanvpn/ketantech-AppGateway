import { v4 as uuidv4 } from "uuid";
import { timingSafeEqual } from "crypto";
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
 * Mock Xendit provider.
 *
 * Untuk integrasi real:
 *  - Endpoint: `${config.xendit.baseUrl}/v2/invoices` atau /ewallets/charges
 *  - Auth: Basic base64(secretKey + ":")
 */
export class XenditProvider implements PaymentProvider {
  readonly name = "xendit" as const;

  async isHealthy(): Promise<boolean> {
    if (settingsStore.xenditForceDown) return false;
    return true;
  }

  async charge(req: ChargeRequest): Promise<ChargeResult> {
    if (settingsStore.xenditForceDown) {
      throw new ProviderError(
        this.name,
        "Xendit is currently down (forced)",
        true,
      );
    }

    await simulateLatency(80, 200);

    if (Math.random() < 0.05) {
      throw new ProviderError(this.name, "Random network error", true);
    }

    const txId = `XND-${uuidv4()}`;
    logger.debug({ provider: this.name, txId, orderId: req.orderId }, "charged");

    return {
      providerName: this.name,
      providerTransactionId: txId,
      status: "pending",
      amount: req.amount,
      currency: req.currency,
      paymentUrl: `https://checkout.xendit.co/web/${txId}`,
      rawResponse: {
        id: txId,
        external_id: req.orderId,
        amount: req.amount,
        status: "PENDING",
        payment_method: req.method,
      },
    };
  }

  async getStatus(_providerTransactionId: string): Promise<PaymentStatus> {
    return "pending";
  }

  /**
   * Xendit signature: header `x-callback-token` harus match callback token.
   * https://developers.xendit.co/api-reference/#callbacks
   */
  verifyWebhook(
    _rawBody: Buffer,
    headers: Record<string, string | undefined>,
  ): boolean {
    const expected = settingsStore.getCredential("xendit", "callbackToken");
    if (!expected) {
      if (config.nodeEnv === "production") {
        logger.error(
          { provider: this.name },
          "XENDIT callbackToken kosong di production — webhook ditolak",
        );
        return false;
      }
      logger.warn(
        { provider: this.name },
        "XENDIT callbackToken tidak diset, signature verification dilewati (dev only)",
      );
      return true;
    }


    const received = headers["x-callback-token"];
    if (!received) return false;

    // Pakai timingSafeEqual untuk cegah timing attack
    const a = new Uint8Array(Buffer.from(received));
    const b = new Uint8Array(Buffer.from(expected));
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  /**
   * Map status Xendit → status internal.
   * Xendit values (invoice): PENDING, PAID, SETTLED, EXPIRED
   * Xendit values (ewallet): PENDING, SUCCEEDED, FAILED, VOIDED, REFUNDED
   */
  parseWebhook(payload: Record<string, unknown>): WebhookEvent {
    const raw = String(payload.status ?? "").toUpperCase();
    let status: PaymentStatus = "pending";

    if (raw === "PAID" || raw === "SETTLED" || raw === "SUCCEEDED") {
      status = "success";
    } else if (raw === "PENDING") {
      status = "pending";
    } else if (raw === "FAILED" || raw === "VOIDED") {
      status = "failed";
    } else if (raw === "EXPIRED") {
      status = "expired";
    } else if (raw === "REFUNDED") {
      status = "refunded";
    }

    return {
      orderId: String(payload.external_id ?? ""),
      providerTransactionId: String(payload.id ?? ""),
      status,
      rawPayload: payload,
    };
  }
}

function simulateLatency(min: number, max: number): Promise<void> {
  const ms = min + Math.random() * (max - min);
  return new Promise((r) => setTimeout(r, ms));
}
