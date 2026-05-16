import { RequestHandler } from "express";
import { timingSafeEqual } from "crypto";
import { GatewayError } from "../types";
import { config } from "../config";
import { settingsStore } from "../store/settingsStore";


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
 * API key auth untuk endpoint admin.
 * Client harus kirim header `X-Admin-Key` yang match `ADMIN_API_KEY` di env.
 */
export const adminAuth: RequestHandler = (req, _res, next) => {
  const key = req.header("X-Admin-Key") || "";
  if (!key || !safeEqual(key, config.adminApiKey)) {
    throw new GatewayError(
      "UNAUTHORIZED",
      "Admin API key tidak valid atau tidak ada",
      401,
    );
  }
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


