import dotenv from "dotenv";

dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || "3000", 10),
  nodeEnv: process.env.NODE_ENV || "development",
  logLevel: process.env.LOG_LEVEL || "info",

  adminApiKey: process.env.ADMIN_API_KEY || "dev-admin-key-change-me",

  /**
   * API key untuk aplikasi internal yang call /api/v1/payments/*.
   * Comma-separated kalau lebih dari satu app yang ngonsumsi.
   * Kalau kosong, endpoint /payments terbuka — hanya OK kalau gateway
   * di-deploy di network internal yang isolated. Di production sebaiknya
   * di-set supaya tiap app punya key sendiri yang bisa di-rotate.
   */
  clientApiKeys: (process.env.CLIENT_API_KEYS || "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean),

  corsOrigin: process.env.CORS_ORIGIN || "http://localhost:3001",


  /**
   * Trust proxy untuk Express.
   * Set ke "true" / "1" / nomor hop kalau gateway di belakang load balancer
   * supaya rate-limit, req.ip dll baca X-Forwarded-For dengan benar.
   * Default: false (langsung dari client).
   */
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),


  // Path file SQLite. Set ke ":memory:" untuk in-memory (dipakai di tests).
  databasePath: process.env.DATABASE_PATH || "./data/gateway.db",

  providerOrder: (process.env.PROVIDER_ORDER || "midtrans,xendit")
    .split(",")
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean),

  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || "60000", 10),
    max: parseInt(process.env.RATE_LIMIT_MAX || "100", 10),
  },

  retry: {
    maxAttempts: parseInt(process.env.RETRY_MAX_ATTEMPTS || "3", 10),
    baseDelayMs: parseInt(process.env.RETRY_BASE_DELAY_MS || "200", 10),
  },

  mock: {
    midtransForceDown: process.env.MIDTRANS_FORCE_DOWN === "true",
    xenditForceDown: process.env.XENDIT_FORCE_DOWN === "true",
    dokuForceDown: process.env.DOKU_FORCE_DOWN === "true",
    tripayForceDown: process.env.TRIPAY_FORCE_DOWN === "true",
    orderkuotaForceDown: process.env.ORDERKUOTA_FORCE_DOWN === "true",
    autogopayForceDown: process.env.AUTOGOPAY_FORCE_DOWN === "true",
  },


  midtrans: {
    serverKey: process.env.MIDTRANS_SERVER_KEY || "",
    baseUrl: process.env.MIDTRANS_BASE_URL || "https://api.sandbox.midtrans.com",
  },

  xendit: {
    secretKey: process.env.XENDIT_SECRET_KEY || "",
    baseUrl: process.env.XENDIT_BASE_URL || "https://api.xendit.co",
    callbackToken: process.env.XENDIT_CALLBACK_TOKEN || "",
  },

  doku: {
    clientId: process.env.DOKU_CLIENT_ID || "",
    secretKey: process.env.DOKU_SECRET_KEY || "",
    baseUrl: process.env.DOKU_BASE_URL || "https://api-sandbox.doku.com",
  },

  tripay: {
    apiKey: process.env.TRIPAY_API_KEY || "",
    privateKey: process.env.TRIPAY_PRIVATE_KEY || "",
    merchantCode: process.env.TRIPAY_MERCHANT_CODE || "",
    baseUrl: process.env.TRIPAY_BASE_URL || "https://tripay.co.id/api-sandbox",
  },

  /**
   * OrderKuota — endpoint khusus QRIS dengan auth username + token.
   * Token didapat lewat OTP login (lihat /api/v1/admin/orderkuota/login).
   * Tidak ada webhook native — status update via polling /sync.
   */
  orderkuota: {
    username: process.env.ORDERKUOTA_USERNAME || "",
    authToken: process.env.ORDERKUOTA_AUTH_TOKEN || "",
    baseUrl: process.env.ORDERKUOTA_BASE_URL || "https://app.orderkuota.com/api/v2",
  },

  /**
   * AutoGoPay — QRIS provider dengan webhook support.
   * Auth via Bearer token (API Key).
   * Reference: https://v1-gateway.autogopay.site/docs
   */
  autogopay: {
    apiKey: process.env.AUTOGOPAY_API_KEY || "",
    baseUrl: process.env.AUTOGOPAY_BASE_URL || "https://v1-gateway.autogopay.site",
  },
};


/**
 * Parse TRUST_PROXY env: "true"/"false", angka (jumlah hop), atau string custom
 * (CIDR / list IP) seperti yang Express terima.
 */
function parseTrustProxy(v: string | undefined): boolean | number | string {
  if (!v) return false;
  const lower = v.trim().toLowerCase();
  if (lower === "true") return true;
  if (lower === "false") return false;
  const n = Number(lower);
  if (!Number.isNaN(n) && Number.isInteger(n)) return n;
  return v;
}


