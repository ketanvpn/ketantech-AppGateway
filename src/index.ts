import { createApp } from "./app";
import { config } from "./config";
import { logger } from "./utils/logger";
import {
  startOrderKuotaWorker,
  stopOrderKuotaWorker,
} from "./services/orderkuotaWorker";

/**
 * Startup safety checks — gagal cepat di production kalau config tidak aman.
 * Ini mencegah deploy tanpa sengaja dengan default value yang bocor / tidak aman.
 */
function assertProductionSafety(): void {
  if (config.nodeEnv !== "production") return;

  const errors: string[] = [];
  const warnings: string[] = [];

  // ── Critical: admin key ────────────────────────────────────
  if (
    config.adminApiKey === "dev-admin-key-change-me" ||
    config.adminApiKey.length < 16
  ) {
    errors.push(
      "ADMIN_API_KEY masih default / terlalu pendek (minimal 16 karakter, " +
        "pakai randomBytes untuk produksi).",
    );
  }

  // ── Critical: CORS ─────────────────────────────────────────
  if (
    config.corsOrigin.includes("*") ||
    config.corsOrigin.includes("localhost")
  ) {
    errors.push(
      `CORS_ORIGIN tidak aman untuk production: "${config.corsOrigin}". ` +
        "Set ke domain dashboard production yang spesifik.",
    );
  }

  // ── Critical: in-memory DB akan kehilangan data tiap restart ─
  if (config.databasePath === ":memory:") {
    errors.push(
      "DATABASE_PATH = :memory: di production akan menghilangkan semua " +
        "transaksi tiap server restart. Set ke file path yang persistent.",
    );
  }

  // ── Warning: client API keys kosong → endpoint /payments terbuka ──
  if (config.clientApiKeys.length === 0) {
    warnings.push(
      "CLIENT_API_KEYS kosong → endpoint /api/v1/payments/* terbuka tanpa " +
        "auth. Hanya OK kalau gateway di-deploy di network internal yang " +
        "isolated (VPC private subnet). Kalau exposed ke internet, set key.",
    );
  }

  // ── Warning: webhook tanpa signature verification ──────────
  if (!config.midtrans.serverKey) {
    warnings.push(
      "MIDTRANS_SERVER_KEY kosong → webhook signature tidak diverifikasi. " +
        "Siapa pun yang tahu URL webhook bisa kirim status palsu.",
    );
  }
  if (!config.xendit.callbackToken) {
    warnings.push(
      "XENDIT_CALLBACK_TOKEN kosong → webhook Xendit tidak diverifikasi.",
    );
  }
  // DOKU & Tripay punya kebutuhan signature di provider sendiri (sudah
  // di-handle di verifyWebhook), jadi tidak perlu di-warn di sini.

  // ── Warning: trust proxy off bisa salah baca client IP ─────
  if (
    config.trustProxy === false &&
    process.env.BEHIND_PROXY_HINT !== "false"
  ) {
    warnings.push(
      "TRUST_PROXY = false. Kalau gateway di-deploy di belakang reverse proxy " +
        "(nginx, AWS ELB, Cloudflare), rate-limit & audit log akan baca IP " +
        "load balancer, bukan client asli. Set TRUST_PROXY=true atau hop count.",
    );
  }

  // Print warnings (non-fatal, tapi tetap di-log)
  for (const w of warnings) {
    logger.warn(w);
  }

  if (errors.length > 0) {
    for (const e of errors) logger.fatal(e);
    logger.fatal(
      "Server tidak dijalankan karena production safety checks gagal. Fix env lalu retry.",
    );
    process.exit(1);
  }
}

assertProductionSafety();

const app = createApp();

const server = app.listen(config.port, () => {
  logger.info(
    {
      port: config.port,
      env: config.nodeEnv,
      providerOrder: config.providerOrder,
    },
    "Payment Gateway started",
  );

  // Background worker untuk OrderKuota status sync.
  // Idempotent — internal-nya cek apakah credential ada sebelum call.
  startOrderKuotaWorker();
});

const shutdown = (signal: string) => {
  logger.info({ signal }, "shutting down");
  stopOrderKuotaWorker();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
