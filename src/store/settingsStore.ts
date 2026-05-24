import { ProviderName } from "../types";
import { config } from "../config";
import { getDb } from "./db";
import { encrypt, decrypt } from "../utils/crypto";
import { logger } from "../utils/logger";
import { validateProviderBaseUrl } from "../utils/ssrfGuard";



const VALID_PROVIDERS: ProviderName[] = [
  "midtrans",
  "xendit",
  "doku",
  "tripay",
  "orderkuota",
  "autogopay",
];

const isValid = (n: string): n is ProviderName =>
  (VALID_PROVIDERS as string[]).includes(n);

const KEY_ORDER = "providerOrder";
const KEY_FORCE_DOWN = "forceDown";
const KEY_CREDENTIALS = "credentials";
const KEY_SYSTEM = "system";

/**
 * System-level settings yang bisa diatur runtime dari dashboard.
 * Field yang null = pakai default dari .env / config.
 */
export interface SystemSettings {
  /** Daftar API key untuk client/aplikasi internal (multi-tenant). */
  clientApiKeys: string[];
  /** Origin yang diizinkan CORS (array). */
  corsOrigins: string[];
  /** Rate limit untuk endpoint /payments. */
  rateLimit: { windowMs: number; max: number };
  /** Retry policy. */
  retry: { maxAttempts: number; baseDelayMs: number };
  /** Trust proxy: boolean | number hop | CIDR string. */
  trustProxy: boolean | number | string;
}


/**
 * Field credentials per provider yang boleh diset dari dashboard.
 * Disimpan dalam SQLite, jadi tidak hilang saat restart.
 * Field yang tidak diset akan fallback ke env (.env).
 */
export type CredentialField =
  | "serverKey"
  | "secretKey"
  | "callbackToken"
  | "clientId"
  | "apiKey"
  | "privateKey"
  | "merchantCode"
  | "baseUrl"
  | "username"
  | "authToken";

export const CREDENTIAL_FIELDS_BY_PROVIDER: Record<
  ProviderName,
  CredentialField[]
> = {
  midtrans: ["serverKey", "baseUrl"],
  xendit: ["secretKey", "callbackToken", "baseUrl"],
  doku: ["clientId", "secretKey", "baseUrl"],
  tripay: ["apiKey", "privateKey", "merchantCode", "baseUrl"],
  // OrderKuota tidak punya server key — pakai username + authToken (dari OTP login)
  orderkuota: ["username", "authToken", "baseUrl"],
  autogopay: ["apiKey", "baseUrl"],
};

const SECRET_FIELDS: ReadonlySet<CredentialField> = new Set([
  "serverKey",
  "secretKey",
  "callbackToken",
  "privateKey",
  "apiKey",
  "authToken",
]);


/** Mask secret saat ditampilkan: keep 4 char terakhir, sisanya bintang. */
export function maskSecret(value: string | undefined): string {
  if (!value) return "";
  if (value.length <= 4) return "*".repeat(value.length);
  return "*".repeat(Math.min(8, value.length - 4)) + value.slice(-4);
}

export type CredentialsMap = Partial<
  Record<ProviderName, Partial<Record<CredentialField, string>>>
>;


/**
 * Settings runtime — persisted ke SQLite.
 * Saat boot:
 *   - Kalau ada record di DB, pakai itu.
 *   - Kalau tidak, pakai default dari env (PROVIDER_ORDER, *_FORCE_DOWN).
 *
 * Perubahan dari dashboard otomatis tersimpan, jadi survive restart.
 */
class SettingsStore {
  private _providerOrder!: ProviderName[];
  private _forceDown!: Record<ProviderName, boolean>;
  private _credentials!: CredentialsMap;
  /**
   * Override system settings dari DB. Field yang tidak ada di sini
   * akan fallback ke nilai dari config (.env).
   */
  private _systemOverride!: Partial<SystemSettings>;
  private _initialized = false;


