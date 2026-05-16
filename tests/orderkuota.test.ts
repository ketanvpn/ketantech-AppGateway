import { syncOrderKuotaStatus } from "../src/services/orderkuotaSyncService";
import { transactionStore } from "../src/store/transactionStore";
import { settingsStore } from "../src/store/settingsStore";
import { OrderKuotaProvider } from "../src/providers/orderkuotaProvider";
import { resetDbForTests } from "../src/store/db";

/**
 * Tests untuk OrderKuota integration (provider, helper, sync service).
 *
 * `fetchMutasi` di-mock di test ini supaya tidak hit OrderKuota beneran.
 * Yang kita test:
 *  - QRIS amount injection + CRC16
 *  - Sync match logic (amount + timestamp + status IN)
 *  - Edge cases: no credentials, no pending, multi-match
 */

describe("OrderKuota integration", () => {
  beforeEach(() => {
    resetDbForTests();
    // Set credential supaya sync tidak skip
    settingsStore.setCredential("orderkuota", "username", "user-test");
    settingsStore.setCredential("orderkuota", "authToken", "1234:tok-abc");
  });

  // ── QRIS injection ────────────────────────────────────────
  describe("QRIS createQRIS / CRC16", () => {
    // Static QRIS contoh dari spec QRIS BI (sederhana): 010211 + merchant info
    // + 5802ID + akhir CRC. Kita pakai sample yang valid.
    const STATIC_QRIS =
      "00020101021126570011ID.DANA.WWW011893600914000000000002092500000035303360540510.005802ID5910Test Toko6007Jakarta61101012061290";

    it("converts static QRIS to dynamic with embedded amount", () => {
      // charge() bersifat private internal; kita test via flow charge + intercept
      // Tapi `injectAmountToQris` adalah private function — verifikasi via
      // hasil paymentUrl dari charge mock.
      // Untuk unit test murni, kita inline reimplement & validate output struct.
      const dynamic = inlineInjectAmount(STATIC_QRIS, 50000);

      // Tag "010212" harus ada (dynamic)
      expect(dynamic).toContain("010212");
      // Tag amount "54" + len + value harus ada sebelum 5802ID
      expect(dynamic).toMatch(/540550000.*5802ID/);
      // Panjang akhir = panjang awal - 4 (drop CRC) + tag amount + 4 (new CRC)
      // Tag amount: "54" + "05" + "50000" = 9 chars
      expect(dynamic.length).toBe(STATIC_QRIS.length - 4 + 9 + 4);
    });

    it("CRC16-CCITT-FALSE produces 4-char uppercase hex", () => {
      const crc = inlineCrc16("test");
      expect(crc).toMatch(/^[0-9A-F]{4}$/);
    });

    it("CRC16 is deterministic for same input", () => {
      const a = inlineCrc16("hello");
      const b = inlineCrc16("hello");
      expect(a).toBe(b);
    });

    it("returns input as-is if QRIS format unexpected", () => {
      const malformed = "not-a-qris-string";
      const out = inlineInjectAmount(malformed, 1000);
      expect(out).toBe(malformed);
    });
  });

  // ── Sync service ──────────────────────────────────────────
  describe("syncOrderKuotaStatus", () => {
    it("throws if credentials not set", async () => {
      settingsStore.setCredential("orderkuota", "username", "");
      settingsStore.setCredential("orderkuota", "authToken", "");
      await expect(syncOrderKuotaStatus()).rejects.toThrow(
        /credentials belum diset/,
      );
    });

    it("returns zero match if no pending OrderKuota tx exists", async () => {
      const result = await syncOrderKuotaStatus();
      expect(result.pendingCount).toBe(0);
      expect(result.matched).toBe(0);
    });

    it("matches pending tx by exact amount and timestamp", async () => {
      // Insert pending OrderKuota tx
      const now = new Date();
      transactionStore.save({
        id: "tx-1",
        orderId: "ORDER-001",
        amount: 1000,
        currency: "IDR",
        method: "qris",
        status: "pending",
        providerName: "orderkuota",
        providerTransactionId: "OK-ref-001",
        attempts: [],
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      });

      // Mock fetchMutasi to return one matching entry (kredit = 1000)
      jest
        .spyOn(OrderKuotaProvider, "fetchMutasi")
        .mockResolvedValueOnce({
          success: true,
          qris_history: {
            results: [
              {
                id: 999111,
                kredit: "1.000",
                debet: "0",
                tanggal: formatIndonesianTime(
                  new Date(now.getTime() + 5_000),
                ),
                status: "IN",
                keterangan: "NOBU / TEST",
                brand: { name: "DANA", logo: "" },
              },
            ],
          },
        });

      const result = await syncOrderKuotaStatus();
      expect(result.pendingCount).toBe(1);
      expect(result.matched).toBe(1);
      expect(result.updated[0].matchedMutasiId).toBe("999111");

      // Verify status sudah berubah ke success di DB
      const updated = transactionStore.findById("tx-1");
      expect(updated?.status).toBe("success");
      expect(updated?.providerTransactionId).toBe("999111");
    });

    it("ignores OUT entries (saldo withdrawals)", async () => {
      const now = new Date();
      transactionStore.save({
        id: "tx-2",
        orderId: "ORDER-002",
        amount: 5000,
        currency: "IDR",
        method: "qris",
        status: "pending",
        providerName: "orderkuota",
        providerTransactionId: "OK-ref-002",
        attempts: [],
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      });

      jest
        .spyOn(OrderKuotaProvider, "fetchMutasi")
        .mockResolvedValueOnce({
          success: true,
          qris_history: {
            results: [
              {
                id: 999222,
                debet: "5.000",
                kredit: "5.000",
                tanggal: formatIndonesianTime(
                  new Date(now.getTime() + 5_000),
                ),
                status: "OUT", // ← ini withdraw, harus di-skip
                keterangan: "Pencairan Saldo",
              },
            ],
          },
        });

      const result = await syncOrderKuotaStatus();
      expect(result.matched).toBe(0);
      const tx = transactionStore.findById("tx-2");
      expect(tx?.status).toBe("pending");
    });

    it("does not match mutasi older than transaction createdAt", async () => {
      const now = new Date();
      transactionStore.save({
        id: "tx-3",
        orderId: "ORDER-003",
        amount: 2500,
        currency: "IDR",
        method: "qris",
        status: "pending",
        providerName: "orderkuota",
        providerTransactionId: "OK-ref-003",
        attempts: [],
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      });

      // Mutasi dari 1 jam yang lalu — sebelum transaksi dibuat
      jest
        .spyOn(OrderKuotaProvider, "fetchMutasi")
        .mockResolvedValueOnce({
          success: true,
          qris_history: {
            results: [
              {
                id: 999333,
                kredit: "2.500",
                debet: "0",
                tanggal: formatIndonesianTime(
                  new Date(now.getTime() - 3600_000),
                ),
                status: "IN",
              },
            ],
          },
        });

      const result = await syncOrderKuotaStatus();
      expect(result.matched).toBe(0);
    });

    it("does not double-match same mutasi for two transactions", async () => {
      const now = new Date();
      // Dua transaksi dengan amount sama persis
      transactionStore.save({
        id: "tx-a",
        orderId: "ORDER-A",
        amount: 1500,
        currency: "IDR",
        method: "qris",
        status: "pending",
        providerName: "orderkuota",
        providerTransactionId: "OK-ref-a",
        attempts: [],
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      });
      transactionStore.save({
        id: "tx-b",
        orderId: "ORDER-B",
        amount: 1500,
        currency: "IDR",
        method: "qris",
        status: "pending",
        providerName: "orderkuota",
        providerTransactionId: "OK-ref-b",
        attempts: [],
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      });

      // Mutasi: cuma 1 entry yang masuk
      jest
        .spyOn(OrderKuotaProvider, "fetchMutasi")
        .mockResolvedValueOnce({
          success: true,
          qris_history: {
            results: [
              {
                id: 999444,
                kredit: "1.500",
                debet: "0",
                tanggal: formatIndonesianTime(
                  new Date(now.getTime() + 5_000),
                ),
                status: "IN",
              },
            ],
          },
        });

      const result = await syncOrderKuotaStatus();
      // Hanya satu tx yang harus match (fifo by createdAt)
      expect(result.matched).toBe(1);

      const a = transactionStore.findById("tx-a");
      const b = transactionStore.findById("tx-b");
      // Salah satu success, satunya tetap pending
      const successCount = [a, b].filter((t) => t?.status === "success")
        .length;
      expect(successCount).toBe(1);
    });
  });
});

