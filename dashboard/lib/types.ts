export type ProviderName =
  | "midtrans"
  | "xendit"
  | "doku"
  | "tripay"
  | "orderkuota"
  | "autogopay";

export const ALL_PROVIDERS: ProviderName[] = [
  "midtrans",
  "xendit",
  "doku",
  "tripay",
  "orderkuota",
  "autogopay",
];


export type PaymentStatus =
  | "pending"
  | "success"
  | "failed"
  | "expired"
  | "refunded";

export type PaymentMethod =
  | "credit_card"
  | "bank_transfer"
  | "ewallet"
  | "qris";

export interface Transaction {
  id: string;
  orderId: string;
  amount: number;
  currency: string;
  method: PaymentMethod;
  status: PaymentStatus;
  providerName: ProviderName;
  providerTransactionId: string;
  attempts: Array<{
    providerName: ProviderName;
    success: boolean;
    error?: string;
    at: string;
  }>;
  /** URL gambar QR / link checkout. Untuk OrderKuota, ini URL gambar QRIS. */
  paymentUrl?: string;
  /** Raw response dari provider (debugging). Untuk QRIS, isi qris_dynamic dll. */
  rawResponse?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}


export interface Stats {
  totalTransactions: number;
  totalAmountSuccess: number;
  successRate: number;
  byStatus: Record<PaymentStatus, number>;
  byProvider: Record<string, number>;
  providerHealth: Array<{ name: ProviderName; healthy: boolean }>;
}

export interface Settings {
  providerOrder: ProviderName[];
  forceDown: Record<ProviderName, boolean>;
}

export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export type CredentialField =
  | "serverKey"
  | "secretKey"
  | "callbackToken"
  | "clientId"
  | "apiKey"
  | "privateKey"
  | "merchantCode"
  | "baseUrl"
  | "username"
  | "authToken";


export interface CredentialFieldInfo {
  value: string; // sudah di-mask kalau secret
  isSecret: boolean;
  source: "db" | "env" | "empty";
}

export type CredentialsSnapshot = Record<
  ProviderName,
  Partial<Record<CredentialField, CredentialFieldInfo>>
>;

/** Field yang relevan per provider — untuk render form. */
export const FIELDS_BY_PROVIDER: Record<ProviderName, CredentialField[]> = {
  midtrans: ["serverKey", "baseUrl"],
  xendit: ["secretKey", "callbackToken", "baseUrl"],
  doku: ["clientId", "secretKey", "baseUrl"],
  tripay: ["apiKey", "privateKey", "merchantCode", "baseUrl"],
  orderkuota: ["username", "authToken", "baseUrl"],
  autogopay: ["apiKey", "baseUrl"],
};

export const FIELD_LABELS: Record<CredentialField, string> = {
  serverKey: "Server Key",
  secretKey: "Secret Key",
  callbackToken: "Callback Token",
  clientId: "Client ID",
  apiKey: "API Key",
  privateKey: "Private Key",
  merchantCode: "Merchant Code",
  baseUrl: "Base URL",
  username: "Username",
  authToken: "Auth Token",
};


/** Snapshot system settings dari /api/v1/admin/system. */
export interface SystemSettingsSnapshot {
  clientApiKeys: {
    count: number;
    previews: string[];
    source: "db" | "env";
  };
  corsOrigins: { value: string[]; source: "db" | "env" };
  rateLimit: {
    value: { windowMs: number; max: number };
    source: "db" | "env";
  };
  retry: {
    value: { maxAttempts: number; baseDelayMs: number };
    source: "db" | "env";
  };
  trustProxy: {
    value: boolean | number | string;
    source: "db" | "env";
  };
}

export interface SystemSettingsPatch {
  clientApiKeys?: string[] | null;
  corsOrigins?: string[] | null;
  rateLimit?: { windowMs: number; max: number } | null;
  retry?: { maxAttempts: number; baseDelayMs: number } | null;
  trustProxy?: boolean | number | string | null;
}

export interface WebhookTarget {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  events?: PaymentStatus[];
  secretMasked?: string;
}


