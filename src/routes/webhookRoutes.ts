import { Router, RequestHandler, raw } from "express";
import { createHmac } from "crypto";
import { getProvider } from "../providers";
import { processWebhook } from "../services/webhookService";
import { hashPayload, webhookEventStore } from "../store/webhookEventStore";
import { settingsStore } from "../store/settingsStore";
import { GatewayError, ProviderName } from "../types";
import { logger } from "../utils/logger";


const asyncHandler =
  (fn: RequestHandler): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

export const webhookRoutes = Router();

/**
 * POST /api/v1/webhooks/:provider
 *
 * IMPORTANT: route ini menggunakan `express.raw()` (bukan json parser global)
 * supaya signature verification bisa pakai raw body byte-exact.
 */
webhookRoutes.post(
  "/:provider",
  raw({ type: "application/json", limit: "1mb" }),
  asyncHandler(async (req, res) => {
    const providerName = req.params.provider as ProviderName;
    const provider = getProvider(providerName);
    if (!provider) {
      throw new GatewayError(
        "UNKNOWN_PROVIDER",
        `Provider ${providerName} tidak dikenal`,
        404,
      );
    }

    const rawBody = req.body as Buffer;
    if (!Buffer.isBuffer(rawBody) || rawBody.length === 0) {
      throw new GatewayError("INVALID_BODY", "Empty webhook body", 400);
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody.toString("utf-8"));
    } catch {
      throw new GatewayError("INVALID_JSON", "Webhook body is not valid JSON", 400);
    }

    // Normalisasi headers ke lowercase
    const headers: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      headers[k.toLowerCase()] = Array.isArray(v) ? v[0] : v;
    }

    const valid = provider.verifyWebhook(rawBody, headers);
    if (!valid) {
      logger.warn({ provider: providerName }, "invalid webhook signature");
      throw new GatewayError(
        "INVALID_SIGNATURE",
        "Webhook signature verification failed",
        401,
      );
    }

    // AutoGoPay melakukan verifikasi callback dengan challenge payload:
    // { event: "verification.challenge", challenge: "..." }
    // Ini bukan transaksi, tapi tetap harus lolos signature verification dulu.
    if (
      providerName === "autogopay" &&
      payload.event === "verification.challenge"
    ) {
      const challenge = String(payload.challenge || "");
      const apiKey = settingsStore.getCredential("autogopay", "apiKey");
      const challengeSignature = apiKey
        ? createHmac("sha256", apiKey).update(challenge).digest("hex")
        : "";

      logger.info(
        { provider: providerName, hasChallengeSignature: Boolean(challengeSignature) },
        "AutoGoPay webhook verification challenge accepted",
      );

      if (challengeSignature) {
        res.setHeader("X-Signature", challengeSignature);
      }
      res.status(200).json({
        success: true,
        message: "Callback verified",
        event: "verification.challenge",
        challenge,
        signature: challengeSignature,
        challenge_response: challengeSignature,
      });
      return;
    }

    // Strict dedup: kalau body persis sama pernah diterima, skip pemrosesan.
    // Provider biasa retry webhook saat tidak dapat 2xx, jadi ini sering kejadian.
    const payloadHash = hashPayload(rawBody);
    const seen = webhookEventStore.findByHash(providerName, payloadHash);
    if (seen) {
      logger.info(
        { provider: providerName, hash: payloadHash.slice(0, 8) },
        "webhook duplicate (same payload hash), skipping",
      );
      res.status(200).json({
        received: true,
        action: "duplicate",
        reason: "Webhook payload sudah pernah diproses",
      });
      return;
    }

    const event = provider.parseWebhook(payload);
    logger.info(
      {
        provider: providerName,
        orderId: event.orderId,
        providerTxId: event.providerTransactionId,
        status: event.status,
      },
      "webhook parsed event"
    );

    const result = await processWebhook(providerName, event);

    // Catat event setelah pemrosesan; gunakan insertIfNew untuk handle race
    // condition (dua webhook bersamaan dengan body identik).
    webhookEventStore.insertIfNew({
      provider: providerName,
      payloadHash,
      transactionId: result.transaction?.id ?? null,
      status: result.status,
    });

    res.status(200).json({
      received: true,
      action: result.status,
      transaction: result.transaction
        ? {
            id: result.transaction.id,
            orderId: result.transaction.orderId,
            status: result.transaction.status,
          }
        : undefined,
      reason: result.reason,
    });
  }),
);


