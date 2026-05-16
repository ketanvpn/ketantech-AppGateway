import { OrderKuotaProvider } from "../providers/orderkuotaProvider";
import { settingsStore } from "../store/settingsStore";
import { transactionStore } from "../store/transactionStore";
import { logger } from "../utils/logger";
import { PaymentStatus, TransactionRecord } from "../types";

/**
 * OrderKuota tidak punya webhook native — provider mereka tidak push update ke kita.
 * Service ini fetch endpoint mutasi (history pembayaran), lalu match transaksi
 * `pending` di DB kita dengan pembayaran yang sudah masuk.
 *
 * Logika match:
 *  - Bandingkan `amount` (sama persis), dan
 *  - Mutasi terjadi setelah transaksi `createdAt` (anti-misclaim payment lama)
 *  - Belum ada transaksi orderkuota lain yang sudah pakai mutasi yang sama
 *    (kita simpan `providerTransactionId` ke ID mutasi setelah match)
 *
 * Catatan: amount-only match bisa salah kalau dua user kebetulan bayar nominal
 * sama dalam window kecil. Untuk mencegah, sebaiknya generate amount unik
 * dengan tail random (mis. 50000 → 50037) — tapi itu tanggung jawab caller.
 */

/**
 * Struktur entry mutasi OrderKuota (dari `qris_history.results`).
 * Field utama:
 *  - `kredit`: amount masuk, format Indonesia (e.g. "1.000" = 1000, "100.000" = 100000)
 *  - `debet`: amount keluar (penarikan saldo)
 *  - `status`: "IN" = pemasukan dari customer, "OUT" = penarikan ke bank
 *  - `tanggal`: "DD/MM/YYYY HH:mm:ss" (bukan ISO)
 *  - `keterangan`: text bebas (mis. "NOBU / EK*********" untuk masuk via DANA)
 *  - `brand`: { name, logo } — bank/wallet sumber
 *
 * Yang kita pakai untuk match: kredit + tanggal + status === "IN".
 */
interface MutasiEntry {
  id?: string | number;
  tanggal?: string;
  kredit?: string | number;
  debet?: string | number;
  status?: string;
  keterangan?: string;
  brand?: { name?: string; logo?: string };
  [k: string]: unknown;
}


export interface SyncResult {
  /** Jumlah transaksi pending OrderKuota saat sync mulai. */
  pendingCount: number;
  /** Jumlah transaksi yang berhasil di-mark `success` setelah cocok. */
  matched: number;
  /** Transaksi yang status berubah, lengkap dengan ID dan amount. */
  updated: Array<{
    transactionId: string;
    orderId: string;
    amount: number;
    matchedMutasiId: string;
  }>;
  /** Berapa entry mutasi total yang di-fetch. */
  mutasiCount: number;
}

/**
 * Lakukan sinkronisasi: fetch mutasi terbaru, match dengan pending,
 * update status ke `success` untuk yang cocok.
 */
export async function syncOrderKuotaStatus(): Promise<SyncResult> {
  const username = settingsStore.getCredential("orderkuota", "username");
  const authToken = settingsStore.getCredential("orderkuota", "authToken");

  if (!username || !authToken) {
    throw new Error(
      "OrderKuota credentials belum diset. Login OTP dulu via /api/v1/admin/orderkuota/login.",
    );
  }

  // Pending OrderKuota transactions — yang masih nunggu pembayaran
  const allPending = transactionStore.list().filter(
    (tx) => tx.providerName === "orderkuota" && tx.status === "pending",
  );

  if (allPending.length === 0) {
    return {
      pendingCount: 0,
      matched: 0,
      updated: [],
      mutasiCount: 0,
    };
  }

  let mutasiResp: Record<string, any>;
  try {
    mutasiResp = await OrderKuotaProvider.fetchMutasi(username, authToken);
  } catch (err) {
    logger.error(
      { err: (err as Error).message },
      "OrderKuota fetchMutasi gagal",
    );
    throw err;
  }

  const entries = extractMutasiEntries(mutasiResp);

  // ID mutasi yang sudah dipakai di DB (cegah double-match)
  const usedMutasiIds = new Set(
    transactionStore
      .list()
      .filter(
        (tx) =>
          tx.providerName === "orderkuota" && tx.status === "success",
      )
      .map((tx) => tx.providerTransactionId)
      .filter(Boolean),
  );

  const updated: SyncResult["updated"] = [];

  for (const tx of allPending) {
    const txCreatedAt = new Date(tx.createdAt).getTime();
    const match = entries.find((m) => {
      // Hanya proses pemasukan (IN), abaikan penarikan saldo (OUT).
      if (m.status && m.status.toUpperCase() !== "IN") return false;

      // Amount: pakai field `kredit` (format Indonesia "1.000" = 1000).
      // Fallback ke `jumlah` & `amount` kalau struktur response berbeda.
      const amt = parseIndonesianAmount(
        (m.kredit ?? (m as any).jumlah ?? (m as any).amount) as unknown,
      );
      if (amt !== tx.amount) return false;

      // Tanggal format DD/MM/YYYY HH:mm:ss → harus parse manual (Date.parse
      // di JS tidak support format ini secara reliable cross-environment).
      const ts = parseIndonesianTimestamp(m.tanggal);
      // Beri toleransi 60 detik untuk clock skew antara server kita & OrderKuota.
      if (ts && ts < txCreatedAt - 60_000) return false;

      const id = String(m.id ?? "");
      if (id && usedMutasiIds.has(id)) return false;
      return true;
    });


    if (!match) continue;

    const matchedId = String(match.id ?? `OK-MUT-${Date.now()}`);
    usedMutasiIds.add(matchedId);

    applyMatch(tx, matchedId, match);
    updated.push({
      transactionId: tx.id,
      orderId: tx.orderId,
      amount: tx.amount,
      matchedMutasiId: matchedId,
    });
  }

  logger.info(
    {
      pending: allPending.length,
      matched: updated.length,
      mutasi: entries.length,
    },
    "OrderKuota sync done",
  );

  return {
    pendingCount: allPending.length,
    matched: updated.length,
    updated,
    mutasiCount: entries.length,
  };
}

