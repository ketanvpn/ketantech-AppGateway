import {
  CredentialField,
  CredentialsSnapshot,
  Pagination,
  PaymentMethod,
  PaymentStatus,
  ProviderName,
  Settings,
  Stats,
  SystemSettingsPatch,
  SystemSettingsSnapshot,
  Transaction,
} from "./types";



export const API_BASE =
  typeof window !== "undefined"
    ? window.localStorage.getItem("apiBase") || "http://localhost:3000"
    : "http://localhost:3000";

const ADMIN_KEY_STORAGE = "adminApiKey";
const API_BASE_STORAGE = "apiBase";

export function getAdminKey(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(ADMIN_KEY_STORAGE) || "";
}

export function setAdminKey(key: string): void {
  window.localStorage.setItem(ADMIN_KEY_STORAGE, key);
}

export function getApiBase(): string {
  if (typeof window === "undefined") return "http://localhost:3000";
  return window.localStorage.getItem(API_BASE_STORAGE) || "http://localhost:3000";
}

export function setApiBase(url: string): void {
  window.localStorage.setItem(API_BASE_STORAGE, url);
}

class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function adminFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const key = getAdminKey();
  const base = getApiBase();
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-Admin-Key": key,
      ...(init.headers || {}),
    },
  });

  const text = await res.text();
  const body = text ? JSON.parse(text) : {};

  if (!res.ok) {
    throw new ApiError(
      res.status,
      body.error || "REQUEST_FAILED",
      body.message || res.statusText,
    );
  }
  return body as T;
}