  private ensureInit(): void {
    if (this._initialized) return;
    const db = getDb();

    const orderRow = db
      .prepare("SELECT value_json FROM settings WHERE key = ?")
      .get(KEY_ORDER) as { value_json: string } | undefined;
    const forceDownRow = db
      .prepare("SELECT value_json FROM settings WHERE key = ?")
      .get(KEY_FORCE_DOWN) as { value_json: string } | undefined;
    const credRow = db
      .prepare("SELECT value_json FROM settings WHERE key = ?")
      .get(KEY_CREDENTIALS) as { value_json: string } | undefined;
    const sysRow = db
      .prepare("SELECT value_json FROM settings WHERE key = ?")
      .get(KEY_SYSTEM) as { value_json: string } | undefined;


    if (orderRow) {
      this._providerOrder = JSON.parse(orderRow.value_json) as ProviderName[];
    } else {
      this._providerOrder = config.providerOrder.filter(isValid);
      if (this._providerOrder.length === 0) {
        this._providerOrder = [...VALID_PROVIDERS];
      }
      this.persist(KEY_ORDER, this._providerOrder);
    }

    if (forceDownRow) {
      this._forceDown = JSON.parse(forceDownRow.value_json);
      // Pastikan semua provider ada di map (kalau ada yang baru ditambahkan)
      for (const name of VALID_PROVIDERS) {
        if (!(name in this._forceDown)) {
          this._forceDown[name] = false;
        }
      }
    } else {
      this._forceDown = {
        midtrans: config.mock.midtransForceDown,
        xendit: config.mock.xenditForceDown,
        doku: config.mock.dokuForceDown,
        tripay: config.mock.tripayForceDown,
        orderkuota: config.mock.orderkuotaForceDown,
        autogopay: config.mock.autogopayForceDown,
      };
      this.persist(KEY_FORCE_DOWN, this._forceDown);
    }


    this._credentials = credRow
      ? (JSON.parse(credRow.value_json) as CredentialsMap)
      : {};

    this._systemOverride = sysRow
      ? (JSON.parse(sysRow.value_json) as Partial<SystemSettings>)
      : {};

    this._initialized = true;
  }

  /**
   * Resolved system settings — DB override (kalau ada) dengan fallback ke env.
   * Semua getter di tempat lain pakai ini supaya perubahan via dashboard
   * langsung berlaku tanpa restart.
   */
  getSystem(): SystemSettings {
    this.ensureInit();
    const o = this._systemOverride;
    return {
      clientApiKeys: o.clientApiKeys ?? [...config.clientApiKeys],
      corsOrigins:
        o.corsOrigins ??
        config.corsOrigin
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      rateLimit: o.rateLimit ?? { ...config.rateLimit },
      retry: o.retry ?? { ...config.retry },
      trustProxy: o.trustProxy ?? config.trustProxy,
    };
  }

  /**
   * Snapshot system settings untuk dashboard.
   * Tiap field punya `source` (db | env) supaya UI tahu mana yang di-override.
   * Client API keys di-mask, hanya kirim count + last-4 untuk identifikasi.
   */
  systemSnapshot(): {
    clientApiKeys: {
      count: number;
      previews: string[];
      source: "db" | "env";
    };
    corsOrigins: { value: string[]; source: "db" | "env" };
    rateLimit: { value: { windowMs: number; max: number }; source: "db" | "env" };
    retry: { value: { maxAttempts: number; baseDelayMs: number }; source: "db" | "env" };
    trustProxy: { value: boolean | number | string; source: "db" | "env" };
  } {
    this.ensureInit();
    const o = this._systemOverride;
    const r = this.getSystem();
    return {
      clientApiKeys: {
        count: r.clientApiKeys.length,
        previews: r.clientApiKeys.map((k) => maskSecret(k)),
        source: o.clientApiKeys !== undefined ? "db" : "env",
      },
      corsOrigins: {
        value: r.corsOrigins,
        source: o.corsOrigins !== undefined ? "db" : "env",
      },
      rateLimit: {
        value: r.rateLimit,
        source: o.rateLimit !== undefined ? "db" : "env",
      },
      retry: {
        value: r.retry,
        source: o.retry !== undefined ? "db" : "env",
      },
      trustProxy: {
        value: r.trustProxy,
        source: o.trustProxy !== undefined ? "db" : "env",
      },
    };
  }

