"use strict";

/**
 * PaymentGatewayClient — wrapper sederhana untuk call gateway.
 *
 * Drop file ini ke project Express/Fastify/Koa Anda, lalu:
 *   const client = new PaymentGatewayClient({ baseUrl: "http://gateway-host:3000" });
 *   const tx = await client.charge({ ... });
 *
 * Pakai built-in fetch (Node 18+). Untuk Node lama, ganti dengan node-fetch / axios.
 */

const crypto = require("crypto");

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_RETRIES = 2; // total = 1 attempt + 2 retries

class PaymentGatewayError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = "PaymentGatewayError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

class PaymentGatewayClient {
  /**
   * @param {{ baseUrl: string, timeoutMs?: number }} opts
   */
  constructor(opts) {
    if (!opts?.baseUrl) throw new Error("baseUrl is required");
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /**
   * Charge customer. Idempotency key di-generate otomatis kalau tidak diberikan.
   * Aman untuk retry — gateway akan deduplikasi.
   *
   * @param {Object} req
   * @param {string} req.orderId
   * @param {number} req.amount
   * @param {string} req.currency
   * @param {"credit_card"|"bank_transfer"|"ewallet"|"qris"} req.method
   * @param {{ name: string, email: string, phone?: string }} req.customer
   * @param {string} [req.description]
   * @param {string} [idempotencyKey]
   */
  async charge(req, idempotencyKey) {
    const key = idempotencyKey || `${req.orderId}-${crypto.randomUUID()}`;
    return this._fetchWithRetry("POST", "/api/v1/payments/charge", req, {
      "Idempotency-Key": key,
    });
  }

  /** Cek status transaksi by gateway transaction id (UUID dari response charge). */
  async getById(transactionId) {
    return this._fetchWithRetry(
      "GET",
      `/api/v1/payments/${encodeURIComponent(transactionId)}`,
    );
  }

  /** Cek status transaksi by order id (yang Anda kirim saat charge). */
  async getByOrderId(orderId) {
    return this._fetchWithRetry(
      "GET",
      `/api/v1/payments?orderId=${encodeURIComponent(orderId)}`,
    );
  }

  async _fetchWithRetry(method, path, body, extraHeaders = {}) {
    let lastErr;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await this._fetch(method, path, body, extraHeaders);
      } catch (err) {
        lastErr = err;
        const isLast = attempt === MAX_RETRIES;
        const retriable =
          !(err instanceof PaymentGatewayError) || // network/timeout error
          err.status >= 500; // server error
        if (isLast || !retriable) break;
        const delay = 200 * Math.pow(2, attempt) + Math.random() * 100;
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    throw lastErr;
  }

  async _fetch(method, path, body, extraHeaders = {}) {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let res;
    try {
      res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...extraHeaders,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    const text = await res.text();
    const data = text ? JSON.parse(text) : {};

    if (!res.ok) {
      throw new PaymentGatewayError(
        res.status,
        data.error || "REQUEST_FAILED",
        data.message || res.statusText,
        data.details,
      );
    }
    return data.data;
  }
}

module.exports = { PaymentGatewayClient, PaymentGatewayError };
