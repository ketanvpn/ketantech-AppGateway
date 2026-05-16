import { v4 as uuidv4 } from "uuid";
import {
  ChargeRequest,
  GatewayError,
  PaymentProvider,
  ProviderError,
  TransactionRecord,
} from "../types";
import { getOrderedProviders } from "../providers";
import { transactionStore } from "../store/transactionStore";
import { withRetry } from "../utils/retry";
import { config } from "../config";
import { logger } from "../utils/logger";

/**
 * Inti dari Application Gateway Pattern.
 *
 * Alur charge():
 *  1. Ambil daftar provider sesuai prioritas.
 *  2. Untuk setiap provider:
 *     a. Cek health → skip jika unhealthy.
 *     b. Coba charge dengan retry exponential backoff.
 *     c. Jika sukses → simpan transaksi & return.
 *     d. Jika gagal → catat attempt, lanjut ke provider berikutnya.
 *  3. Jika semua provider gagal → throw GatewayError(503).
 *
 * Aplikasi internal yang memanggil service ini tidak perlu tahu provider mana
 * yang sedang dipakai. Mereka hanya tahu: "saya minta charge, gateway yang urus".
 */
export async function chargePayment(
  req: ChargeRequest,
): Promise<TransactionRecord> {
  // Cek apakah orderId sudah pernah sukses
  const existing = transactionStore.findByOrderId(req.orderId);
  if (existing && existing.status === "success") {
    logger.info({ orderId: req.orderId }, "order already paid, returning existing");
    return existing;
  }

  const providers = getOrderedProviders();
  const attempts: TransactionRecord["attempts"] = [];
  const txId = uuidv4();

  for (const provider of providers) {
    const healthy = await safeIsHealthy(provider);
    if (!healthy) {
      logger.warn({ provider: provider.name }, "provider unhealthy, skipping");
      attempts.push({
        providerName: provider.name,
        success: false,
        error: "unhealthy",
        at: new Date().toISOString(),
      });
      continue;
    }

    try {
      const result = await withRetry(() => provider.charge(req), {
        maxAttempts: config.retry.maxAttempts,
        baseDelayMs: config.retry.baseDelayMs,
        label: `charge:${provider.name}`,
        shouldRetry: (err) => {
          if (err instanceof ProviderError) return err.retriable;
          return true;
        },
      });

      attempts.push({
        providerName: provider.name,
        success: true,
        at: new Date().toISOString(),
      });

      const now = new Date().toISOString();
      const record: TransactionRecord = {
        id: txId,
        orderId: req.orderId,
        amount: req.amount,
        currency: req.currency,
        method: req.method,
        status: result.status,
        providerName: result.providerName,
        providerTransactionId: result.providerTransactionId,
        paymentUrl: result.paymentUrl,
        rawResponse: result.rawResponse,
        attempts,

        createdAt: now,
        updatedAt: now,
      };
      transactionStore.save(record);

      logger.info(
        {
          provider: provider.name,
          orderId: req.orderId,
          providerTxId: result.providerTransactionId,
        },
        "payment charged successfully",
      );

      return record;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(
        { provider: provider.name, orderId: req.orderId, err: message },
        "provider failed, trying next",
      );
      attempts.push({
        providerName: provider.name,
        success: false,
        error: message,
        at: new Date().toISOString(),
      });
    }
  }

  // Semua provider gagal
  const now = new Date().toISOString();
  const failedRecord: TransactionRecord = {
    id: txId,
    orderId: req.orderId,
    amount: req.amount,
    currency: req.currency,
    method: req.method,
    status: "failed",
    providerName: providers[0]?.name ?? "midtrans",
    providerTransactionId: "",
    attempts,
    createdAt: now,
    updatedAt: now,
  };
  transactionStore.save(failedRecord);

  // Telegram alert — fire and forget
  import("./telegramBot")
    .then((m) => m.notifyAllProvidersDown())
    .catch(() => {});

  throw new GatewayError(
    "ALL_PROVIDERS_FAILED",
    "All payment providers are unavailable",

    503,
    { attempts },
  );
}

async function safeIsHealthy(provider: PaymentProvider): Promise<boolean> {
  try {
    return await provider.isHealthy();
  } catch {
    return false;
  }
}