  /**
   * Update partial system settings. Kalau field tidak diset di payload,
   * tidak diubah. Kalau di-set null, override dihapus (kembali ke env).
   */
  updateSystem(patch: {
    clientApiKeys?: string[] | null;
    corsOrigins?: string[] | null;
    rateLimit?: { windowMs: number; max: number } | null;
    retry?: { maxAttempts: number; baseDelayMs: number } | null;
    trustProxy?: boolean | number | string | null;
  }): void {
    this.ensureInit();
    for (const key of Object.keys(patch) as (keyof typeof patch)[]) {
      const val = patch[key];
      if (val === null) {
        delete this._systemOverride[key];
      } else if (val !== undefined) {
        // Type assertion karena TS tidak bisa narrow union tanpa per-key check.
        (this._systemOverride as Record<string, unknown>)[key] = val;
      }
    }
    this.persist(KEY_SYSTEM, this._systemOverride);
  }


  /**
   * Resolved credential — DB override (kalau ada) dengan fallback ke env.
   * Untuk dipakai provider saat charge / verify webhook.
   *
   * Secret fields (apiKey, secretKey, dst) di-stored AES-256-GCM encrypted.
   * Saat read, otomatis di-decrypt. Legacy plaintext (sebelum encryption
   * diaktifkan) masih bisa dibaca — akan di-encrypt saat next write.
   */
  getCredential(provider: ProviderName, field: CredentialField): string {
    this.ensureInit();
    const fromDb = this._credentials[provider]?.[field];
    if (fromDb !== undefined && fromDb !== "") {
      if (SECRET_FIELDS.has(field)) {
        try {
          return decrypt(fromDb);
        } catch (err) {
          logger.error(
            { provider, field, err: (err as Error).message },
            "Failed to decrypt credential — possible tampering or wrong ENCRYPTION_KEY",
          );
          // Fallback ke env supaya gateway tidak break total kalau ada
          // corruption di DB. Operator harus segera fix.
          return readEnvCredential(provider, field);
        }
      }
      return fromDb;
    }
    return readEnvCredential(provider, field);
  }


  /**
   * Snapshot credentials untuk ditampilkan di dashboard.
   * Field secret di-mask. Setiap field ada flag `source` (db|env|empty).
   */
  credentialsSnapshot(): Record<
    ProviderName,
    Record<
      string,
      { value: string; isSecret: boolean; source: "db" | "env" | "empty" }
    >
  > {
    this.ensureInit();
    const out = {} as Record<
      ProviderName,
      Record<
        string,
        { value: string; isSecret: boolean; source: "db" | "env" | "empty" }
      >
    >;
    for (const provider of VALID_PROVIDERS) {
      const fields = CREDENTIAL_FIELDS_BY_PROVIDER[provider];
      const provOut: Record<
        string,
        { value: string; isSecret: boolean; source: "db" | "env" | "empty" }
      > = {};
      for (const f of fields) {
        const dbVal = this._credentials[provider]?.[f];
        const envVal = readEnvCredential(provider, f);
        const isSecret = SECRET_FIELDS.has(f);
        let source: "db" | "env" | "empty" = "empty";
        let resolved = "";
        if (dbVal !== undefined && dbVal !== "") {
          source = "db";
          resolved = dbVal;
        } else if (envVal) {
          source = "env";
          resolved = envVal;
        }
        provOut[f] = {
          value: resolved
            ? isSecret
              ? maskSecret(resolved)
              : resolved
            : "",
          isSecret,
          source,
        };
      }
      out[provider] = provOut;
    }
    return out;
  }

  /**
   * Set / hapus credential. Pass `value` empty string untuk hapus dari DB
   * (akan jatuh balik ke env).
   *
   * Security:
   * - Secret fields (apiKey, secretKey, dst) di-encrypt AES-256-GCM sebelum
   *   masuk DB (PCI-DSS req 3.4 — encryption at rest).
   * - baseUrl di-validasi: hanya https/http public, BUKAN private IP /
   *   localhost / cloud metadata endpoints (cegah SSRF — OWASP A10).
   */
  setCredential(
    provider: ProviderName,
    field: CredentialField,
    value: string,
  ): void {
    this.ensureInit();
    if (!CREDENTIAL_FIELDS_BY_PROVIDER[provider].includes(field)) {
      throw new Error(`Field ${field} tidak valid untuk ${provider}`);
    }

    // Validate baseUrl untuk cegah SSRF — provider HTTP call akan hit URL ini
    if (field === "baseUrl" && value !== "") {
      validateProviderBaseUrl(value);
    }

    if (!this._credentials[provider]) this._credentials[provider] = {};
    if (value === "") {
      delete this._credentials[provider]![field];
      if (Object.keys(this._credentials[provider]!).length === 0) {
        delete this._credentials[provider];
      }
    } else {
      // Encrypt at rest untuk secret fields
      const stored = SECRET_FIELDS.has(field) ? encrypt(value) : value;
      this._credentials[provider]![field] = stored;
    }
    this.persist(KEY_CREDENTIALS, this._credentials);
  }



