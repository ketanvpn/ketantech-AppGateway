import { PaymentStatus, TransactionRecord } from "../types";
import { getDb } from "./db";

/**
 * Transaction store — backed by SQLite.
 * Mempertahankan API yang sama dengan in-memory version sebelumnya.
 */

interface Row {
  id: string;
  order_id: string;
  amount: number;
  currency: string;
  method: string;
  status: string;
  provider_name: string;
  provider_transaction_id: string | null;
  attempts_json: string;
  payment_url: string | null;
  raw_response_json: string | null;
  created_at: string;
  updated_at: string;
}

function rowToRecord(row: Row): TransactionRecord {
  return {
    id: row.id,
    orderId: row.order_id,
    amount: row.amount,
    currency: row.currency,
    method: row.method as TransactionRecord["method"],
    status: row.status as PaymentStatus,
    providerName: row.provider_name as TransactionRecord["providerName"],
    providerTransactionId: row.provider_transaction_id ?? "",
    attempts: JSON.parse(row.attempts_json),
    paymentUrl: row.payment_url ?? undefined,
    rawResponse: row.raw_response_json
      ? safeParse(row.raw_response_json)
      : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function safeParse(s: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

class TransactionStore {
  save(record: TransactionRecord): void {
    const db = getDb();
    const stmt = db.prepare(
      `INSERT INTO transactions
        (id, order_id, amount, currency, method, status,
         provider_name, provider_transaction_id, attempts_json,
         payment_url, raw_response_json,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         order_id = excluded.order_id,
         amount = excluded.amount,
         currency = excluded.currency,
         method = excluded.method,
         status = excluded.status,
         provider_name = excluded.provider_name,
         provider_transaction_id = excluded.provider_transaction_id,
         attempts_json = excluded.attempts_json,
         payment_url = excluded.payment_url,
         raw_response_json = excluded.raw_response_json,
         updated_at = excluded.updated_at`,
    );
    stmt.run(
      record.id,
      record.orderId,
      record.amount,
      record.currency,
      record.method,
      record.status,
      record.providerName,
      record.providerTransactionId || null,
      JSON.stringify(record.attempts),
      record.paymentUrl ?? null,
      record.rawResponse ? JSON.stringify(record.rawResponse) : null,
      record.createdAt,
      record.updatedAt,
    );
  }

  findById(id: string): TransactionRecord | undefined {
    const row = getDb()
      .prepare("SELECT * FROM transactions WHERE id = ?")
      .get(id) as Row | undefined;
    return row ? rowToRecord(row) : undefined;
  }

  findByOrderId(orderId: string): TransactionRecord | undefined {
    const row = getDb()
      .prepare(
        "SELECT * FROM transactions WHERE order_id = ? ORDER BY created_at DESC LIMIT 1",
      )
      .get(orderId) as Row | undefined;
    return row ? rowToRecord(row) : undefined;
  }

  findByProviderTransactionId(providerTxId: string): TransactionRecord | undefined {
    const row = getDb()
      .prepare(
        "SELECT * FROM transactions WHERE provider_transaction_id = ? LIMIT 1",
      )
      .get(providerTxId) as Row | undefined;
    return row ? rowToRecord(row) : undefined;
  }

  updateStatus(id: string, status: PaymentStatus): TransactionRecord | undefined {
    const now = new Date().toISOString();
    const result = getDb()
      .prepare(
        "UPDATE transactions SET status = ?, updated_at = ? WHERE id = ?",
      )
      .run(status, now, id);
    if (result.changes === 0) return undefined;
    return this.findById(id);
  }

  list(): TransactionRecord[] {
    const rows = getDb()
      .prepare("SELECT * FROM transactions ORDER BY created_at DESC")
      .all() as Row[];
    return rows.map(rowToRecord);
  }

  count(): number {
    const row = getDb()
      .prepare("SELECT COUNT(*) AS c FROM transactions")
      .get() as { c: number };
    return row.c;
  }

  clear(): void {
    getDb().exec("DELETE FROM transactions");
  }
}

export const transactionStore = new TransactionStore();