// ── Helpers di-inline supaya bisa unit test tanpa export private function ──

function inlineInjectAmount(qrisData: string, amount: number): string {
  const amtStr = String(Math.round(amount));
  const withoutCrc = qrisData.slice(0, -4);
  const dynamic = withoutCrc.replace("010211", "010212");
  const parts = dynamic.split("5802ID");
  if (parts.length !== 2) return qrisData;
  const amountTag =
    "54" + amtStr.length.toString().padStart(2, "0") + amtStr + "5802ID";
  const merged = parts[0] + amountTag + parts[1];
  return merged + inlineCrc16(merged);
}

function inlineCrc16(input: string): string {
  let crc = 0xffff;
  for (let i = 0; i < input.length; i++) {
    crc ^= input.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

/**
 * Format Date ke "DD/MM/YYYY HH:mm:ss" timezone WIB (UTC+7).
 */
function formatIndonesianTime(d: Date): string {
  // Convert to WIB: add 7 hours offset for representation
  const wib = new Date(d.getTime() + 7 * 3600_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${pad(wib.getUTCDate())}/${pad(wib.getUTCMonth() + 1)}/` +
    `${wib.getUTCFullYear()} ${pad(wib.getUTCHours())}:` +
    `${pad(wib.getUTCMinutes())}:${pad(wib.getUTCSeconds())}`
  );
}
