import {
  GatewayError,
  PaymentStatus,
  TransactionRecord,
} from "../types";
import { transactionStore } from "../store/transactionStore";
import { logger } from "../utils/logger";

/**
 * Refund service.
 *
 * Catatan: di mock-provider mode, refund langsung mengubah status ke 'refunded'.
 * Di integrasi real, kita perlu call API refund provider (Midtrans:
 *   POST /v2/{order_id}/refund, Xendit: POST /refunds, dll), tunggu response,
 *   baru update DB. Untuk safety, refund harus async + reconcilable.
 */
export async function refundPayment(
  transactionId: string,
): Promise<TransactionRecord> {
  const tx = transactionStore.findById(transactionId);
  if (!tx) {
    throw new GatewayError(
      "TRANSACTION_NOT_FOUND",
      "Transaction not found",
      404,
    );
  }

  if (tx.status === "refunded") {
    // Idempotent — already refunded, no-op
    return tx;
  }

  if (tx.status !== "success") {
    throw new GatewayError(
      "REFUND_NOT_ALLOWED",
      `Cannot refund transaction with status '${tx.status}'. Only 'success' transactions can be refunded.`,
      409,
    );
  }

  // TODO: Untuk integrasi real, panggil provider.refund(tx.providerTransactionId).
  // Untuk sekarang (mock provider), langsung update status.
  const updated = transactionStore.updateStatus(
    tx.id,
    "refunded" as PaymentStatus,
  );
  if (!updated) {
    throw new GatewayError(
      "REFUND_FAILED",
      "Failed to update transaction status",
      500,
    );
  }

  logger.info(
    {
      txId: tx.id,
      orderId: tx.orderId,
      provider: tx.providerName,
      amount: tx.amount,
    },
    "transaction refunded",
  );

  return updated;
}