export const api = {
  ApiError,

  async getStats(): Promise<Stats> {
    const r = await adminFetch<{ data: Stats }>("/api/v1/admin/stats");
    return r.data;
  },

  async listTransactions(params: {
    page?: number;
    pageSize?: number;
    status?: PaymentStatus | "";
    provider?: ProviderName | "";
    orderId?: string;
    /** ISO date string atau "" — filter createdAt >= from */
    from?: string;
    /** ISO date string atau "" — filter createdAt <= to */
    to?: string;
  }): Promise<{ data: Transaction[]; pagination: Pagination }> {
    const q = new URLSearchParams();
    if (params.page) q.set("page", String(params.page));
    if (params.pageSize) q.set("pageSize", String(params.pageSize));
    if (params.status) q.set("status", params.status);
    if (params.provider) q.set("provider", params.provider);
    if (params.orderId) q.set("orderId", params.orderId);
    if (params.from) q.set("from", params.from);
    if (params.to) q.set("to", params.to);
    return adminFetch(`/api/v1/admin/transactions?${q.toString()}`);
  },

  /**
   * Build URL untuk download CSV transactions. Tidak fetch — caller pakai
   * URL ini di window.location atau anchor.download. Filter sama dengan
   * listTransactions (kecuali pagination — export return semua yang match).
   *
   * Catatan: karena admin key di header, kita perlu fetch + blob download
   * di client (tidak bisa simple <a href>).
   */
  async exportTransactionsCsv(params: {
    status?: PaymentStatus | "";
    provider?: ProviderName | "";
    orderId?: string;
    from?: string;
    to?: string;
  }): Promise<Blob> {
    const q = new URLSearchParams();
    if (params.status) q.set("status", params.status);
    if (params.provider) q.set("provider", params.provider);
    if (params.orderId) q.set("orderId", params.orderId);
    if (params.from) q.set("from", params.from);
    if (params.to) q.set("to", params.to);

    const base = getApiBase();
    const key = getAdminKey();
    const res = await fetch(
      `${base}/api/v1/admin/transactions/export.csv?${q.toString()}`,
      { headers: { "X-Admin-Key": key } },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new ApiError(
        res.status,
        "EXPORT_FAILED",
        body || res.statusText,
      );
    }
    return res.blob();
  },


  async getTransaction(id: string): Promise<Transaction> {
    const r = await adminFetch<{ data: Transaction }>(
      `/api/v1/admin/transactions/${encodeURIComponent(id)}`,
    );
    return r.data;
  },

  /** DEV only — simulasi webhook untuk test status transition. */
  async simulateStatus(
    id: string,
    status: PaymentStatus,
  ): Promise<Transaction> {
    const r = await adminFetch<{ data: Transaction }>(
      `/api/v1/admin/transactions/${encodeURIComponent(id)}/simulate-status`,
      {
        method: "POST",
        body: JSON.stringify({ status }),
      },
    );
    return r.data;
  },

  /**
   * Pull-status dari provider — alternatif untuk webhook resend.
   * Berguna kalau webhook provider gagal nyampe & transaksi nyangkut pending.
   * OrderKuota tidak support — pakai orderkuotaSync() untuk match by mutasi.
   */
  async refreshStatus(id: string): Promise<{
    data: Transaction;
    meta: { previousStatus: string; currentStatus: string; changed: boolean };
  }> {
    return adminFetch<{
      data: Transaction;
      meta: { previousStatus: string; currentStatus: string; changed: boolean };
    }>(
      `/api/v1/admin/transactions/${encodeURIComponent(id)}/refresh-status`,
      { method: "POST" },
    );
  },

  /** Refund transaksi yang sudah success. Idempotent. */
  async refund(id: string): Promise<Transaction> {

    const r = await adminFetch<{ data: Transaction }>(
      `/api/v1/admin/transactions/${encodeURIComponent(id)}/refund`,
      { method: "POST" },
    );
    return r.data;
  },



  async getSettings(): Promise<Settings> {
    const r = await adminFetch<{ data: Settings }>("/api/v1/admin/settings");
    return r.data;
  },

  async updateSettings(patch: Partial<Settings>): Promise<Settings> {
    const r = await adminFetch<{ data: Settings }>("/api/v1/admin/settings", {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    return r.data;
  },

  /** Ambil snapshot credentials (secrets dimask) per provider. */
  async getCredentials(): Promise<CredentialsSnapshot> {
    const r = await adminFetch<{ data: CredentialsSnapshot }>(
      "/api/v1/admin/credentials",
    );
    return r.data;
  },

  /**
   * Set / hapus satu field credential. `value` kosong = hapus override DB
   * (jatuh balik ke .env).
   */
  async updateCredential(
    provider: ProviderName,
    field: CredentialField,
    value: string,
  ): Promise<CredentialsSnapshot> {
    const r = await adminFetch<{ data: CredentialsSnapshot }>(
      "/api/v1/admin/credentials",
      {
        method: "PUT",
        body: JSON.stringify({ provider, field, value }),
      },
    );
    return r.data;
  },

  /** Ambil snapshot system settings (rate limit, retry, CORS, dll). */
  async getSystem(): Promise<SystemSettingsSnapshot> {
    const r = await adminFetch<{ data: SystemSettingsSnapshot }>(
      "/api/v1/admin/system",
    );
    return r.data;
  },

  /**
   * Update partial system settings.
   * Pass `null` ke field untuk hapus override (kembali ke .env).
   */
  async updateSystem(patch: SystemSettingsPatch): Promise<SystemSettingsSnapshot> {
    const r = await adminFetch<{ data: SystemSettingsSnapshot }>(
      "/api/v1/admin/system",
      {
        method: "PATCH",
        body: JSON.stringify(patch),
      },
    );
    return r.data;
  },

  // ── OrderKuota ────────────────────────────────────────────────

  /** Step 1 OrderKuota: minta OTP dikirim ke nomor terdaftar. */
  async orderkuotaRequestOtp(
    username: string,
    password: string,
  ): Promise<unknown> {
    const r = await adminFetch<{ data: unknown }>(
      "/api/v1/admin/orderkuota/request-otp",
      {
        method: "POST",
        body: JSON.stringify({ username, password }),
      },
    );
    return r.data;
  },

  /**
   * Step 2 OrderKuota: tukar OTP dengan auth token.
   * Default `saveAsCredential: true` — token otomatis disimpan ke credentials.
   */
  async orderkuotaExchangeOtp(
    username: string,
    otp: string,
    saveAsCredential = true,
  ): Promise<{ success: boolean; savedAsCredential: boolean; raw: unknown }> {
    const r = await adminFetch<{ data: any }>(
      "/api/v1/admin/orderkuota/exchange-otp",
      {
        method: "POST",
        body: JSON.stringify({ username, otp, saveAsCredential }),
      },
    );
    return r.data;
  },

  /**
   * Trigger sync mutasi → match dengan transaksi pending.
   * Return statistik (pending, matched, mutasi count).
   */
  async orderkuotaSync(): Promise<{
    pendingCount: number;
    matched: number;
    mutasiCount: number;
    updated: Array<{
      transactionId: string;
      orderId: string;
      amount: number;
      matchedMutasiId: string;
    }>;
  }> {
    const r = await adminFetch<{ data: any }>(
      "/api/v1/admin/orderkuota/sync",
      { method: "POST" },
    );
    return r.data;
  },




  /**
   * Test charge dari dashboard — pakai admin endpoint supaya tidak perlu input
   * X-Client-Key manual di UI. Integrasi eksternal tetap pakai /payments/charge.
   */
  async testCharge(payload: {
    orderId: string;
    amount: number;
    currency: string;
    method: PaymentMethod;
    customer: { name: string; email: string; phone?: string };
    description?: string;
  }): Promise<Transaction> {
    const r = await adminFetch<{ data: Transaction }>(
      "/api/v1/admin/test-charge",
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
    );
    return r.data;
  },
};
