import { RequestHandler } from "express";
import { createHash } from "crypto";
import { idempotencyStore } from "../store/idempotencyStore";
import { GatewayError } from "../types";

/**
 * Idempotency middleware untuk endpoint charge.
 *
 * Client wajib kirim header `Idempotency-Key`. Jika request dengan key yang
 * sama dikirim ulang (misal karena timeout/retry), gateway akan return response
 * yang sama tanpa charge ulang ke provider.
 *
 * Security: kita simpan hash dari body request. Kalau client retry dengan
 * key sama tapi body BEDA, itu indikasi bug client atau attempted abuse —
 * kita reject 422 supaya tidak masking error.
 */
export const idempotencyMiddleware: RequestHandler = (req, res, next) => {
  const key = req.header("Idempotency-Key");
  if (!key) {
    throw new GatewayError(
      "IDEMPOTENCY_KEY_REQUIRED",
      "Header 'Idempotency-Key' wajib diisi untuk endpoint ini",
      400,
    );
  }
  if (key.length > 255) {
    throw new GatewayError(
      "IDEMPOTENCY_KEY_TOO_LONG",
      "Idempotency-Key maksimum 255 karakter",
      400,
    );
  }

  // Hash body — pakai canonical JSON supaya order key tidak mempengaruhi.
  const bodyHash = hashCanonical(req.body);

  const existing = idempotencyStore.get(key);
  if (existing) {
    if (existing.bodyHash && existing.bodyHash !== bodyHash) {
      throw new GatewayError(
        "IDEMPOTENCY_KEY_MISMATCH",
        "Idempotency-Key sudah dipakai dengan body yang berbeda",
        422,
      );
    }
    if (existing.status === "in_progress") {
      throw new GatewayError(
        "IDEMPOTENCY_IN_PROGRESS",
        "Request dengan idempotency key ini sedang diproses",
        409,
      );
    }
    if (existing.status === "completed" && existing.response) {
      res.status(existing.response.statusCode).json(existing.response.body);
      return;
    }
  }

  idempotencyStore.begin(key, bodyHash);

  // Tangkap response untuk disimpan
  const originalJson = res.json.bind(res);
  res.json = (body: unknown) => {
    if (res.statusCode < 500) {
      idempotencyStore.complete(key, res.statusCode, body);
    } else {
      // Server error → release supaya bisa di-retry
      idempotencyStore.release(key);
    }
    return originalJson(body);
  };

  next();
};

/**
 * Hash body request dengan canonical key ordering supaya
 * { a: 1, b: 2 } dan { b: 2, a: 1 } menghasilkan hash sama.
 */
function hashCanonical(value: unknown): string {
  return createHash("sha256")
    .update(canonicalize(value))
    .digest("hex");
}

function canonicalize(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) {
    return "[" + v.map(canonicalize).join(",") + "]";
  }
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return (
    "{" +
    keys
      .map(
        (k) =>
          JSON.stringify(k) + ":" + canonicalize((v as Record<string, unknown>)[k]),
      )
      .join(",") +
    "}"
  );
}
