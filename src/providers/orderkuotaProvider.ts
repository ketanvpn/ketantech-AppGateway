import {
  ChargeRequest,
  ChargeResult,
  PaymentProvider,
  PaymentStatus,
  ProviderError,
  WebhookEvent,
} from "../types";
import { config } from "../config";
import { settingsStore } from "../store/settingsStore";
import { logger } from "../utils/logger";

/**
 * OrderKuota provider — wrapper untuk app.orderkuota.com QRIS.
 *
 * Beda dari provider lain:
 *  - Tidak ada concept "server key" dengan API key model. Auth pakai
 *    `auth_username` + `auth_token` yang didapat dari OTP login (mobile app).
 *  - **Tidak ada webhook**. Provider tidak push update ke kita.
 *    Status update lewat polling endpoint `mutasi/qris` (lihat
 *    `syncOrderKuotaStatus()` di service).
 *  - Hanya support QRIS. Method lain langsung di-reject.
 *
 * Reference: dokumen PHP `orderkuota-api-php/index.php`.
 *
 * Catatan: ini integrasi unofficial yang reverse-engineer mobile app.
 * Bisa berubah / break tiap kali OrderKuota update aplikasi mereka.
 * Untuk production yang serius, prefer Midtrans/Xendit yang punya API resmi.
 */
export class OrderKuotaProvider implements PaymentProvider {
  readonly name = "orderkuota" as const;

  // Konstanta dari mobile app — di-extract dari dokumen PHP referensi.
  // Update ini jika OrderKuota update aplikasi mobile mereka.
  static readonly APP_VERSION_NAME = "26.01.15";
  static readonly APP_VERSION_CODE = "260115";
  static readonly USER_AGENT = "okhttp/4.12.0";
  static readonly APP_REG_ID =
    "cdzXkBynRECkAODZEHwkeV:APA91bHRyLlgNSlpVrC4Yv3xBgRRaePSaCYruHnNwrEK8_pX3kzitxzi0CxIDFc2oztCwcw7-zPgwE-6v_-rJCJdTX8qE_ADiSnWHNeZ5O7_BIlgS_1N8tw";
  static readonly PHONE_MODEL = "23124RA7EO";
  static readonly PHONE_UUID = "cdzXkBynRECkAODZEHwkeV";
  static readonly PHONE_ANDROID_VERSION = "15";
  static readonly STATIC_SIGNATURE =
    "944d749d04f80642bcbffe4e2c3b84ba91b1cfe28d68c0fb51bd90a666ff645cc17281a50b67190c047ed55b541d3ea181bf5606e02ab9275155c8669154fe28";

  async isHealthy(): Promise<boolean> {
    if (settingsStore.isForceDown("orderkuota")) return false;
    const username = settingsStore.getCredential("orderkuota", "username");
    const token = settingsStore.getCredential("orderkuota", "authToken");
    if (!username || !token) return false;

    // Cache hasil probe selama 30 detik supaya health check tidak nge-spam
    // OrderKuota di tiap request `/health/providers`. Token expired biasanya
    // kelihatan dari mutasi call gagal — hasil di-cache di memory.
    const now = Date.now();
    if (
      OrderKuotaProvider._healthCache &&
      now - OrderKuotaProvider._healthCache.at < 30_000
    ) {
      return OrderKuotaProvider._healthCache.healthy;
    }

    let healthy = false;
    try {
      const resp = await OrderKuotaProvider.fetchMutasi(username, token);
      // Sukses berarti token valid & API reachable.
      healthy = Boolean(resp?.success ?? resp?.qris_history);
    } catch {
      healthy = false;
    }
    OrderKuotaProvider._healthCache = { healthy, at: now };
    return healthy;
  }

  /** Cache hasil health probe (in-memory, per-instance). */
  private static _healthCache: { healthy: boolean; at: number } | null = null;


