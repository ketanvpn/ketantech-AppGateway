import { Router } from "express";
import { getOrderedProviders } from "../providers";
import { pingDb } from "../store/db";

export const healthRoutes = Router();

/** GET /health - liveness check (proses jalan) */
healthRoutes.get("/", (_req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

/**
 * GET /health/ready - readiness check.
 * Cek apakah dependensi penting (DB) siap menerima traffic.
 * Kubernetes/LB sebaiknya pakai endpoint ini untuk decide routing traffic.
 */
healthRoutes.get("/ready", (_req, res) => {
  const dbOk = pingDb();
  const ok = dbOk;
  res.status(ok ? 200 : 503).json({
    status: ok ? "ready" : "not_ready",
    checks: { database: dbOk },
  });
});


/** GET /health/providers - status semua provider */
healthRoutes.get("/providers", async (_req, res) => {
  const providers = getOrderedProviders();
  const results = await Promise.all(
    providers.map(async (p) => ({
      name: p.name,
      healthy: await safeHealth(p.isHealthy.bind(p)),
    })),
  );

  const allDown = results.every((r) => !r.healthy);
  res.status(allDown ? 503 : 200).json({
    status: allDown ? "all_down" : "ok",
    providers: results,
  });
});

async function safeHealth(fn: () => Promise<boolean>): Promise<boolean> {
  try {
    return await fn();
  } catch {
    return false;
  }
}
