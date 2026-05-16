import {
  GatewayError,
  PaymentStatus,
  ProviderName,
  TransactionRecord,
  WebhookEvent,
} from "../types";
import { getProvider } from "../providers";
import { transactionStore } from "../store/transactionStore";
import { logger } from "../utils/logger";

/**
 * Coba ekstrak amount dari payload webhook untuk validasi cross-check.
 * Bukan field yang seragam antar-provider, jadi best-effort.
 *
 * Return undefined kalau tidak ketemu / tidak valid — artinya skip validasi.
 */
function extractAmount(payload: Record<string, unknown>): number | undefined {
  const candidates = [
    payload.amount,
    payload.gross_amount,
    (payload.transaction as Record<string, unknown> | undefined)?.amount,
    (payload.order as Record<string, unknown> | undefined)?.amount,
  ];
  for (const c of candidates) {
    if (c == null) continue;
    const n = typeof c === "string" ? Number(c) : c;
    if (typeof n === "number" && Number.isFinite(n) && n > 0) {
      return Math.round(n); // amount selalu integer (rupiah)
    }
  }
  return undefined;
}


/**
 * Status terminal — tidak boleh lagi diubah oleh webhook berikutnya.
 * Mencegah race condition: misal sudah `success`, lalu datang webhook
 * `pending` yang nyangkut karena urutan delivery tidak terjamin.
 */
const TERMINAL_STATUSES: ReadonlySet<PaymentStatus> = new Set([
  "success",
  "failed",
  "expired",
  "refunded",
]);

export interface WebhookProcessResult {
  status: "applied" | "ignored" | "duplicate";
  transaction?: TransactionRecord;
  reason?: string;
}

/**
 * Proses webhook setelah signature sudah diverifikasi di route layer.
 * Idempotent: webhook yang sama dikirim ulang akan ditangani aman.
 */
export async function processWebhook(
  providerName: ProviderName,
  event: WebhookEvent,
): Promise<WebhookProcessResult> {
  const provider = getProvider(providerName);
  if (!provider) {
    throw new GatewayError(
      "UNKNOWN_PROVIDER",
      `Provider ${providerName} tidak dikenal`,
      400,
    );
  }

  // Cari transaksi by providerTransactionId, fallback ke orderId
  let record =
    (event.providerTransactionId
      ? transactionStore.findByProviderTransactionId(event.providerTransactionId)
      : undefined) ??
    (event.orderId
      ? transactionStore.findByOrderId(event.orderId)
      : undefined);

  if (!record) {
    logger.warn(
      {
        provider: providerName,
        orderId: event.orderId,
        providerTxId: event.providerTransactionId,
      },
      "webhook diterima untuk transaksi yang tidak ditemukan",
    );
    throw new GatewayError(
      "TRANSACTION_NOT_FOUND",
      "Transaction not found for this webhook event",
      404,
    );
  }

  // Pastikan webhook ini berasal dari provider yang sama dengan transaksi
  if (record.providerName !== providerName) {
    logger.warn(
      {
        expected: record.providerName,
        got: providerName,
        orderId: event.orderId,
      },
      "webhook dari provider yang berbeda dengan transaksi original",
    );
    throw new GatewayError(
      "PROVIDER_MISMATCH",
      "Webhook provider does not match transaction provider",
      400,
    );
  }

  // Cross-check amount kalau provider mengirimnya — defense in depth
  // melawan webhook yang dipalsukan / dimodifikasi.
  const incomingAmount = extractAmount(event.rawPayload);
  if (
    incomingAmount !== undefined &&
    incomingAmount !== record.amount
  ) {
    logger.warn(
      {
        provider: providerName,
        orderId: event.orderId,
        expected: record.amount,
        got: incomingAmount,
      },
      "webhook amount tidak match dengan transaksi original",
    );
    throw new GatewayError(
      "AMOUNT_MISMATCH",
      "Webhook amount does not match transaction amount",
      400,
    );
  }

  // Idempotent: status sama → no-op

  if (record.status === event.status) {
    return { status: "duplicate", transaction: record };
  }

  // Status terminal tidak bisa diubah lagi
  if (TERMINAL_STATUSES.has(record.status)) {
    logger.info(
      {
        orderId: event.orderId,
        currentStatus: record.status,
        incomingStatus: event.status,
      },
      "transaksi sudah di status terminal, ignore webhook",
    );
    return {
      status: "ignored",
      transaction: record,
      reason: `Transaction already in terminal status: ${record.status}`,
    };
  }

  const updated = transactionStore.updateStatus(record.id, event.status);
  logger.info(
    {
      provider: providerName,
      orderId: event.orderId,
      from: record.status,
      to: event.status,
    },
    "transaksi diupdate dari webhook",
  );

  return { status: "applied", transaction: updated };
}
