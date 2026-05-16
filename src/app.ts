import express from "express";
import cors from "cors";
import helmet from "helmet";
import { paymentRoutes } from "./routes/paymentRoutes";
import { healthRoutes } from "./routes/healthRoutes";
import { webhookRoutes } from "./routes/webhookRoutes";
import { adminRoutes } from "./routes/adminRoutes";
import { errorHandler } from "./middleware/errorHandler";
import {
  paymentRateLimiter,
  webhookRateLimiter,
} from "./middleware/rateLimit";
import { config } from "./config";
import { logger } from "./utils/logger";

export function createApp(): express.Express {
  const app = express();

  // Hilangkan info versi Express dari header (kurangi fingerprinting).
  app.disable("x-powered-by");

  // Trust proxy — penting kalau gateway di belakang LB / reverse proxy.
  // Tanpa ini, rate-limit & req.ip akan baca IP proxy, bukan client asli.
  app.set("trust proxy", config.trustProxy);

  // Security headers — XSS, clickjacking, MIME sniffing, dll.
  app.use(
    helmet({
      contentSecurityPolicy: false, // API-only, tidak perlu CSP
      crossOriginResourcePolicy: { policy: "cross-origin" },
    }),
  );

  // CORS — diizinkan dari origin frontend dashboard
  app.use(
    cors({
      origin: config.corsOrigin.split(",").map((o) => o.trim()),
      credentials: false,
      allowedHeaders: [
        "Content-Type",
        "Idempotency-Key",
        "X-Admin-Key",
        "X-Client-Key",
        "x-callback-token",
      ],
    }),
  );

  // Cegah caching response API — transaksi pembayaran tidak boleh di-cache.
  app.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
    res.setHeader("Pragma", "no-cache");
    next();
  });

  // Request logging sederhana
  app.use((req, _res, next) => {
    logger.debug({ method: req.method, path: req.path }, "incoming request");
    next();
  });

  // Webhook routes pakai raw body (sebelum json parser global!)
  // Pakai webhook-specific rate limiter.
  app.use("/api/v1/webhooks", webhookRateLimiter, webhookRoutes);

  // JSON parser untuk route lainnya
  app.use(express.json({ limit: "1mb" }));

  app.use("/health", healthRoutes);
  app.use("/api/v1/payments", paymentRateLimiter, paymentRoutes);
  app.use("/api/v1/admin", adminRoutes);

  // 404 handler
  app.use((req, res) => {
    res.status(404).json({
      error: "NOT_FOUND",
      message: `Route ${req.method} ${req.path} not found`,
    });
  });

  app.use(errorHandler);

  return app;
}
