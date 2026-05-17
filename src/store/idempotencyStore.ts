import { getDb } from "./db";

/**
 * Idempotency store — backed by SQLite.
 * Mencegah double-charge saat client retry request yang sama.
 *
 * TTL: 24 jam. Entry kadaluarsa diabaikan saat get().
 */
const TTL_MS = 24 * 60 * 60 * 1000;

interface IdempotencyEntry {
  status: "in_progress" | "completed";
  bodyHash?: string;
  response?: { statusCode: number; body: unknown };
  createdAt: number;
}

interface Row {
  key: string;
  status: "in_progress" | "completed";
  body_hash: string | null;
  response_status_code: number | null;
  response_body_json: string | null;
  created_at: number;
}

class IdempotencyStore {
  get(key: string): IdempotencyEntry | undefined {
    const row = getDb()
      .prepare("SELECT * FROM idempotency WHERE key = ?")
      .get(key) as Row | undefined;
    if (!row) return undefined;

    if (Date.now() - row.created_at > TTL_MS) {
      this.release(key);
      return undefined;
    }

    return {
      status: row.status,
      bodyHash: row.body_hash ?? undefined,
      response:
        row.response_status_code !== null && row.response_body_json !== null
          ? {
              statusCode: row.response_status_code,
              body: JSON.parse(row.response_body_json),
            }
          : undefined,
      createdAt: row.created_at,
    };
  }

  /**
   * Atomically claim an idempotency key.
   * Return true kalau berhasil claim (caller harus proses request),
   * false kalau key sudah dipakai (caller harus get() dulu).
   *
   * Pakai INSERT OR IGNORE supaya atomic — race condition antara dua
   * request bersamaan dengan key sama tidak akan menyebabkan double-charge.
   *
   * Catatan: kalau entry expired (>24h TTL), get() akan release() dulu jadi
   * caller bisa retry begin().
   */
  begin(key: string, bodyHash?: string): boolean {
    const result = getDb()
      .prepare(
        `INSERT OR IGNORE INTO idempotency (key, status, body_hash, created_at)
         VALUES (?, 'in_progress', ?, ?)`,
      )
      .run(key, bodyHash ?? null, Date.now());
    return (result.changes ?? 0) > 0;
  }


  complete(key: string, statusCode: number, body: unknown): void {
    getDb()
      .prepare(
        `UPDATE idempotency
           SET status = 'completed',
               response_status_code = ?,
               response_body_json = ?
         WHERE key = ?`,
      )
      .run(statusCode, JSON.stringify(body), key);
  }

  release(key: string): void {
    getDb().prepare("DELETE FROM idempotency WHERE key = ?").run(key);
  }

  clear(): void {
    getDb().exec("DELETE FROM idempotency");
  }
}

export const idempotencyStore = new IdempotencyStore();
