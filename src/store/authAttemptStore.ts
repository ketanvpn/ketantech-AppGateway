import { getDb } from "./db";
import { logger } from "../utils/logger";

/**
 * Authentication attempt tracker untuk lockout setelah N failed login.
 *
 * Why: Per-IP rate-limit (express-rate-limit) bisa di-bypass kalau attacker
 * pakai botnet / proxy rotator. Lockout *per resource* (misal admin API key
 * fingerprint) lebih kuat — kalau ADMIN_API_KEY salah 5x dalam 15 menit
 * dari IP manapun, akun di-block 15 menit.
 *
 * PCI-DSS req 8.1.6: Limit failed login attempts to maximum of 6 attempts.
 * Saat ini default 10 attempts dalam 15 menit (lebih ketat dari minimum
 * PCI-DSS). Lockout duration 15 menit (PCI-DSS 8.1.7 minimum 30 menit).
 *
 * Resource ID: untuk admin auth, pakai SHA256 hash dari ADMIN_API_KEY supaya
 * tidak simpan plaintext. Kalau attacker brute force dengan ADMIN_API_KEY salah,
 * mereka tidak bisa enumerate karena tiap kombinasi key tidak ditrack.
 * Kita track *attempt counter* per IP (untuk anti brute force IP) plus
 * per resource (admin endpoint = "admin" sebagai resource id).
 */

const MAX_FAILED_ATTEMPTS = parseInt(
  process.env.AUTH_MAX_FAILED_ATTEMPTS || "10",
  10,
);
const LOCKOUT_WINDOW_MS = parseInt(
  process.env.AUTH_LOCKOUT_WINDOW_MS || String(15 * 60_000),
  10,
);
const LOCKOUT_DURATION_MS = parseInt(
  process.env.AUTH_LOCKOUT_DURATION_MS || String(15 * 60_000),
  10,
);

interface AttemptRow {
  id: string;
  resource: string;
  ip: string;
  count: number;
  first_at: number;
  locked_until: number | null;
}

class AuthAttemptStore {
  private ensureSchema(): void {
    getDb().exec(`
      CREATE TABLE IF NOT EXISTS auth_attempts (
        id TEXT PRIMARY KEY,
        resource TEXT NOT NULL,
        ip TEXT NOT NULL,
        count INTEGER NOT NULL DEFAULT 0,
        first_at INTEGER NOT NULL,
        locked_until INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_auth_attempts_resource_ip
        ON auth_attempts (resource, ip);
    `);
  }

  /**
   * Cek apakah IP sedang ter-lockout untuk resource ini.
   * Return remaining lockout duration in seconds, atau 0 kalau tidak.
   */
  isLocked(resource: string, ip: string): number {
    this.ensureSchema();
    const id = `${resource}:${ip}`;
    const row = getDb()
      .prepare("SELECT * FROM auth_attempts WHERE id = ?")
      .get(id) as AttemptRow | undefined;
    if (!row || !row.locked_until) return 0;
    if (row.locked_until <= Date.now()) {
      // Lockout expired — clear
      this.reset(resource, ip);
      return 0;
    }
    return Math.ceil((row.locked_until - Date.now()) / 1000);
  }

  /**
   * Catat satu kegagalan auth. Kalau threshold tercapai, set lockout.
   * Return true kalau sekarang ter-lock (caller harus block request).
   */
  recordFailure(resource: string, ip: string): boolean {
    this.ensureSchema();
    const id = `${resource}:${ip}`;
    const now = Date.now();
    const row = getDb()
      .prepare("SELECT * FROM auth_attempts WHERE id = ?")
      .get(id) as AttemptRow | undefined;

    let newCount = 1;
    let firstAt = now;

    if (row) {
      // Reset counter kalau window sudah lewat
      if (now - row.first_at > LOCKOUT_WINDOW_MS) {
        newCount = 1;
        firstAt = now;
      } else {
        newCount = row.count + 1;
        firstAt = row.first_at;
      }
    }

    const lockedUntil =
      newCount >= MAX_FAILED_ATTEMPTS ? now + LOCKOUT_DURATION_MS : null;

    getDb()
      .prepare(
        `INSERT INTO auth_attempts (id, resource, ip, count, first_at, locked_until)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           count = excluded.count,
           first_at = excluded.first_at,
           locked_until = excluded.locked_until`,
      )
      .run(id, resource, ip, newCount, firstAt, lockedUntil);

    if (lockedUntil) {
      logger.warn(
        { resource, ip, count: newCount, lockoutMinutes: LOCKOUT_DURATION_MS / 60_000 },
        "Auth lockout triggered — too many failed attempts",
      );
      return true;
    }
    return false;
  }

  /**
   * Reset counter (call setelah login sukses, atau saat lockout expired).
   */
  reset(resource: string, ip: string): void {
    this.ensureSchema();
    const id = `${resource}:${ip}`;
    getDb().prepare("DELETE FROM auth_attempts WHERE id = ?").run(id);
  }

  /** Cleanup entries lama (dipanggil periodically atau di startup). */
  pruneExpired(): void {
    this.ensureSchema();
    const cutoff = Date.now() - LOCKOUT_WINDOW_MS - LOCKOUT_DURATION_MS;
    getDb()
      .prepare(
        "DELETE FROM auth_attempts WHERE first_at < ? AND (locked_until IS NULL OR locked_until < ?)",
      )
      .run(cutoff, Date.now());
  }

  clear(): void {
    this.ensureSchema();
    getDb().exec("DELETE FROM auth_attempts");
  }
}

export const authAttemptStore = new AuthAttemptStore();

export const AUTH_LOCKOUT_CONFIG = {
  maxFailedAttempts: MAX_FAILED_ATTEMPTS,
  lockoutWindowMs: LOCKOUT_WINDOW_MS,
  lockoutDurationMs: LOCKOUT_DURATION_MS,
};
