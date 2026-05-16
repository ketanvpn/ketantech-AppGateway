import { createHash, randomUUID } from "crypto";
import { ProviderName } from "../types";
import { getDb } from "./db";

/**
 * Webhook event store — strict deduplication berdasarkan hash dari raw body.
 *
 * Kenapa ini penting?
 * - Provider kadang resend webhook yang sama (timeout di sisi mereka).
 * - Tanpa dedup, kita bisa proses event yang sama 2x (misal log ganda,
 *   notifikasi ke aplikasi internal terkirim 2x).
 * - WebhookService lama hanya idempotent berdasar status terkini transaksi,
 *   tapi kalau status sudah berubah ke `failed` lalu webhook `success` lama
 *   nyangkut lagi, terminal-status check-nya akan benar tapi event tetap
 *   terhitung "ignored". Dedup di level event lebih akurat.
 */

export interface WebhookEventRecord {
  id: string;
  provider: ProviderName;
  payloadHash: string;
  transactionId: string | null;
  status: string;
  receivedAt: string;
}

export function hashPayload(rawBody: Buffer): string {
  return createHash("sha256").update(new Uint8Array(rawBody)).digest("hex");
}

class WebhookEventStore {
  /**
   * Coba simpan event baru. Return record yang baru disimpan,
   * atau `null` kalau (provider, payloadHash) sudah ada (= duplicate).
   */
  insertIfNew(params: {
    provider: ProviderName;
    payloadHash: string;
    transactionId: string | null;
    status: string;
  }): WebhookEventRecord | null {
    const id = randomUUID();
    const receivedAt = new Date().toISOString();
    try {
      const stmt = getDb().prepare(
        `INSERT INTO webhook_events
           (id, provider, payload_hash, transaction_id, status, received_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      stmt.run(
        id,
        params.provider,
        params.payloadHash,
        params.transactionId,
        params.status,
        receivedAt,
      );
      return {
        id,
        provider: params.provider,
        payloadHash: params.payloadHash,
        transactionId: params.transactionId,
        status: params.status,
        receivedAt,
      };
    } catch (err: unknown) {
      // SQLite UNIQUE constraint violation = duplicate.
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("UNIQUE") || msg.includes("constraint")) {
        return null;
      }
      throw err;
    }
  }

  findByHash(
    provider: ProviderName,
    payloadHash: string,
  ): WebhookEventRecord | undefined {
    const row = getDb()
      .prepare(
        `SELECT id, provider, payload_hash AS payloadHash,
                transaction_id AS transactionId, status, received_at AS receivedAt
           FROM webhook_events
          WHERE provider = ? AND payload_hash = ?
          LIMIT 1`,
      )
      .get(provider, payloadHash) as WebhookEventRecord | undefined;
    return row ?? undefined;
  }

  clear(): void {
    getDb().exec("DELETE FROM webhook_events");
  }
}

export const webhookEventStore = new WebhookEventStore();