  async charge(req: ChargeRequest): Promise<ChargeResult> {
    if (settingsStore.isForceDown("orderkuota")) {
      throw new ProviderError(
        this.name,
        "OrderKuota is currently down (forced)",
        true,
      );
    }
    if (req.method !== "qris") {
      throw new ProviderError(
        this.name,
        "OrderKuota hanya support method 'qris'",
        false,
      );
    }

    const username = settingsStore.getCredential("orderkuota", "username");
    const token = settingsStore.getCredential("orderkuota", "authToken");
    if (!username || !token) {
      throw new ProviderError(
        this.name,
        "OrderKuota credentials (username/authToken) belum diset",
        false,
      );
    }

    const baseUrl =
      settingsStore.getCredential("orderkuota", "baseUrl") ||
      config.orderkuota.baseUrl;

    const requestTime = Date.now();
    const body = new URLSearchParams({
      request_time: String(requestTime),
      app_reg_id: OrderKuotaProvider.APP_REG_ID,
      phone_android_version: OrderKuotaProvider.PHONE_ANDROID_VERSION,
      app_version_code: OrderKuotaProvider.APP_VERSION_CODE,
      phone_uuid: OrderKuotaProvider.PHONE_UUID,
      auth_username: username,
      auth_token: token,
      "requests[qris_merchant_terms][jumlah]": String(req.amount),
      "requests[0]": "qris_merchant_terms",
      app_version_name: OrderKuotaProvider.APP_VERSION_NAME,
      phone_model: OrderKuotaProvider.PHONE_MODEL,
    });

    let resp: Response;
    try {
      resp = await fetch(`${baseUrl}/get`, {
        method: "POST",
        headers: {
          "User-Agent": OrderKuotaProvider.USER_AGENT,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      throw new ProviderError(
        this.name,
        `Network error to OrderKuota: ${(err as Error).message}`,
        true,
      );
    }

    if (!resp.ok) {
      throw new ProviderError(
        this.name,
        `OrderKuota HTTP ${resp.status}`,
        resp.status >= 500,
      );
    }

    const json = (await resp.json()) as Record<string, any>;

    if (!json.success) {
      // Auth bermasalah / token expired
      const msg = JSON.stringify(json);
      const retriable = !/auth|token|login/i.test(msg);
      throw new ProviderError(
        this.name,
        `OrderKuota generateQr failed: ${msg}`,
        retriable,
      );
    }

    const qrisData = json?.qris_merchant_terms?.results?.qris_data;
    if (!qrisData) {
      throw new ProviderError(
        this.name,
        "OrderKuota tidak return qris_data",
        true,
      );
    }

    const reference = `OK-${requestTime}-${req.orderId.slice(0, 12)}`;

    // Inject amount ke QRIS string (static QRIS → dynamic) + recompute CRC16.
    // Reference: dokumen PHP createQRIS().
    const dynamicQris = injectAmountToQris(qrisData, req.amount);

    // Generate URL gambar QR via api.qrserver.com (gratis, no auth).
    // Note: untuk production yang harus tetap available walau service ini down,
    // pertimbangkan render QR di sisi frontend pakai library `qrcode` di-browser.
    const qrImageUrl =
      "https://api.qrserver.com/v1/create-qr-code/?" +
      new URLSearchParams({
        size: "400x400",
        margin: "20",
        data: dynamicQris,
      }).toString();

    logger.debug(
      { provider: this.name, reference, orderId: req.orderId },
      "charged",
    );

    return {
      providerName: this.name,
      providerTransactionId: reference,
      status: "pending",
      amount: req.amount,
      currency: req.currency,
      // URL siap di-render <img src=...> di frontend.
      paymentUrl: qrImageUrl,
      rawResponse: {
        reference,
        qris_data: qrisData,
        qris_dynamic: dynamicQris,
        qr_image_url: qrImageUrl,
        amount: req.amount,
        request_time: requestTime,
        full: json.qris_merchant_terms?.results,
      },
    };
  }


  /**
   * OrderKuota tidak ada GET status untuk satu transaksi.
   * Kita pakai endpoint mutasi (history) dan match by amount + waktu di
   * `services/orderkuotaSyncService.ts`. Method ini selalu return pending.
   */
  async getStatus(_providerTransactionId: string): Promise<PaymentStatus> {
    return "pending";
  }

  /**
   * OrderKuota tidak punya webhook. Method ini selalu reject — webhook route
   * mestinya tidak terpanggil untuk provider ini. Sync via polling, bukan push.
   */
  verifyWebhook(): boolean {
    logger.warn(
      { provider: this.name },
      "OrderKuota tidak support webhook, gunakan endpoint sync",
    );
    return false;
  }

  parseWebhook(_payload: Record<string, unknown>): WebhookEvent {
    throw new ProviderError(
      this.name,
      "OrderKuota tidak support webhook",
      false,
    );
  }

  // ============================================================================
  // Helper khusus OrderKuota — dipakai oleh sync service & admin login.
  // ============================================================================

  /**
   * Login OTP step 1 — minta OTP via OrderKuota mobile API.
   * `password` = password app OrderKuota (bukan password akun email).
   *
   * Response biasanya berisi pesan "OTP sudah dikirim ke..." kalau sukses.
   */
  static async loginRequestOtp(
    username: string,
    password: string,
  ): Promise<Record<string, any>> {
    return this.callLogin(username, password);
  }

  /**
   * Login OTP step 2 — tukar OTP code dengan auth_token.
   * Pakai endpoint yang sama dengan step 1, tapi field "password" diisi OTP.
   */
  static async loginExchangeOtp(
    username: string,
    otp: string,
  ): Promise<Record<string, any>> {
    return this.callLogin(username, otp);
  }

  private static async callLogin(
    username: string,
    passwordOrOtp: string,
  ): Promise<Record<string, any>> {
    const requestTime = Date.now();
    const body = new URLSearchParams({
      username,
      password: passwordOrOtp,
      request_time: String(requestTime),
      app_reg_id: this.APP_REG_ID,
      phone_android_version: this.PHONE_ANDROID_VERSION,
      app_version_code: this.APP_VERSION_CODE,
      phone_uuid: this.PHONE_UUID,
    });

    const resp = await fetch(`${config.orderkuota.baseUrl}/login`, {
      method: "POST",
      headers: {
        "User-Agent": this.USER_AGENT,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
      signal: AbortSignal.timeout(15_000),
    });

    if (!resp.ok) {
      throw new Error(`OrderKuota login HTTP ${resp.status}`);
    }
    return (await resp.json()) as Record<string, any>;
  }

  /**
   * Ambil mutasi QRIS terbaru. Dipakai untuk match pending transaction
   * dengan pembayaran yang sudah masuk.
   */
  static async fetchMutasi(
    username: string,
    authToken: string,
  ): Promise<Record<string, any>> {
    const resellerId = authToken.split(":")[0];
    const requestTime = Date.now();
    const body = new URLSearchParams({
      app_reg_id: this.APP_REG_ID,
      phone_uuid: this.PHONE_UUID,
      phone_model: this.PHONE_MODEL,
      "requests[qris_history][keterangan]": "",
      "requests[qris_history][jumlah]": "",
      request_time: String(requestTime),
      phone_android_version: this.PHONE_ANDROID_VERSION,
      app_version_code: this.APP_VERSION_CODE,
      auth_username: username,
      "requests[qris_history][page]": "1",
      auth_token: authToken,
      app_version_name: this.APP_VERSION_NAME,
      ui_mode: "light",
      "requests[qris_history][dari_tanggal]": "",
      "requests[0]": "account",
      "requests[qris_history][ke_tanggal]": "",
    });

    const resp = await fetch(
      `${config.orderkuota.baseUrl}/qris/mutasi/${resellerId}`,
      {
        method: "POST",
        headers: {
          "User-Agent": this.USER_AGENT,
          "Content-Type": "application/x-www-form-urlencoded",
          signature: this.STATIC_SIGNATURE,
          timestamp: String(requestTime),
        },
        body: body.toString(),
        signal: AbortSignal.timeout(15_000),
      },
    );

    if (!resp.ok) {
      throw new Error(`OrderKuota mutasi HTTP ${resp.status}`);
    }
    return (await resp.json()) as Record<string, any>;
  }
}

// ============================================================================
// QRIS helpers — port dari dokumen PHP `createQRIS()` & `convertCRC16()`.
// ============================================================================

/**
 * Inject amount ke QRIS string (static → dynamic), recompute CRC16 di akhir.
 *
 * Algoritma (dari dokumen PHP):
 *  1. Drop 4 char terakhir (CRC lama).
 *  2. Replace tag "010211" (static) dengan "010212" (dynamic).
 *  3. Insert tag amount sebelum "5802ID":
 *     - Tag "54" + len(2 digit) + amount string + "5802ID"
 *  4. Compute CRC16-CCITT-FALSE (poly 0x1021, init 0xFFFF) dari hasil + append.
 *
 * Reference: spesifikasi QRIS Bank Indonesia + dokumen PHP referensi.
 */
function injectAmountToQris(qrisData: string, amount: number): string {
  const amtStr = String(Math.round(amount));
  // Step 1 + 2
  const withoutCrc = qrisData.slice(0, -4);
  const dynamic = withoutCrc.replace("010211", "010212");
  // Step 3: insert amount tag before 5802ID
  const parts = dynamic.split("5802ID");
  if (parts.length !== 2) {
    // Format tidak terduga — kembalikan as-is biar tidak break charge,
    // QR-nya cuma tidak akan punya amount embed.
    return qrisData;
  }
  const amountTag =
    "54" + amtStr.length.toString().padStart(2, "0") + amtStr + "5802ID";
  const merged = parts[0] + amountTag + parts[1];
  // Step 4: append CRC16
  return merged + crc16Ccitt(merged);
}

/**
 * CRC16/CCITT-FALSE — polynomial 0x1021, initial 0xFFFF, no reflection.
 * Sesuai dengan implementasi `convertCRC16()` di dokumen PHP referensi.
 */
function crc16Ccitt(input: string): string {
  let crc = 0xffff;
  for (let i = 0; i < input.length; i++) {
    crc ^= input.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}


