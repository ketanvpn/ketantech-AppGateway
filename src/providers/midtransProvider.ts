import { v4 as uuidv4 } from "uuid";
import { createHash } from "crypto";
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
 * Mock Midtrans provider.
 *
 * Untuk integrasi real:
 *  - Ganti `simulateLatency` & body random dengan call ke axios/fetch
 *    ke `${config.midtrans.baseUrl}/v2/charge`
 *  - Auth: Basic base64(serverKey + ":")
 */
export class MidtransProvider implements PaymentProvider {
  readonly name = "midtrans" as const;

  async isHealthy(): Promise<boolean> {
    if (settingsStore.midtransForceDown) return false;
    return true;
  }

  async charge(req: ChargeRequest): Promise<ChargeResult> {
    if (settingsStore.midtransForceDown) {
      throw new ProviderError(
        this.name,
        "Midtrans is currently down (forced)",
        true,
      );
    }

    await simulateLatency(50, 150);

    // Simulasi 5% gagal acak (network glitch)
    if (Math.random() < 0.05) {
      throw new ProviderError(this.name, "Random network error", true);
    }

    const txId = `MTRN-${uuidv4()}`;
    logger.debug({ provider: this.name, txId, orderId: req.orderId }, "charged");

    return {
      providerName: this.name,
      providerTransactionId: txId,
      status: "pending",
      amount: req.amount,
      currency: req.currency,
      paymentUrl: `https://app.sandbox.midtrans.com/snap/${txId}`,
      rawResponse: {
        transaction_id: txId,
        order_id: req.orderId,
        gross_amount: String(req.amount),
        payment_type: req.method,
        transaction_status: "pending",
      },
    };
  }

  async getStatus(_providerTransactionId: string): Promise<PaymentStatus> {
    return "pending";
  }

  /**
   * Midtrans signature: SHA512(order_id + status_code + gross_amount + serverKey)
   * https://docs.midtrans.com/docs/https-notification-webhooks
   */
  verifyWebhook(
    rawBody: Buffer,
    _headers: Record<string, string | undefined>,
  ): boolean {
    const serverKey = settingsStore.getCredential("midtrans", "serverKey");
    if (!serverKey) {
      if (config.nodeEnv === "production") {
        logger.error(
          { provider: this.name },
          "MIDTRANS serverKey kosong di production — webhook ditolak",
        );
        return false;
      }
      logger.warn(
        { provider: this.name },
        "MIDTRANS serverKey tidak diset, signature verification dilewati (dev only)",
      );
      return true;
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(rawBody.toString("utf-8"));
    } catch {
      return false;
    }
    const orderId = String(parsed.order_id ?? "");
    const statusCode = String(parsed.status_code ?? "");
    const grossAmount = String(parsed.gross_amount ?? "");
    const signatureKey = String(parsed.signature_key ?? "");

    const expected = createHash("sha512")
      .update(orderId + statusCode + grossAmount + serverKey)
      .digest("hex");

    return expected === signatureKey;
  }


  /**
   * Map status Midtrans → status internal.
   * Midtrans values: capture, settlement, pending, deny, cancel, expire, refund, partial_refund, authorize, failure
   */
  parseWebhook(payload: Record<string, unknown>): WebhookEvent {
    const txStatus = String(payload.transaction_status ?? "").toLowerCase();
    const fraudStatus = String(payload.fraud_status ?? "").toLowerCase();

    let status: PaymentStatus = "pending";
    if (txStatus === "capture" || txStatus === "settlement") {
      status = fraudStatus === "challenge" ? "pending" : "success";
    } else if (txStatus === "pending") {
      status = "pending";
    } else if (txStatus === "deny" || txStatus === "cancel" || txStatus === "failure") {
      status = "failed";
    } else if (txStatus === "expire") {
      status = "expired";
    } else if (txStatus === "refund" || txStatus === "partial_refund") {
      status = "refunded";
    }

    return {
      orderId: String(payload.order_id ?? ""),
      providerTransactionId: String(payload.transaction_id ?? ""),
      status,
      rawPayload: payload,
    };
  }
}

function simulateLatency(min: number, max: number): Promise<void> {
  const ms = min + Math.random() * (max - min);
  return new Promise((r) => setTimeout(r, ms));
}
