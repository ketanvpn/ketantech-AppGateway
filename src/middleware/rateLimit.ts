import rateLimit from "express-rate-limit";
import { config } from "../config";

/**
 * Rate limiter untuk endpoint /payments.
 * Cocok untuk traffic transaksi normal.
 *
 * Untuk produksi multi-instance: gunakan store Redis (rate-limit-redis)
 * agar counter share antar instance.
 */
export const paymentRateLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "RATE_LIMIT_EXCEEDED",
    message: "Terlalu banyak request, coba lagi nanti",
  },
});

/** Backward-compat alias. */
export const rateLimiter = paymentRateLimiter;

/**
 * Rate limiter ketat untuk endpoint admin.
 * Tujuan utama: cegah brute force ADMIN_API_KEY.
 * Default: 30 request / menit per IP.
 */
export const adminRateLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  // Skip counter saat sukses supaya admin yang sah tidak ke-throttle.
  skipSuccessfulRequests: true,
  message: {
    error: "RATE_LIMIT_EXCEEDED",
    message: "Terlalu banyak admin request, coba lagi nanti",
  },
});

/**
 * Rate limiter untuk webhook — protect dari flood/DoS.
 * Webhook real dari provider biasanya rendah (puluhan/menit).
 * Kalau flood >300/menit per IP, kemungkinan attacker.
 */
export const webhookRateLimiter = rateLimit({
  windowMs: 60_000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "RATE_LIMIT_EXCEEDED",
    message: "Webhook rate limit exceeded",
  },
});
