import { randomUUID } from "crypto";
import { Request } from "express";
import { getDb } from "./db";

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
   * Catat satu entry audit. Return id entry yang baru dibuat.
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
    getDb()
      .prepare(
        `INSERT INTO audit_logs
           (id, action, actor, ip, target_type, target_id, details_json, at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        params.action,
        params.actor,
        params.ip ?? null,
        params.targetType ?? null,
        params.targetId ?? null,
        params.details ? JSON.stringify(params.details) : null,
        at,
      );
    return id;
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
