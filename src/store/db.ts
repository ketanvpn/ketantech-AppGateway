import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config";
import { logger } from "../utils/logger";

/**
 * SQLite database singleton — pakai built-in `node:sqlite` (Node 22+, stable di 24).
 * Zero dependency, zero native compile. Cocok untuk single-instance deployment.
 *
 * Untuk produksi multi-instance / >1000 TPS: migrate ke PostgreSQL.
 */

let dbInstance: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (dbInstance) return dbInstance;

  const dbPath = config.databasePath;

  if (dbPath !== ":memory:") {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  dbInstance = new DatabaseSync(dbPath);
  dbInstance.exec("PRAGMA journal_mode = WAL");
  dbInstance.exec("PRAGMA foreign_keys = ON");

  initSchema(dbInstance);

  logger.info({ dbPath }, "SQLite database opened");
  return dbInstance;
}

function initSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      amount INTEGER NOT NULL,
      currency TEXT NOT NULL,
      method TEXT NOT NULL,
      status TEXT NOT NULL,
      provider_name TEXT NOT NULL,
      provider_transaction_id TEXT,
      attempts_json TEXT NOT NULL DEFAULT '[]',
      payment_url TEXT,
      raw_response_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_tx_order_id ON transactions(order_id);
    CREATE INDEX IF NOT EXISTS idx_tx_provider_tx_id ON transactions(provider_transaction_id);
    CREATE INDEX IF NOT EXISTS idx_tx_status ON transactions(status);
    CREATE INDEX IF NOT EXISTS idx_tx_created_at ON transactions(created_at DESC);

    CREATE TABLE IF NOT EXISTS idempotency (
      key TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      body_hash TEXT,
      response_status_code INTEGER,
      response_body_json TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_idem_created ON idempotency(created_at);


    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL
    );

    /*
     * Webhook events log — untuk strict deduplication.
     * Provider kadang resend webhook yang sama (misal karena timeout).
     * Kita simpan hash payload + provider sebagai unique key supaya
     * webhook duplikat tidak diproses ulang, bahkan kalau status sudah
     * berubah lagi sejak terakhir kali.
     */
    CREATE TABLE IF NOT EXISTS webhook_events (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      transaction_id TEXT,
      status TEXT NOT NULL,
      received_at TEXT NOT NULL,
      UNIQUE(provider, payload_hash)
    );
    CREATE INDEX IF NOT EXISTS idx_wh_tx_id ON webhook_events(transaction_id);
    CREATE INDEX IF NOT EXISTS idx_wh_received ON webhook_events(received_at DESC);

    /*
     * Audit log — operasi sensitif (refund, settings, credentials).
     * Append-only; jangan UPDATE/DELETE row yang sudah ada.
     * Untuk produksi yang serius, ship ke storage immutable (S3 + Object Lock).
     */
    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      action TEXT NOT NULL,
      actor TEXT NOT NULL,
      ip TEXT,
      target_type TEXT,
      target_id TEXT,
      details_json TEXT,
      at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);
    CREATE INDEX IF NOT EXISTS idx_audit_target ON audit_logs(target_type, target_id);
    CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_logs(at DESC);
  `);

  // ── Migrations ─────────────────────────────────────────────
  // CREATE TABLE IF NOT EXISTS tidak menambah kolom ke tabel yang sudah ada.
  // Untuk DB lama (pre-existing), kita ALTER TABLE secara idempotent.
  addColumnIfMissing(db, "transactions", "payment_url", "TEXT");
  addColumnIfMissing(db, "transactions", "raw_response_json", "TEXT");
}

/**
 * Tambah kolom kalau belum ada. Idempotent — aman dipanggil tiap startup.
 * Pakai PRAGMA table_info untuk cek existing columns.
 */
function addColumnIfMissing(
  db: DatabaseSync,
  table: string,
  column: string,
  type: string,
): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
    name: string;
  }>;
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    logger.info({ table, column, type }, "DB migration: column added");
  }
}



/**
 * Cek koneksi database — dipakai di health check.
 * Return true kalau query sederhana berhasil.
 */
export function pingDb(): boolean {
  try {
    const db = getDb();
    const row = db.prepare("SELECT 1 AS ok").get() as { ok: number } | undefined;
    return row?.ok === 1;
  } catch {
    return false;
  }
}


/** Tutup koneksi (untuk testing & shutdown). */
export function closeDb(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

/** Reset semua tabel — HANYA untuk testing. */
export function resetDbForTests(): void {
  const db = getDb();
  db.exec(`
    DELETE FROM transactions;
    DELETE FROM idempotency;
    DELETE FROM settings;
    DELETE FROM webhook_events;
    DELETE FROM audit_logs;
  `);
}



