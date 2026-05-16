import { Router, RequestHandler } from "express";
import { z } from "zod";
import { adminAuth } from "../middleware/auth";
import { adminRateLimiter } from "../middleware/rateLimit";
import { transactionStore } from "../store/transactionStore";
import {
  CREDENTIAL_FIELDS_BY_PROVIDER,
  CredentialField,
  settingsStore,
} from "../store/settingsStore";
import { auditLogStore, recordAudit } from "../store/auditLogStore";
import { getOrderedProviders } from "../providers";
import { OrderKuotaProvider } from "../providers/orderkuotaProvider";
import { syncOrderKuotaStatus } from "../services/orderkuotaSyncService";
import { refundPayment } from "../services/refundService";
import { GatewayError, PaymentStatus, ProviderName } from "../types";


const asyncHandler =
  (fn: RequestHandler): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

export const adminRoutes = Router();

// Rate limit dulu (cegah brute force ADMIN_API_KEY tanpa throttle),
// baru auth check.
adminRoutes.use(adminRateLimiter);
adminRoutes.use(adminAuth);


/** GET /api/v1/admin/stats - dashboard summary */
adminRoutes.get(
  "/stats",
  asyncHandler(async (_req, res) => {
    const all = transactionStore.list();
    const total = all.length;

    const byStatus: Record<PaymentStatus, number> = {
      pending: 0,
      success: 0,
      failed: 0,
      expired: 0,
      refunded: 0,
    };
    const byProvider: Record<string, number> = {};
    let totalAmountSuccess = 0;

    for (const tx of all) {
      byStatus[tx.status] = (byStatus[tx.status] ?? 0) + 1;
      byProvider[tx.providerName] = (byProvider[tx.providerName] ?? 0) + 1;
      if (tx.status === "success") totalAmountSuccess += tx.amount;
    }

    const successRate = total === 0 ? 0 : (byStatus.success / total) * 100;

    // Provider health
    const providers = getOrderedProviders();
    const providerHealth = await Promise.all(
      providers.map(async (p) => ({
        name: p.name,
        healthy: await safeHealth(() => p.isHealthy()),
      })),
    );

    res.json({
      data: {
        totalTransactions: total,
        totalAmountSuccess,
        successRate: Number(successRate.toFixed(2)),
        byStatus,
        byProvider,
        providerHealth,
      },
    });
  }),
);

/**
 * Build filter list dari query params — di-share antara list & export CSV
 * supaya filter behavior konsisten.
 */
function filterTransactions(query: Record<string, unknown>) {
  const status = query.status as PaymentStatus | undefined;
  const provider = query.provider as ProviderName | undefined;
  const orderId = query.orderId ? String(query.orderId) : undefined;
  const fromIso = query.from ? String(query.from) : undefined;
  const toIso = query.to ? String(query.to) : undefined;
  // ISO date string atau ms timestamp; toleran ke kedua format.
  const fromMs = fromIso ? Date.parse(fromIso) : NaN;
  const toMs = toIso ? Date.parse(toIso) : NaN;

  let items = transactionStore.list();
  if (status) items = items.filter((t) => t.status === status);
  if (provider) items = items.filter((t) => t.providerName === provider);
  if (orderId)
    items = items.filter((t) =>
      t.orderId.toLowerCase().includes(orderId.toLowerCase()),
    );
  if (Number.isFinite(fromMs)) {
    items = items.filter((t) => Date.parse(t.createdAt) >= fromMs);
  }
  if (Number.isFinite(toMs)) {
    items = items.filter((t) => Date.parse(t.createdAt) <= toMs);
  }
  return items;
}

/**
 * GET /api/v1/admin/transactions
 * Query: page, pageSize, status, provider, orderId, from, to
 *
 * `from` / `to` adalah ISO date string (e.g. "2026-05-01T00:00:00Z").
 * Filter di-apply ke `createdAt`.
 */
adminRoutes.get(
  "/transactions",
  asyncHandler(async (req, res) => {
    const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
    const pageSize = Math.min(
      100,
      Math.max(1, parseInt(String(req.query.pageSize ?? "20"), 10) || 20),
    );

    const items = filterTransactions(req.query as Record<string, unknown>);

    const total = items.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const start = (page - 1) * pageSize;
    const paged = items.slice(start, start + pageSize);

    res.json({
      data: paged,
      pagination: { page, pageSize, total, totalPages },
    });
  }),
);

