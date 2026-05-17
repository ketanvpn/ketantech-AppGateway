import { RequestHandler } from "express";
import { timingSafeEqual } from "crypto";
import { GatewayError } from "../types";
import { config } from "../config";
import { settingsStore } from "../store/settingsStore";
import { authAttemptStore } from "../store/authAttemptStore";
import { logger } from "../utils/logger";



/**
 * Timing-safe string comparison untuk cegah timing attack.
 * `===` / `!==` di JS leak panjang prefix yang match — attacker bisa
 * brute force karakter demi karakter dengan ukur waktu response.
 */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) {
    // Tetap lakukan compare dengan length sama supaya timing tidak leak length.
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

/**
 * Get client IP yang aman dari trust-proxy. req.ip auto-resolved oleh Express
 * berdasarkan setting `app.set('trust proxy', ...)`. Fallback ke "unknown"
 * supaya rate limit per-IP tetap berfungsi walau header tidak ada.
 */
function getClientIp(req: { ip?: string }): string {
  return req.ip || "unknown";
}

/**
 * API key auth untuk endpoint admin dengan **lockout protection**.
 *
 * Defense in depth:
 *  1. Timing-safe compare (cegah timing attack)
 *  2. Per-IP failed attempt counter (PCI-DSS req 8.1.6 — max 6, kita 10
 *     dalam 15 menit untuk balance UX dengan security)
 *  3. Auto-lockout 15 menit kalau exceeded
 *  4. Audit log warning saat lockout triggered
 *
 * Pakai resource ID "admin" — semua admin endpoint share counter.
 * Counter di-reset saat sukses auth.
 */
export const adminAuth: RequestHandler = (req, _res, next) => {
  const ip = getClientIp(req);
  const RESOURCE = "admin";

  // Cek apakah IP ter-lockout
  const remainingSec = authAttemptStore.isLocked(RESOURCE, ip);
  if (remainingSec > 0) {
    logger.warn(
      { ip, remainingSec },
      "Admin auth blocked — IP locked out (too many failed attempts)",
    );
    throw new GatewayError(
      "LOCKED_OUT",
      `Akses diblokir karena terlalu banyak kegagalan login. Coba lagi dalam ${Math.ceil(remainingSec / 60)} menit.`,
      429, // 429 Too Many Requests (atau 423 Locked, tapi 429 lebih umum)
    );
  }

  const key = req.header("X-Admin-Key") || "";
  if (!key || !safeEqual(key, config.adminApiKey)) {
    const locked = authAttemptStore.recordFailure(RESOURCE, ip);
    logger.warn(
      { ip, hasKey: Boolean(key), nowLocked: locked },
      "Admin auth failed",
    );
    throw new GatewayError(
      "UNAUTHORIZED",
      locked
        ? "Akses diblokir karena terlalu banyak kegagalan. Coba lagi nanti."
        : "Admin API key tidak valid atau tidak ada",
      401,
    );
  }

  // Sukses — reset counter
  authAttemptStore.reset(RESOURCE, ip);
  next();
};


/**
 * API key auth untuk aplikasi internal yang call /api/v1/payments/*.
 *
 * Behavior:
 * - Kalau `CLIENT_API_KEYS` di env kosong, middleware ini no-op (cocok untuk
 *   gateway yang di-deploy di network internal isolated).
 * - Kalau di-set, header `X-Client-Key` wajib & harus match salah satu key.
 *
 * Tiap aplikasi internal sebaiknya punya key sendiri (key 1, key 2, dst)
 * supaya bisa rotate per-app tanpa downtime app lain.
 */
export const clientAuth: RequestHandler = (req, _res, next) => {
  // Resolved dari settingsStore — nilai DB override .env, evaluated per-request
  // supaya perubahan di dashboard langsung berlaku tanpa restart.
  const allowedKeys = settingsStore.getSystem().clientApiKeys;

  if (allowedKeys.length === 0) {
    // Mode terbuka — diasumsikan network-level isolation
    return next();
  }
  const provided = req.header("X-Client-Key") || "";
  if (!provided) {
    throw new GatewayError(
      "UNAUTHORIZED",
      "Header X-Client-Key wajib",
      401,
    );
  }
  for (const allowed of allowedKeys) {
    if (safeEqual(provided, allowed)) return next();
  }
  throw new GatewayError("UNAUTHORIZED", "Client API key tidak valid", 401);
};


