import { logger } from "../utils/logger";
import { settingsStore } from "../store/settingsStore";
import { transactionStore } from "../store/transactionStore";
import { syncOrderKuotaStatus } from "./orderkuotaSyncService";

/**
 * Background worker untuk OrderKuota status sync.
 *
 * OrderKuota tidak punya webhook → kalau tidak ada yang aktif call /sync,
 * transaksi pending akan tetap pending selamanya. Worker ini jalan otomatis
 * di backend, jadi pelanggan yang bayar tetap dapat status update walau
 * tidak ada admin yang lagi buka dashboard.
 *
 * Behavior:
 *  - Polling tiap `POLL_INTERVAL_MS` (default 30 detik).
 *  - Skip kalau credential belum di-set (cegah 401 spam).
 *  - Skip kalau tidak ada pending transaction (hemat call ke OrderKuota).
 *  - Auto-stop saat shutdown signal diterima.
 *  - Single instance — multi-instance setup butuh Redis lock (TODO).
 */

const POLL_INTERVAL_MS = parseInt(
  process.env.ORDERKUOTA_WORKER_INTERVAL_MS || "30000",
  10,
);

let timer: NodeJS.Timeout | null = null;
let running = false;

export function startOrderKuotaWorker(): void {
  if (timer) {
    logger.warn("OrderKuota worker sudah jalan");
    return;
  }

  // Disable via env kalau pakai cron eksternal / multi-instance setup.
  if (process.env.ORDERKUOTA_WORKER_DISABLED === "true") {
    logger.info("OrderKuota worker disabled via env");
    return;
  }

  logger.info(
    { intervalMs: POLL_INTERVAL_MS },
    "OrderKuota worker started",
  );

  timer = setInterval(tick, POLL_INTERVAL_MS);
  // First tick immediately so the first run tidak nunggu interval pertama
  // (tapi jangan blocking startup, jadi pakai unref + setTimeout 1s)
  setTimeout(tick, 1000).unref();
}

export function stopOrderKuotaWorker(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
    logger.info("OrderKuota worker stopped");
  }
}

async function tick(): Promise<void> {
  // Cegah overlap kalau call sebelumnya masih jalan (misal API OrderKuota lambat)
  if (running) return;

  // Skip kalau credential belum diisi — cegah error spam
  const username = settingsStore.getCredential("orderkuota", "username");
  const authToken = settingsStore.getCredential("orderkuota", "authToken");
  if (!username || !authToken) return;

  // Skip kalau tidak ada pending OrderKuota — hemat call eksternal
  const hasPending = transactionStore
    .list()
    .some((t) => t.providerName === "orderkuota" && t.status === "pending");
  if (!hasPending) return;

  running = true;
  try {
    const result = await syncOrderKuotaStatus();
    if (result.matched > 0) {
      logger.info(
        {
          matched: result.matched,
          pendingBefore: result.pendingCount,
          mutasi: result.mutasiCount,
          worker: true,
        },
        "OrderKuota worker matched transactions",
      );
    }
  } catch (err) {
    // Sengaja tidak rethrow — kita tidak mau worker mati cuma karena
    // sekali fail (misal token expired). Log saja, retry tick berikutnya.
    logger.error(
      { err: (err as Error).message, worker: true },
      "OrderKuota worker tick failed",
    );
  } finally {
    running = false;
  }
}
