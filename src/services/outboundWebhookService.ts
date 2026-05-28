import crypto from "crypto";
import { PaymentStatus, TransactionRecord } from "../types";
import { settingsStore } from "../store/settingsStore";
import { logger } from "../utils/logger";

interface OutboundWebhookPayload {
  eventId: string;
  eventType: "payment.status_changed";
  occurredAt: string;
  data: {
    transactionId: string;
    orderId: string;
    status: PaymentStatus;
    amount: number;
    currency: string;
    method: string;
    providerName: string;
    providerTransactionId: string;
    paymentUrl?: string;
    createdAt: string;
    updatedAt: string;
  };
}

function sign(secret: string, ts: string, body: string): string {
  return crypto.createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
}

async function postWithRetry(url: string, init: RequestInit, maxAttempts = 3): Promise<void> {
  let lastErr: unknown;
  for (let i = 1; i <= maxAttempts; i++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      if (res.ok) return;
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastErr = err;
    } finally {
      clearTimeout(timeout);
    }
    if (i < maxAttempts) {
      await new Promise((r) => setTimeout(r, 500 * i));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("webhook delivery failed");
}

export async function dispatchPaymentStatusWebhook(tx: TransactionRecord): Promise<void> {
  const targets = settingsStore.getOutboundWebhooks();
  if (targets.length === 0) return;

  const payload: OutboundWebhookPayload = {
    eventId: crypto.randomUUID(),
    eventType: "payment.status_changed",
    occurredAt: new Date().toISOString(),
    data: {
      transactionId: tx.id,
      orderId: tx.orderId,
      status: tx.status,
      amount: tx.amount,
      currency: tx.currency,
      method: tx.method,
      providerName: tx.providerName,
      providerTransactionId: tx.providerTransactionId,
      paymentUrl: tx.paymentUrl,
      createdAt: tx.createdAt,
      updatedAt: tx.updatedAt,
    },
  };

  const body = JSON.stringify(payload);
  const deliveries = targets
    .filter((t) => !t.events || t.events.length === 0 || t.events.includes(tx.status))
    .map(async (t) => {
      const ts = String(Date.now());
      const signature = sign(t.secret, ts, body);
      try {
        await postWithRetry(t.url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-ketantechpay-event": payload.eventType,
            "x-ketantechpay-event-id": payload.eventId,
            "x-ketantechpay-timestamp": ts,
            "x-ketantechpay-signature": signature,
          },
          body,
        });
        logger.info({ targetId: t.id, url: t.url, orderId: tx.orderId, status: tx.status }, "outbound webhook delivered");
      } catch (err) {
        logger.error({ targetId: t.id, url: t.url, orderId: tx.orderId, status: tx.status, err: (err as Error).message }, "outbound webhook delivery failed");
      }
    });

  await Promise.all(deliveries);
}
