export type ProviderName = "midtrans" | "xendit" | "doku" | "tripay" | "orderkuota" | "autogopay";


export type PaymentMethod = "credit_card" | "bank_transfer" | "ewallet" | "qris";

export type PaymentStatus =
  | "pending"
  | "success"
  | "failed"
  | "expired"
  | "refunded";

export interface ChargeRequest {
  orderId: string;
  amount: number;
  currency: string;
  method: PaymentMethod;
  customer: {
    name: string;
    email: string;
    phone?: string;
  };
  description?: string;
}

export interface ChargeResult {
  providerName: ProviderName;
  providerTransactionId: string;
  status: PaymentStatus;
  amount: number;
  currency: string;
  paymentUrl?: string;
  rawResponse: Record<string, unknown>;
}

export interface WebhookEvent {
  /** order id dari sisi merchant */
  orderId: string;
  /** transaction id dari provider */
  providerTransactionId: string;
  /** status setelah event ini */
  status: PaymentStatus;
  rawPayload: Record<string, unknown>;
}

export interface PaymentProvider {
  readonly name: ProviderName;
  isHealthy(): Promise<boolean>;
  charge(req: ChargeRequest): Promise<ChargeResult>;
  getStatus(providerTransactionId: string): Promise<PaymentStatus>;
  /**
   * Verifikasi signature webhook menggunakan raw body & header.
   * Return true jika valid.
   */
  verifyWebhook(rawBody: Buffer, headers: Record<string, string | undefined>): boolean;
  /** Parse webhook payload menjadi event terstandarisasi. */
  parseWebhook(payload: Record<string, unknown>): WebhookEvent;
}

export interface TransactionRecord {
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
  /** URL gambar QRIS / link pembayaran (provider-dependent). */
  paymentUrl?: string;
  /** Raw response dari provider — buat debugging. Untuk QRIS, isi qris_data dll. */
  rawResponse?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}


export class GatewayError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode: number = 500,
    public details?: unknown,
  ) {
    super(message);
    this.name = "GatewayError";
  }
}

export class ProviderError extends Error {
  constructor(
    public providerName: ProviderName,
    message: string,
    public retriable: boolean = true,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