/**
 * GET /api/v1/admin/transactions/export.csv
 *
 * Export hasil filter sebagai CSV. Query params sama dengan list endpoint
 * (status, provider, orderId, from, to). Tidak ada pagination — return semua
 * yang match. Field-field yang di-include: ID, orderId, amount, currency,
 * method, status, provider, providerTxId, createdAt, updatedAt.
 *
 * Catatan: amount dan field text di-quote untuk kompatibilitas Excel/Sheets.
 * Untuk dataset besar (>50k row), pertimbangkan streaming response.
 */
adminRoutes.get(
  "/transactions/export.csv",
  asyncHandler(async (req, res) => {
    const items = filterTransactions(req.query as Record<string, unknown>);

    const header = [
      "transaction_id",
      "order_id",
      "amount",
      "currency",
      "method",
      "status",
      "provider",
      "provider_tx_id",
      "created_at",
      "updated_at",
    ].join(",");

    const rows = items.map((t) =>
      [
        csvEscape(t.id),
        csvEscape(t.orderId),
        String(t.amount),
        csvEscape(t.currency),
        csvEscape(t.method),
        csvEscape(t.status),
        csvEscape(t.providerName),
        csvEscape(t.providerTransactionId),
        csvEscape(t.createdAt),
        csvEscape(t.updatedAt),
      ].join(","),
    );

    const csv = [header, ...rows].join("\n");
    const ts = new Date().toISOString().replace(/[:T.]/g, "-").slice(0, 19);

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="transactions-${ts}.csv"`,
    );
    // BOM supaya Excel di Windows langsung kenali UTF-8 (untuk karakter Indonesia)
    res.send("\uFEFF" + csv);

    recordAudit(req, {
      action: "admin.transactions.export",
      targetType: "transaction",
      details: { count: items.length, filters: req.query },
    });
  }),
);

/**
 * Escape value untuk CSV. Wrap dengan quotes kalau ada koma/quote/newline,
 * dan double-up internal quote sesuai RFC 4180.
 */
function csvEscape(v: string): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}


/** GET /api/v1/admin/transactions/:id - full detail (semua attempts dll) */
adminRoutes.get(
  "/transactions/:id",
  asyncHandler(async (req, res) => {
    const tx = transactionStore.findById(req.params.id);
    if (!tx) {
      throw new GatewayError("NOT_FOUND", "Transaction not found", 404);
    }
    res.json({ data: tx });
  }),
);

/**
 * POST /api/v1/admin/transactions/:id/simulate-status
 *
 * DEV ONLY — simulasi webhook dari provider untuk update status transaksi.
 * Berguna untuk test alur tanpa nunggu pembayaran asli.
 *
 * Di produksi, status transaksi HANYA boleh diubah lewat webhook real
 * dari provider (POST /api/v1/webhooks/:provider) dengan signature valid.
 */
const simulateStatusSchema = z.object({
  status: z.enum(["pending", "success", "failed", "expired", "refunded"]),
});

adminRoutes.post(
  "/transactions/:id/simulate-status",
  asyncHandler(async (req, res) => {
    if (process.env.NODE_ENV === "production") {
      throw new GatewayError(
        "FORBIDDEN_IN_PRODUCTION",
        "Simulate-status endpoint disabled in production",
        403,
      );
    }
    const { status } = simulateStatusSchema.parse(req.body);
    const tx = transactionStore.findById(req.params.id);
    if (!tx) {
      throw new GatewayError("NOT_FOUND", "Transaction not found", 404);
    }
    const updated = transactionStore.updateStatus(tx.id, status);
    recordAudit(req, {
      action: "admin.simulate-status",
      targetType: "transaction",
      targetId: tx.id,
      details: { from: tx.status, to: status, orderId: tx.orderId },
    });
    res.json({ data: updated });
  }),
);

/**
 * POST /api/v1/admin/transactions/:id/refresh-status
 *
 * Pull-status dari provider — alternatif untuk webhook resend.
 *
 * Use case: webhook provider gagal nyampe (network issue, server kita down),
 * transaksi nyangkut di "pending" padahal pelanggan sudah bayar. Endpoint ini
 * panggil provider.getStatus() untuk dapat status terkini & update DB.
 *
 * Lebih reliable dari "replay webhook" karena:
 *  - Provider adalah source of truth, bukan webhook payload yang mungkin lama
 *  - Tidak butuh simpan raw body webhook (yang bisa besar & berisi PII)
 *  - Bisa recover transaksi yang webhook-nya benar-benar hilang
 *
 * OrderKuota tidak support — pakai /orderkuota/sync untuk match by mutasi.
 */
adminRoutes.post(
  "/transactions/:id/refresh-status",
  asyncHandler(async (req, res) => {
    const tx = transactionStore.findById(req.params.id);
    if (!tx) {
      throw new GatewayError("NOT_FOUND", "Transaction not found", 404);
    }
    if (tx.providerName === "orderkuota") {
      throw new GatewayError(
        "NOT_SUPPORTED",
        "OrderKuota tidak support pull status. Gunakan /orderkuota/sync.",
        400,
      );
    }
    const providers = getOrderedProviders();
    const provider = providers.find((p) => p.name === tx.providerName);
    if (!provider) {
      throw new GatewayError(
        "PROVIDER_NOT_FOUND",
        `Provider "${tx.providerName}" tidak terdaftar`,
        500,
      );
    }
    if (!tx.providerTransactionId) {
      throw new GatewayError(
        "BAD_REQUEST",
        "Transaksi tidak punya providerTransactionId untuk dicek",
        400,
      );
    }

    const oldStatus = tx.status;
    const newStatus = await provider.getStatus(tx.providerTransactionId);
    let updated = tx;
    if (newStatus !== oldStatus) {
      updated = transactionStore.updateStatus(tx.id, newStatus) ?? tx;
    }

    recordAudit(req, {
      action: "admin.transaction.refresh-status",
      targetType: "transaction",
      targetId: tx.id,
      details: {
        provider: tx.providerName,
        from: oldStatus,
        to: newStatus,
        changed: newStatus !== oldStatus,
      },
    });

    res.json({
      data: updated,
      meta: {
        previousStatus: oldStatus,
        currentStatus: newStatus,
        changed: newStatus !== oldStatus,
      },
    });
  }),
);

/**
 * POST /api/v1/admin/transactions/:id/refund
 *
 * Refund transaksi yang sudah success.
 * Idempotent — refund pada transaksi yang sudah refunded akan no-op.
 *
 * Refund itu operasi sensitif (money out), jadi diproteksi admin auth + di-audit.
 */
adminRoutes.post(
  "/transactions/:id/refund",

  asyncHandler(async (req, res) => {
    const record = await refundPayment(req.params.id);
    recordAudit(req, {
      action: "admin.refund",
      targetType: "transaction",
      targetId: record.id,
      details: {
        orderId: record.orderId,
        amount: record.amount,
        currency: record.currency,
        provider: record.providerName,
      },
    });
    res.json({ data: record });
  }),
);


/** GET /api/v1/admin/settings */

adminRoutes.get(
  "/settings",
  asyncHandler(async (_req, res) => {
    res.json({ data: settingsStore.snapshot() });
  }),
);

const PROVIDER_ENUM = z.enum([
  "midtrans",
  "xendit",
  "doku",
  "tripay",
  "orderkuota",
]);


const settingsSchema = z
  .object({
    providerOrder: z.array(PROVIDER_ENUM).min(1).optional(),
    /** Map provider name → force-down state */
    forceDown: z.record(PROVIDER_ENUM, z.boolean()).optional(),
    // Backward-compat: accept individual field
    midtransForceDown: z.boolean().optional(),
    xenditForceDown: z.boolean().optional(),
    dokuForceDown: z.boolean().optional(),
    tripayForceDown: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "Minimal satu field harus diisi",
  });

/** PATCH /api/v1/admin/settings - update partial settings */
adminRoutes.patch(
  "/settings",
  asyncHandler(async (req, res) => {
    const body = settingsSchema.parse(req.body);
    const before = settingsStore.snapshot();

    if (body.providerOrder) settingsStore.setProviderOrder(body.providerOrder);

    if (body.forceDown) {
      for (const [name, val] of Object.entries(body.forceDown)) {
        settingsStore.setForceDown(name as ProviderName, val);
      }
    }
    if (typeof body.midtransForceDown === "boolean")
      settingsStore.setForceDown("midtrans", body.midtransForceDown);
    if (typeof body.xenditForceDown === "boolean")
      settingsStore.setForceDown("xendit", body.xenditForceDown);
    if (typeof body.dokuForceDown === "boolean")
      settingsStore.setForceDown("doku", body.dokuForceDown);
    if (typeof body.tripayForceDown === "boolean")
      settingsStore.setForceDown("tripay", body.tripayForceDown);

    const after = settingsStore.snapshot();
    recordAudit(req, {
      action: "admin.settings.update",
      targetType: "settings",
      details: { before, after },
    });

    res.json({ data: after });
  }),
);


/**
 * GET /api/v1/admin/credentials
 *
 * List credentials per provider (secrets dimask).
 * Setiap field punya `source`: "db" (override dari dashboard),
 * "env" (dari .env), atau "empty".
 */
adminRoutes.get(
  "/credentials",
  asyncHandler(async (_req, res) => {
    res.json({ data: settingsStore.credentialsSnapshot() });
  }),
);

const credentialFieldEnum = z.enum([
  "serverKey",
  "secretKey",
  "callbackToken",
  "clientId",
  "apiKey",
  "privateKey",
  "merchantCode",
  "baseUrl",
  "username",
  "authToken",
]);


const credentialsUpdateSchema = z.object({
  provider: PROVIDER_ENUM,
  field: credentialFieldEnum,
  /** String kosong = hapus override DB (jatuh balik ke env). */
  value: z.string().max(500),
});

/**
 * PUT /api/v1/admin/credentials
 *
 * Set / hapus satu field credential. Disimpan di SQLite, override .env.
 * Kirim `value: ""` untuk hapus override (jatuh balik ke env).
 */
adminRoutes.put(
  "/credentials",
  asyncHandler(async (req, res) => {
    const { provider, field, value } = credentialsUpdateSchema.parse(req.body);
    const allowedFields = CREDENTIAL_FIELDS_BY_PROVIDER[provider];
    if (!allowedFields.includes(field as CredentialField)) {
      throw new GatewayError(
        "INVALID_FIELD",
        `Field "${field}" tidak valid untuk provider ${provider}`,
        400,
      );
    }
    settingsStore.setCredential(provider, field as CredentialField, value);
    // Audit: catat fakta perubahan, JANGAN simpan value-nya (itu rahasia).
    recordAudit(req, {
      action: value === ""
        ? "admin.credentials.clear"
        : "admin.credentials.update",
      targetType: "credentials",
      targetId: `${provider}.${field}`,
      details: { provider, field, hasValue: value !== "" },
    });
    res.json({ data: settingsStore.credentialsSnapshot() });
  }),
);

/**
 * GET /api/v1/admin/system
 *
 * Snapshot system settings (rate limit, retry, CORS, trust proxy, client API
 * keys count). Field secret di-mask, hanya kirim jumlah & last-4.
 */
adminRoutes.get(
  "/system",
  asyncHandler(async (_req, res) => {
    res.json({ data: settingsStore.systemSnapshot() });
  }),
);

const systemUpdateSchema = z
  .object({
    /** null = hapus override (kembali ke env). Array string = set baru. */
    clientApiKeys: z.array(z.string().min(8).max(256)).nullable().optional(),
    corsOrigins: z.array(z.string().url().or(z.literal("*"))).nullable().optional(),
    rateLimit: z
      .object({
        windowMs: z.number().int().min(1000).max(60 * 60_000),
        max: z.number().int().min(1).max(100_000),
      })
      .nullable()
      .optional(),
    retry: z
      .object({
        maxAttempts: z.number().int().min(1).max(10),
        baseDelayMs: z.number().int().min(0).max(60_000),
      })
      .nullable()
      .optional(),
    trustProxy: z
      .union([z.boolean(), z.number().int().min(0), z.string()])
      .nullable()
      .optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "Minimal satu field harus diisi",
  });

/**
 * PATCH /api/v1/admin/system
 *
 * Update partial system settings. Pass `null` untuk hapus override
 * (kembali ke .env). Catatan: beberapa setting (CORS, trust proxy, rate-limit
 * window) butuh restart untuk fully apply karena dipakai middleware Express
 * saat startup. clientApiKeys langsung berlaku per-request.
 */
adminRoutes.patch(
  "/system",
  asyncHandler(async (req, res) => {
    const body = systemUpdateSchema.parse(req.body);
    const before = settingsStore.systemSnapshot();
    settingsStore.updateSystem(body);
    const after = settingsStore.systemSnapshot();

    // Audit — JANGAN catat value clientApiKeys mentah, hanya count.
    recordAudit(req, {
      action: "admin.system.update",
      targetType: "system",
      details: {
        fields: Object.keys(body),
        before: { ...before, clientApiKeys: { count: before.clientApiKeys.count } },
        after: { ...after, clientApiKeys: { count: after.clientApiKeys.count } },
      },
    });

    res.json({ data: after });
  }),
);

/**
 * GET /api/v1/admin/audit

 *
 * List audit log terbaru (default 100 entries, max 500).
 * Query: ?action=<filter>&targetId=<filter>&limit=<n>
 */
adminRoutes.get(
  "/audit",
  asyncHandler(async (req, res) => {
    const limit = parseInt(String(req.query.limit ?? "100"), 10) || 100;
    const action = req.query.action ? String(req.query.action) : undefined;
    const targetId = req.query.targetId ? String(req.query.targetId) : undefined;
    const data = auditLogStore.list({ limit, action, targetId });
    res.json({ data, total: auditLogStore.count() });
  }),
);

// ============================================================================
// OrderKuota — endpoint khusus untuk setup token + sync status
// ============================================================================

const orderkuotaRequestOtpSchema = z.object({
  username: z.string().min(1).max(120),
  password: z.string().min(1).max(255),
});

/**
 * POST /api/v1/admin/orderkuota/request-otp
 *
 * Step 1 dari flow login OrderKuota: minta OTP dikirim ke nomor terdaftar.
 * `password` = password aplikasi mobile OrderKuota (bukan password email).
 *
 * Hasil response biasanya berisi pesan "OTP telah dikirim ke 0812****".
 */
adminRoutes.post(
  "/orderkuota/request-otp",
  asyncHandler(async (req, res) => {
    const { username, password } = orderkuotaRequestOtpSchema.parse(req.body);
    const result = await OrderKuotaProvider.loginRequestOtp(username, password);
    recordAudit(req, {
      action: "admin.orderkuota.request-otp",
      targetType: "orderkuota",
      targetId: username,
      // Sengaja tidak catat password
      details: { username },
    });
    res.json({ data: result });
  }),
);

const orderkuotaExchangeOtpSchema = z.object({
  username: z.string().min(1).max(120),
  otp: z.string().min(4).max(20),
  /** Kalau true, otomatis save authToken yang dapat ke credentials store. */
  saveAsCredential: z.boolean().optional().default(true),
});

/**
 * POST /api/v1/admin/orderkuota/exchange-otp
 *
 * Step 2: tukar OTP dengan auth_token. Kalau `saveAsCredential: true` (default),
 * username + authToken otomatis disimpan ke credentials store (override .env).
 * Setelah ini, charge OrderKuota bisa langsung dipakai.
 */
adminRoutes.post(
  "/orderkuota/exchange-otp",
  asyncHandler(async (req, res) => {
    const { username, otp, saveAsCredential } =
      orderkuotaExchangeOtpSchema.parse(req.body);
    const result = await OrderKuotaProvider.loginExchangeOtp(username, otp);

    // Token biasanya ada di results.token atau results.auth_token
    const token =
      result?.results?.token ??
      result?.results?.auth_token ??
      result?.token ??
      "";

    if (saveAsCredential && token) {
      settingsStore.setCredential("orderkuota", "username", username);
      settingsStore.setCredential("orderkuota", "authToken", token);
    }

    recordAudit(req, {
      action: "admin.orderkuota.exchange-otp",
      targetType: "orderkuota",
      targetId: username,
      details: {
        username,
        saved: saveAsCredential && Boolean(token),
        success: Boolean(result?.success),
      },
    });

    res.json({
      data: {
        success: Boolean(result?.success),
        savedAsCredential: saveAsCredential && Boolean(token),
        raw: result,
      },
    });
  }),
);

/**
 * GET /api/v1/admin/orderkuota/mutasi
 *
 * DEBUG: ambil raw mutasi dari OrderKuota tanpa proses match. Berguna untuk
 * cek struktur response (field name aktual: jumlah/amount/value, dll) saat
 * sync tidak match.
 */
adminRoutes.get(
  "/orderkuota/mutasi",
  asyncHandler(async (_req, res) => {
    const username = settingsStore.getCredential("orderkuota", "username");
    const authToken = settingsStore.getCredential("orderkuota", "authToken");
    if (!username || !authToken) {
      throw new GatewayError(
        "BAD_REQUEST",
        "OrderKuota credentials belum diset",
        400,
      );
    }
    const raw = await OrderKuotaProvider.fetchMutasi(username, authToken);
    res.json({ data: raw });
  }),
);

/**
 * POST /api/v1/admin/orderkuota/sync

 *
 * Trigger pengecekan mutasi OrderKuota → match dengan transaksi pending → mark
 * sebagai success kalau cocok by amount + waktu. Pakai endpoint ini secara
 * scheduled (cron tiap 30 detik) atau on-demand dari dashboard.
 */
adminRoutes.post(
  "/orderkuota/sync",
  asyncHandler(async (req, res) => {
    const result = await syncOrderKuotaStatus();
    recordAudit(req, {
      action: "admin.orderkuota.sync",
      targetType: "orderkuota",
      details: {
        pending: result.pendingCount,
        matched: result.matched,
        mutasiCount: result.mutasiCount,
      },
    });
    res.json({ data: result });
  }),
);

async function safeHealth(fn: () => Promise<boolean>): Promise<boolean> {
  try {
    return await fn();
  } catch {
    return false;
  }
}




