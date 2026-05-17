import { encrypt, decrypt, isEncrypted, _resetKeyCache } from "../src/utils/crypto";
import { settingsStore } from "../src/store/settingsStore";
import { resetDbForTests } from "../src/store/db";

describe("Encryption (AES-256-GCM)", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    resetDbForTests();
    settingsStore._resetForTests();
    _resetKeyCache();
    process.env.ENCRYPTION_KEY =
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
    _resetKeyCache();
  });

  it("encrypts and decrypts plaintext correctly", () => {
    const plaintext = "Mid-server-very-secret-key-12345";
    const encrypted = encrypt(plaintext);
    expect(encrypted).toMatch(/^enc:v1:[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
    expect(encrypted).not.toContain(plaintext);
    expect(decrypt(encrypted)).toBe(plaintext);
  });

  it("produces different ciphertext for identical plaintext (random IV)", () => {
    const plaintext = "same-secret";
    const e1 = encrypt(plaintext);
    const e2 = encrypt(plaintext);
    expect(e1).not.toBe(e2); // Random IV → different ciphertext
    expect(decrypt(e1)).toBe(plaintext);
    expect(decrypt(e2)).toBe(plaintext);
  });

  it("detects tampering via GCM auth tag", () => {
    const encrypted = encrypt("secret");
    // Flip last byte of ciphertext
    const tampered = encrypted.slice(0, -2) + (encrypted.slice(-2) === "00" ? "01" : "00");
    expect(() => decrypt(tampered)).toThrow();
  });

  it("returns plaintext as-is for legacy un-encrypted values (backward compat)", () => {
    const legacyValue = "Mid-server-old-plaintext";
    expect(isEncrypted(legacyValue)).toBe(false);
    expect(decrypt(legacyValue)).toBe(legacyValue);
  });

  it("rejects invalid ENCRYPTION_KEY format", () => {
    process.env.ENCRYPTION_KEY = "invalid";
    _resetKeyCache();
    expect(() => encrypt("x")).toThrow(/64 hex characters/);
  });

  it("encrypts secret credentials in settingsStore", () => {
    const SECRET = "Mid-server-test-key-7c3a8e9b";
    settingsStore.setCredential("midtrans", "serverKey", SECRET);

    // Read raw from DB (bypass getCredential decryption)
    const { getDb } = require("../src/store/db");
    const row = getDb()
      .prepare("SELECT value_json FROM settings WHERE key = 'credentials'")
      .get() as { value_json: string };
    const stored = JSON.parse(row.value_json);
    const storedValue = stored.midtrans.serverKey;

    expect(isEncrypted(storedValue)).toBe(true);
    expect(storedValue).not.toContain(SECRET);

    // Read via getCredential should decrypt back to original
    expect(settingsStore.getCredential("midtrans", "serverKey")).toBe(SECRET);
  });

  it("does NOT encrypt non-secret fields (baseUrl)", () => {
    settingsStore.setCredential("midtrans", "baseUrl", "https://api.midtrans.com");
    const { getDb } = require("../src/store/db");
    const row = getDb()
      .prepare("SELECT value_json FROM settings WHERE key = 'credentials'")
      .get() as { value_json: string };
    const stored = JSON.parse(row.value_json);
    expect(stored.midtrans.baseUrl).toBe("https://api.midtrans.com");
    expect(isEncrypted(stored.midtrans.baseUrl)).toBe(false);
  });
});