  private persist(key: string, value: unknown): void {
    getDb()
      .prepare(
        `INSERT INTO settings (key, value_json) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`,
      )
      .run(key, JSON.stringify(value));
  }

  get providerOrder(): readonly ProviderName[] {
    this.ensureInit();
    return this._providerOrder;
  }

  setProviderOrder(order: ProviderName[]): void {
    this.ensureInit();
    if (order.length === 0) throw new Error("provider order tidak boleh kosong");
    this._providerOrder = [...order];
    this.persist(KEY_ORDER, this._providerOrder);
  }

  isForceDown(name: ProviderName): boolean {
    this.ensureInit();
    return this._forceDown[name] ?? false;
  }

  setForceDown(name: ProviderName, v: boolean): void {
    this.ensureInit();
    this._forceDown[name] = v;
    this.persist(KEY_FORCE_DOWN, this._forceDown);
  }

  // Backward-compat
  get midtransForceDown(): boolean {
    return this.isForceDown("midtrans");
  }
  setMidtransForceDown(v: boolean): void {
    this.setForceDown("midtrans", v);
  }
  get xenditForceDown(): boolean {
    return this.isForceDown("xendit");
  }
  setXenditForceDown(v: boolean): void {
    this.setForceDown("xendit", v);
  }
  get dokuForceDown(): boolean {
    return this.isForceDown("doku");
  }
  setDokuForceDown(v: boolean): void {
    this.setForceDown("doku", v);
  }
  get tripayForceDown(): boolean {
    return this.isForceDown("tripay");
  }
  setTripayForceDown(v: boolean): void {
    this.setForceDown("tripay", v);
  }

  snapshot() {
    this.ensureInit();
    return {
      providerOrder: [...this._providerOrder],
      forceDown: { ...this._forceDown },
      midtransForceDown: this._forceDown.midtrans,
      xenditForceDown: this._forceDown.xendit,
      dokuForceDown: this._forceDown.doku,
      tripayForceDown: this._forceDown.tripay,
    };
  }

  /**
   * Reset cached state — dipakai di tests setelah `resetDbForTests()`.
   */
  _resetForTests(): void {
    this._initialized = false;
  }
}

export const settingsStore = new SettingsStore();

/**
 * Baca credential dari config (yang sudah load .env).
 * Return string kosong kalau env tidak diset.
 */
function readEnvCredential(
  provider: ProviderName,
  field: CredentialField,
): string {
  const cfg = config[provider] as Record<string, string> | undefined;
  if (!cfg) return "";
  const v = cfg[field];
  return typeof v === "string" ? v : "";
}



/**
 * Telegram bot settings
 */
const KEY_TELEGRAM = "telegram";

export interface TelegramSettings {
  botToken?: string;
  adminChatIds?: string[];
}

export function getTelegramSettings(): TelegramSettings {
  const db = getDb();
  const row = db.prepare("SELECT value_json FROM settings WHERE key = ?").get(KEY_TELEGRAM) as { value_json: string } | undefined;

  if (!row) return {};

  try {
    const parsed = JSON.parse(row.value_json) as TelegramSettings;
    // Decrypt bot token jika ada
    if (parsed.botToken) {
      parsed.botToken = decrypt(parsed.botToken);
    }
    return parsed;
  } catch {
    return {};
  }
}

export function setTelegramSettings(settings: TelegramSettings): void {
  const db = getDb();

  // Encrypt bot token sebelum simpan
  const toStore: TelegramSettings = { ...settings };
  if (toStore.botToken) {
    toStore.botToken = encrypt(toStore.botToken);
  }

  db.prepare(
    `INSERT INTO settings (key, value_json) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`
  ).run(KEY_TELEGRAM, JSON.stringify(toStore));

  logger.info("Telegram settings updated in database");
}