function applyMatch(
  tx: TransactionRecord,
  matchedMutasiId: string,
  rawMutasi: MutasiEntry,
): void {
  const updatedTx: TransactionRecord = {
    ...tx,
    status: "success" satisfies PaymentStatus,
    providerTransactionId: matchedMutasiId,
    attempts: [
      ...tx.attempts,
      {
        providerName: "orderkuota",
        success: true,
        at: new Date().toISOString(),
        error: undefined,
      },
    ],
    updatedAt: new Date().toISOString(),
  };
  transactionStore.save(updatedTx);
  logger.info(
    {
      provider: "orderkuota",
      txId: tx.id,
      orderId: tx.orderId,
      mutasiId: matchedMutasiId,
      amount: tx.amount,
      _raw: rawMutasi.keterangan,
    },
    "OrderKuota tx matched as success",
  );
}

/**
 * Extract array entries dari response mutasi.
 * Struktur OrderKuota: data.qris_history.results (array) — pakai fallback
 * berlapis karena response shape kadang variasi.
 */
function extractMutasiEntries(resp: Record<string, any>): MutasiEntry[] {
  const candidates = [
    resp?.qris_history?.results,
    resp?.qris_history?.data,
    resp?.results,
    resp?.data,
    resp,
  ];
  for (const c of candidates) {
    if (Array.isArray(c)) return c as MutasiEntry[];
  }
  return [];
}

/**
 * Parse amount format Indonesia.
 * OrderKuota return format "1.000" untuk seribu rupiah, "100.000" untuk 100rb.
 * Titik adalah thousand separator, bukan decimal point.
 *
 * Contoh:
 *  - "1.000"   → 1000
 *  - "100.000" → 100000
 *  - "1.234.567" → 1234567
 *  - 50000 (number) → 50000
 *
 * Nominal yang punya pecahan rupiah tidak ada di OrderKuota (semua integer).
 */
function parseIndonesianAmount(v: unknown): number {
  if (typeof v === "number") return Math.floor(v);
  if (typeof v !== "string") return NaN;
  // Buang semua karakter non-digit (termasuk titik thousand-separator)
  const digits = v.replace(/[^\d]/g, "");
  if (!digits) return NaN;
  const n = parseInt(digits, 10);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Parse timestamp format Indonesia: "DD/MM/YYYY HH:mm:ss".
 * Date.parse() di JS tidak reliable untuk format ini di sebagian browser/env.
 * Kita parse manual.
 *
 * Contoh: "16/05/2026 16:56:50" → epoch millis
 *
 * Asumsi: timestamp dalam timezone WIB (Asia/Jakarta, UTC+7). Untuk akurasi,
 * convert ke UTC pakai offset +07:00.
 */
function parseIndonesianTimestamp(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const m = v.trim().match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})$/,
  );
  if (!m) {
    // Fallback ke Date.parse buat kalau format kebetulan ISO
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }
  const [, dd, mm, yyyy, hh, min, ss] = m;
  // Build ISO 8601 string dengan offset Indonesia (+07:00).
  // Ini explicit supaya tidak depends on server local timezone.
  const iso = `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(
    2,
    "0",
  )}T${hh.padStart(2, "0")}:${min}:${ss}+07:00`;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}


