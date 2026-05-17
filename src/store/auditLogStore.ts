import { randomUUID } from "crypto";
import { Request } from "express";
import { getDb } from "./db";
import { hashForChain } from "../utils/crypto";


/**
 * Audit log — append-only record untuk operasi sensitif.
 *
 * Action yang harus di-audit:
 *  - admin.refund: refund transaksi
 *  - admin.settings.update: ubah provider order / force-down
 *  - admin.credentials.update: set/hapus credential provider
 *  - admin.simulate-status: simulasi status (DEV-only)
 *
 * Catatan: SQLite tidak immutable. Di produksi sebaiknya ship juga ke
 * storage append-only (S3 + Object Lock, append-only log service).
 */

export interface AuditLogEntry {
  id: string;
  action: string;
  actor: string;
  ip: string | null;
  targetType: string | null;
  targetId: string | null;
  details: Record<string, unknown> | null;
  at: string;
}

interface Row {
  id: string;
  action: string;
  actor: string;
  ip: string | null;
  target_type: string | null;
  target_id: string | null;
  details_json: string | null;
  at: string;
}

class AuditLogStore {
  /**
   * Catat satu entry audit dengan **hash chain** untuk tamper detection.
   * Return id entry yang baru dibuat.
   *
   * Hash chain:
   *  - prev_hash = entry_hash dari row terakhir (atau "0..0" untuk row pertama)
   *  - entry_hash = HMAC-SHA256(masterKey, prev_hash + content)
   *
   * Kalau attacker dengan write access ke gateway.db menghapus/mengubah row,
   * `verifyChain()` akan detect karena chain pecah.
   *
   * Catatan: ini bukan substitute untuk immutable storage. Untuk PCI-DSS / SOC2
   * level, ship juga ke S3 + Object Lock. Hash chain di sini = first line of
   * defense supaya admin yang punya DB write access tidak bisa silently edit log.
   */
  record(params: {
    action: string;
    actor: string;
    ip?: string | null;
    targetType?: string;
    targetId?: string;
    details?: Record<string, unknown>;
  }): string {
    const id = randomUUID();
    const at = new Date().toISOString();
    const detailsJson = params.details ? JSON.stringify(params.details) : null;

    // Get prev hash (last entry by `at` order)
    const lastRow = getDb()
      .prepare(
        "SELECT entry_hash FROM audit_logs ORDER BY at DESC LIMIT 1",
      )
      .get() as { entry_hash: string | null } | undefined;
    const prevHash = lastRow?.entry_hash ?? "0".repeat(64);

    // Compute entry_hash dari prev_hash + canonical content
    const content = [
      id,
      params.action,
      params.actor,
      params.ip ?? "",
      params.targetType ?? "",
      params.targetId ?? "",
      detailsJson ?? "",
      at,
    ].join("|");
    const entryHash = hashForChain(prevHash + "|" + content);

    getDb()
      .prepare(
        `INSERT INTO audit_logs
           (id, action, actor, ip, target_type, target_id, details_json, at, prev_hash, entry_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        params.action,
        params.actor,
        params.ip ?? null,
        params.targetType ?? null,
        params.targetId ?? null,
        detailsJson,
        at,
        prevHash,
        entryHash,
      );
    return id;
  }

  /**
   * Verify integrity audit log chain dari awal.
   * Return jumlah row yang gagal verify (0 = clean).
   */
  verifyChain(): { totalEntries: number; tamperedEntries: string[] } {
    const rows = getDb()
      .prepare(
        `SELECT id, action, actor, ip, target_type, target_id, details_json, at,
                prev_hash, entry_hash
         FROM audit_logs ORDER BY at ASC`,
      )
      .all() as Array<
      Row & { prev_hash: string | null; entry_hash: string | null }
    >;

    const tampered: string[] = [];
    let expectedPrev = "0".repeat(64);

    for (const row of rows) {
      // Pre-migration entries tidak punya hash — skip
      if (!row.entry_hash || !row.prev_hash) continue;

      const content = [
        row.id,
        row.action,
        row.actor,
        row.ip ?? "",
        row.target_type ?? "",
        row.target_id ?? "",
        row.details_json ?? "",
        row.at,
      ].join("|");
      const expectedHash = hashForChain(row.prev_hash + "|" + content);

      if (row.entry_hash !== expectedHash || row.prev_hash !== expectedPrev) {
        tampered.push(row.id);
      }
      expectedPrev = row.entry_hash;
    }

    return { totalEntries: rows.length, tamperedEntries: tampered };
  }


  list(opts: { limit?: number; action?: string; targetId?: string } = {}): AuditLogEntry[] {
    const limit = Math.min(opts.limit ?? 100, 500);
    const conds: string[] = [];
    const args: (string | number)[] = [];
    if (opts.action) {
      conds.push("action = ?");
      args.push(opts.action);
    }
    if (opts.targetId) {
      conds.push("target_id = ?");
      args.push(opts.targetId);
    }
    args.push(limit);
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const rows = getDb()
      .prepare(
        `SELECT * FROM audit_logs ${where} ORDER BY at DESC LIMIT ?`,
      )
      .all(...args) as Row[];
    return rows.map(rowToEntry);
  }


  count(): number {
    const row = getDb()
      .prepare("SELECT COUNT(*) AS c FROM audit_logs")
      .get() as { c: number };
    return row.c;
  }
}

function rowToEntry(row: Row): AuditLogEntry {
  return {
    id: row.id,
    action: row.action,
    actor: row.actor,
    ip: row.ip,
    targetType: row.target_type,
    targetId: row.target_id,
    details: row.details_json ? JSON.parse(row.details_json) : null,
    at: row.at,
  };
}

export const auditLogStore = new AuditLogStore();

/**
 * Helper untuk catat dari handler express — pull IP dari request.
 */
export function recordAudit(
  req: Request,
  params: {
    action: string;
    actor?: string;
    targetType?: string;
    targetId?: string;
    details?: Record<string, unknown>;
  },
): string {
  return auditLogStore.record({
    action: params.action,
    actor: params.actor ?? "admin",
    ip: req.ip ?? null,
    targetType: params.targetType,
    targetId: params.targetId,
    details: params.details,
  });
}
