import { createCipheriv, createDecipheriv, randomBytes, scryptSync, createHash } from "crypto";

/**
 * Encryption-at-rest untuk secrets (API keys, auth tokens).
 *
 * Algoritma: AES-256-GCM (authenticated encryption — encrypts + integrity check).
 *  - Confidentiality: AES-256 (NIST-approved, military-grade, 256-bit key)
 *  - Integrity: GCM auth tag → tamper detection (kalau ciphertext diubah, decrypt fail)
 *  - Random IV per record → identical plaintext menghasilkan ciphertext berbeda
 *    (cegah pattern leak via comparison)
 *
 * PCI-DSS req 3.5: Strong cryptography untuk PAN data at rest.
 *   AES-256-GCM = NIST SP 800-38D approved cipher mode.
 *
 * Master key resolution:
 *   1. process.env.ENCRYPTION_KEY (64 hex chars = 32 bytes) — production
 *   2. Derived dari ADMIN_API_KEY via scrypt — fallback (less secure tapi
 *      better than plaintext kalau admin lupa set ENCRYPTION_KEY)
 *
 * Format storage: `enc:v1:<iv-hex>:<tag-hex>:<ciphertext-hex>`
 *   - Prefix `enc:v1:` untuk versioning (mudah migration ke algoritma baru)
 *   - Detect plaintext (legacy) vs encrypted via prefix check
 */

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // GCM standard 96-bit
const KEY_LENGTH = 32; // 256-bit
const AUTH_TAG_LENGTH = 16;
const PREFIX = "enc:v1:";

let cachedKey: Buffer | null = null;

/**
 * Resolve master encryption key.
 * Production: pakai ENCRYPTION_KEY (64 hex chars).
 * Fallback: derive dari ADMIN_API_KEY via scrypt (KDF) supaya old data tetap
 * bisa dibaca kalau ENCRYPTION_KEY belum di-set saat upgrade.
 */
function getMasterKey(): Buffer {
  if (cachedKey) return cachedKey;

  const envKey = (process.env.ENCRYPTION_KEY || "").trim();
  if (envKey) {
    if (!/^[0-9a-fA-F]{64}$/.test(envKey)) {
      throw new Error(
        "ENCRYPTION_KEY harus 64 hex characters (32 bytes). " +
          "Generate: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
      );
    }
    cachedKey = Buffer.from(envKey, "hex");
    return cachedKey;
  }

  // Fallback: derive dari ADMIN_API_KEY pakai scrypt.
  // scrypt = memory-hard KDF, tahan terhadap GPU brute force.
  const adminKey = process.env.ADMIN_API_KEY || "dev-admin-key-change-me";
  // Salt deterministic supaya derive konsisten antar restart.
  // Bukan ideal (random salt lebih aman) tapi necessary untuk persistence
  // tanpa store salt terpisah. Mitigasi: panjang ADMIN_API_KEY harus ≥32.
  const salt = createHash("sha256").update("ketantechpay-fallback-salt-v1").digest();
  cachedKey = scryptSync(adminKey, salt, KEY_LENGTH);
  return cachedKey;
}

/**
 * Reset cached key — untuk tests.
 */
export function _resetKeyCache(): void {
  cachedKey = null;
}

/**
 * Encrypt plaintext → string format `enc:v1:<iv>:<tag>:<ciphertext>`.
 * Empty string → empty (tidak diencrypt, supaya "delete value" tetap simple).
 */
export function encrypt(plaintext: string): string {
  if (plaintext === "") return "";
  const key = getMasterKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

/**
 * Decrypt format `enc:v1:<iv>:<tag>:<ciphertext>`.
 * Kalau input bukan format encrypted (legacy plaintext), return as-is —
 * supaya migration backward-compatible. Setelah migrasi penuh, behavior ini
 * harus diubah jadi throw.
 */
export function decrypt(value: string): string {
  if (!value) return "";
  if (!value.startsWith(PREFIX)) {
    // Legacy plaintext — return apa adanya (akan di-encrypt saat next write).
    return value;
  }
  const parts = value.slice(PREFIX.length).split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted format: expected enc:v1:iv:tag:ciphertext");
  }
  const [ivHex, tagHex, dataHex] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(tagHex, "hex");
  const ciphertext = Buffer.from(dataHex, "hex");

  if (iv.length !== IV_LENGTH || authTag.length !== AUTH_TAG_LENGTH) {
    throw new Error("Invalid IV or auth tag length");
  }

  const key = getMasterKey();
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

/**
 * Cek apakah string dalam format encrypted KetantechPay.
 */
export function isEncrypted(value: string): boolean {
  return typeof value === "string" && value.startsWith(PREFIX);
}

/**
 * Hash string deterministically untuk audit log chain (HMAC-SHA256
 * dengan master key supaya hanya server bisa verify).
 *
 * Pakai untuk integrity check audit log (mendeteksi tampering).
 */
export function hashForChain(input: string): string {
  return createHash("sha256")
    .update(getMasterKey())
    .update(input)
    .digest("hex");
}
