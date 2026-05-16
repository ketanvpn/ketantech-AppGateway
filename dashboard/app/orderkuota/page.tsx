"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { CredentialsSnapshot, Settings } from "@/lib/types";


/**
 * Halaman khusus OrderKuota.
 * Beda dari provider lain karena auth-nya pakai OTP login + token, bukan API key.
 *
 * Flow:
 *  1. User isi username + password app OrderKuota → klik Request OTP
 *  2. OTP dikirim ke nomor HP terdaftar
 *  3. User isi kode OTP → klik Exchange. Token otomatis disimpan ke credentials store.
 *  4. Dari sini, charge OrderKuota bisa dipakai. Sync mutasi tinggal klik tombol.
 */
export default function OrderKuotaPage() {
  // ── Login state
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [otpRequested, setOtpRequested] = useState(false);

  const [otpResult, setOtpResult] = useState<unknown>(null);
  const [tokenResult, setTokenResult] = useState<unknown>(null);

  // ── Sync state
  const [syncResult, setSyncResult] = useState<{
    pendingCount: number;
    matched: number;
    mutasiCount: number;
    updated: Array<{
      transactionId: string;
      orderId: string;
      amount: number;
      matchedMutasiId: string;
    }>;
  } | null>(null);

  const [busy, setBusy] = useState<
    null | "otp" | "exchange" | "sync" | "setPrimary"
  >(null);
  const [error, setError] = useState<string | null>(null);

  // ── Status setup (auto-refresh tiap kali ada perubahan)
  const [creds, setCreds] = useState<CredentialsSnapshot | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);

  async function refreshStatus() {
    try {
      const [c, s] = await Promise.all([api.getCredentials(), api.getSettings()]);
      setCreds(c);
      setSettings(s);
    } catch (e: any) {
      // Diam saja kalau gagal — bukan critical
      console.warn("refreshStatus failed:", e?.message);
    }
  }

  useEffect(() => {
    refreshStatus();
  }, []);

  const okCreds = creds?.orderkuota || {};
  const hasUsername = okCreds.username?.source !== "empty";
  const hasToken = okCreds.authToken?.source !== "empty";
  const credsReady = hasUsername && hasToken;
  const isPrimary = settings?.providerOrder?.[0] === "orderkuota";
  const isInOrder = settings?.providerOrder?.includes("orderkuota") ?? false;

  async function handleSetPrimary() {
    if (!settings) return;
    setBusy("setPrimary");
    setError(null);
    try {
      // Taruh orderkuota di urutan pertama, sisanya tetap (deduplicate)
      const rest = settings.providerOrder.filter((p) => p !== "orderkuota");
      const newOrder = ["orderkuota" as const, ...rest];
      await api.updateSettings({ providerOrder: newOrder });
      await refreshStatus();
    } catch (e: any) {
      setError(e?.message || "Gagal set primary");
    } finally {
      setBusy(null);
    }
  }


  async function handleRequestOtp() {
    if (!username.trim() || !password.trim()) {
      setError("Username dan password wajib diisi");
      return;
    }
    setError(null);
    setBusy("otp");
    try {
      const res = await api.orderkuotaRequestOtp(username.trim(), password);
      setOtpResult(res);
      setOtpRequested(true);
    } catch (e: any) {
      setError(e?.message || "Gagal request OTP");
    } finally {
      setBusy(null);
    }
  }

  async function handleExchangeOtp() {
    if (!otp.trim()) {
      setError("OTP wajib diisi");
      return;
    }
    setError(null);
    setBusy("exchange");
    try {
      const res = await api.orderkuotaExchangeOtp(username.trim(), otp.trim());
      setTokenResult(res);
      if (res.savedAsCredential) {
        // Reset password & otp setelah sukses, lalu refresh status panel
        setPassword("");
        setOtp("");
        await refreshStatus();
      }

    } catch (e: any) {
      setError(e?.message || "Gagal exchange OTP");
    } finally {
      setBusy(null);
    }
  }

  async function handleSync() {
    setError(null);
    setBusy("sync");
    try {
      const res = await api.orderkuotaSync();
      setSyncResult(res);
    } catch (e: any) {
      setError(e?.message || "Gagal sync");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">OrderKuota</h1>
        <p className="text-sm text-slate-500">
          Provider QRIS via app.orderkuota.com. Auth pakai OTP login (bukan API key).
          Setelah dapat token, charge & sync mutasi otomatis tersedia.
        </p>
      </div>

      <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
        ⚠️ <strong>Catatan:</strong> OrderKuota integrasi unofficial yang
        reverse-engineer mobile app. Bisa break tiap kali OrderKuota update aplikasi
        mereka. Provider ini juga <strong>tidak punya webhook</strong> — status
        update hanya lewat polling sync (manual atau scheduled cron).
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* ── STATUS PANEL ──────────────────────────────────────────── */}
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="mb-3 text-base font-semibold text-slate-900">
          Status Setup
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatusItem
            label="Username"
            ok={hasUsername}
            value={
              hasUsername
                ? okCreds.username?.value || "—"
                : "Belum diset"
            }
          />
          <StatusItem
            label="Auth Token"
            ok={hasToken}
            value={hasToken ? okCreds.authToken?.value || "—" : "Belum diset"}
          />
          <StatusItem
            label="Provider Order"
            ok={isPrimary}
            value={
              isPrimary
                ? "Primary ✓"
                : isInOrder
                  ? `Posisi #${(settings?.providerOrder?.indexOf("orderkuota") ?? 0) + 1}`
                  : "Tidak di order"
            }
          />
        </div>

        {credsReady && !isPrimary && (
          <div className="mt-4 flex items-center justify-between rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">
            <div className="text-amber-800">
              <strong>Credential sudah siap</strong>, tapi OrderKuota belum di
              urutan pertama. Charge dengan method <code>qris</code> akan jatuh
              ke provider lain dulu.
            </div>
            <button
              onClick={handleSetPrimary}
              disabled={busy === "setPrimary"}
              className="ml-3 shrink-0 rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50"
            >
              {busy === "setPrimary" ? "Mengatur…" : "Set sebagai Primary"}
            </button>
          </div>
        )}

        {!credsReady && (
          <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
            Selesaikan login OTP di bawah untuk mengaktifkan OrderKuota.
          </div>
        )}
      </section>

      {/* ── STEP 1: Request OTP ───────────────────────────────────── */}

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="mb-4 flex items-center gap-3">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">
            1
          </span>
          <h2 className="text-base font-semibold text-slate-900">Request OTP</h2>
        </div>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">
              Username
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="username OrderKuota"
              className="w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm focus:border-brand-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="password app OrderKuota (bukan email)"
              className="w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm focus:border-brand-500 focus:outline-none"
            />
          </div>
          <button
            onClick={handleRequestOtp}
            disabled={busy === "otp"}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {busy === "otp" ? "Mengirim…" : "Kirim OTP"}
          </button>
        </div>
        {otpResult !== null && (
          <pre className="mt-3 max-h-40 overflow-auto rounded-md bg-slate-900 p-3 text-xs text-slate-100">
            {JSON.stringify(otpResult, null, 2)}
          </pre>
        )}
      </section>

      {/* ── STEP 2: Exchange OTP ──────────────────────────────────── */}
      <section
        className={`rounded-lg border p-5 ${
          otpRequested
            ? "border-slate-200 bg-white"
            : "border-slate-200 bg-slate-50 opacity-60"
        }`}
      >
        <div className="mb-4 flex items-center gap-3">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">
            2
          </span>
          <h2 className="text-base font-semibold text-slate-900">Exchange OTP → Token</h2>
        </div>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">
              OTP Code (dari SMS)
            </label>
            <input
              type="text"
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
              placeholder="6 digit"
              maxLength={20}
              disabled={!otpRequested}
              className="w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm focus:border-brand-500 focus:outline-none disabled:bg-slate-100"
            />
          </div>
          <button
            onClick={handleExchangeOtp}
            disabled={busy === "exchange" || !otpRequested}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {busy === "exchange" ? "Memproses…" : "Tukar OTP & Simpan Token"}
          </button>
          {tokenResult !== null && (
            <div className="mt-3 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">
              {(tokenResult as any).savedAsCredential ? (
                <>
                  ✓ Token berhasil disimpan ke credentials.{" "}
                  <a href="/credentials" className="font-medium underline">
                    Cek di /credentials
                  </a>
                </>
              ) : (
                <>
                  Response diterima, tapi token tidak otomatis tersimpan. Cek raw
                  response di bawah.
                </>
              )}
              <pre className="mt-2 max-h-40 overflow-auto rounded-md bg-slate-900 p-2 text-xs text-slate-100">
                {JSON.stringify(tokenResult, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </section>

      {/* ── Sync Mutasi ───────────────────────────────────────────── */}
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Sync Status (Polling Mutasi)
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              Fetch mutasi terbaru dari OrderKuota lalu match dengan transaksi
              pending. Klik manual atau jadwalkan via cron.
            </p>
          </div>
          <button
            onClick={handleSync}
            disabled={busy === "sync"}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {busy === "sync" ? "Sync…" : "Sync Sekarang"}
          </button>
        </div>

        {syncResult && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <Stat label="Pending" value={syncResult.pendingCount} />
              <Stat
                label="Matched"
                value={syncResult.matched}
                highlight={syncResult.matched > 0}
              />
              <Stat label="Mutasi diambil" value={syncResult.mutasiCount} />
            </div>

            {syncResult.updated.length > 0 && (
              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Transaksi yang diupdate
                </div>
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                      <th className="py-2 pr-3">Order ID</th>
                      <th className="py-2 pr-3">Amount</th>
                      <th className="py-2">Matched Mutasi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {syncResult.updated.map((u) => (
                      <tr
                        key={u.transactionId}
                        className="border-b border-slate-100 last:border-0"
                      >
                        <td className="py-2 pr-3 font-mono text-xs">
                          <a
                            href={`/transactions/${u.transactionId}`}
                            className="text-brand-600 hover:underline"
                          >
                            {u.orderId}
                          </a>
                        </td>
                        <td className="py-2 pr-3">
                          Rp {u.amount.toLocaleString("id-ID")}
                        </td>
                        <td className="py-2 font-mono text-xs text-slate-600">
                          {u.matchedMutasiId}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </section>

      <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800">
        💡 <strong>Tips production:</strong> Jadwalkan sync tiap 30 detik via
        cron job (curl POST ke <code>/api/v1/admin/orderkuota/sync</code> dengan
        admin key). Untuk akurasi match, generate amount unik per transaksi (mis.
        50000 → 50007) supaya tidak ada confusion antar pembayaran.
      </div>
    </div>
  );
}

function StatusItem({
  label,
  ok,
  value,
}: {
  label: string;
  ok: boolean;
  value: string;
}) {
  return (
    <div
      className={`rounded-md border p-3 ${
        ok
          ? "border-emerald-200 bg-emerald-50"
          : "border-slate-200 bg-slate-50"
      }`}
    >
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="mt-1 flex items-center gap-2">
        <span className={ok ? "text-emerald-600" : "text-slate-400"}>
          {ok ? "✓" : "○"}
        </span>
        <span
          className={`truncate font-mono text-xs ${
            ok ? "text-emerald-800" : "text-slate-600"
          }`}
        >
          {value}
        </span>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number;
  highlight?: boolean;
}) {

  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-center">
      <div
        className={`text-2xl font-bold ${
          highlight ? "text-emerald-600" : "text-slate-800"
        }`}
      >
        {value}
      </div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );
}
