"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "@/lib/api";
import { PaymentStatus, Transaction } from "@/lib/types";
import { StatusBadge } from "@/components/StatusBadge";
import { useToast } from "@/components/Toast";


const TERMINAL: PaymentStatus[] = ["success", "failed", "expired", "refunded"];

export default function TransactionDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id as string;
  const toast = useToast();
  const [tx, setTx] = useState<Transaction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [simulating, setSimulating] = useState(false);
  const [refunding, setRefunding] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);




  async function load() {
    try {
      const data = await api.getTransaction(id);
      setTx(data);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!id) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function simulate(status: PaymentStatus) {
    if (!tx) return;
    setSimulating(true);
    setError(null);
    try {
      const updated = await api.simulateStatus(tx.id, status);
      setTx(updated);
      toast.success(`Status diubah ke "${status}"`);
    } catch (e: any) {
      toast.error(e?.message || "Gagal mengubah status");
    } finally {
      setSimulating(false);
    }
  }

  async function doSync() {
    setSyncing(true);
    setError(null);
    try {
      const res = await api.orderkuotaSync();
      if (res.matched > 0) {
        toast.success(`${res.matched} transaksi ter-match dari mutasi`);
      } else {
        toast.info(
          `Belum ada match (${res.pendingCount} pending, ${res.mutasiCount} mutasi diperiksa)`,
        );
      }
      // Reload transaksi — mungkin status sudah berubah jadi success
      await load();
    } catch (e: any) {
      toast.error(e?.message || "Gagal sync");
    } finally {
      setSyncing(false);
    }
  }


  // Auto-sync polling untuk transaksi OrderKuota yang masih pending.
  // Cek tiap 15 detik supaya status update tanpa manual refresh.
  useEffect(() => {
    if (!tx) return;
    if (tx.providerName !== "orderkuota") return;
    if (tx.status !== "pending") return;
    const id = setInterval(() => {
      api.orderkuotaSync()
        .then(() => load())
        .catch(() => {
          // Diam saja — error sync tidak boleh ngeganggu user yang lagi liat halaman
        });
    }, 15_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tx?.providerName, tx?.status]);

  async function doRefresh() {
    if (!tx) return;
    setRefreshing(true);
    setError(null);
    try {
      const result = await api.refreshStatus(tx.id);
      setTx(result.data);
      if (result.meta.changed) {
        toast.success(
          `Status diupdate: ${result.meta.previousStatus} → ${result.meta.currentStatus}`,
        );
      } else {
        toast.info(`Status masih ${result.meta.currentStatus}`);
      }
    } catch (e: any) {
      toast.error(e?.message || "Gagal cek status");
    } finally {
      setRefreshing(false);
    }
  }

  async function doRefund() {


    if (!tx) return;
    if (
      !window.confirm(
        `Refund transaksi ${tx.orderId} sebesar ${tx.currency} ${tx.amount.toLocaleString("id-ID")}?`,
      )
    ) {
      return;
    }
    setRefunding(true);
    setError(null);
    try {
      const updated = await api.refund(tx.id);
      setTx(updated);
      toast.success("Refund berhasil");
    } catch (e: any) {
      toast.error(e?.message || "Gagal refund");
    } finally {
      setRefunding(false);
    }
  }



  if (loading) return <div className="text-slate-500">Memuat…</div>;
  if (error && !tx)
    return (
      <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        {error}
      </div>
    );
  if (!tx) return null;

  const isTerminal = TERMINAL.includes(tx.status);

  const fields: Array<[string, React.ReactNode]> = [
    ["Transaction ID", <span className="font-mono text-xs">{tx.id}</span>],
    ["Order ID", <span className="font-mono">{tx.orderId}</span>],
    ["Amount", `${tx.currency} ${tx.amount.toLocaleString("id-ID")}`],
    ["Method", tx.method],
    ["Status", <StatusBadge status={tx.status} />],
    ["Provider", <span className="capitalize">{tx.providerName}</span>],
    [
      "Provider Tx ID",
      <span className="font-mono text-xs">
        {tx.providerTransactionId || "—"}
      </span>,
    ],
    ["Created", new Date(tx.createdAt).toLocaleString("id-ID")],
    ["Updated", new Date(tx.updatedAt).toLocaleString("id-ID")],
  ];

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/transactions"
          className="text-sm text-brand-600 hover:text-brand-700"
        >
          ← Kembali
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">
          Detail Transaksi
        </h1>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* ── QRIS / Payment URL ───────────────────────────────────── */}
      {tx.paymentUrl && tx.status === "pending" && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <div className="flex-1">
              <div className="mb-1 text-sm font-semibold text-emerald-900">
                {tx.method === "qris"
                  ? "💳 Scan QRIS untuk Bayar"
                  : "💳 Link Pembayaran"}
              </div>
              <p className="mb-3 text-xs text-emerald-800">
                {tx.providerName === "orderkuota" ? (
                  <>
                    Scan kode QR di samping pakai e-wallet/m-banking. Status akan
                    update otomatis dalam 15 detik setelah pembayaran masuk
                    (auto-poll mutasi). Atau klik tombol di bawah untuk sync manual.
                  </>
                ) : (
                  <>
                    Link checkout dari provider {tx.providerName}. Customer akan
                    bayar di sana, lalu provider kirim webhook ke gateway untuk update status.
                  </>
                )}
              </p>

              <div className="space-y-2">
                {tx.providerName === "orderkuota" && (
                  <>
                    <button
                      onClick={doSync}
                      disabled={syncing}
                      className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                    >
                      {syncing ? "Sync…" : "🔄 Sync Sekarang"}
                    </button>
                    <div className="text-[11px] text-emerald-700">
                      Auto-sync aktif tiap 15 detik selama status pending.
                    </div>

                  </>
                )}
                {tx.method !== "qris" && (
                  <div className="flex flex-wrap gap-2">
                    <a
                      href={tx.paymentUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-block rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
                    >
                      Buka Halaman Pembayaran ↗
                    </a>
                    {tx.providerName !== "orderkuota" && (
                      <button
                        onClick={doRefresh}
                        disabled={refreshing}
                        className="rounded-md border border-emerald-600 bg-white px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                        title="Pull status terkini dari provider (untuk webhook yang gagal nyampe)"
                      >
                        {refreshing ? "Cek…" : "🔄 Cek Status"}
                      </button>
                    )}
                  </div>
                )}
              </div>
              {tx.providerName !== "orderkuota" && (
                <div className="mt-2 text-[11px] text-emerald-700">
                  💡 Kalau status tidak update setelah pelanggan bayar, klik
                  <strong> Cek Status</strong> untuk pull manual dari provider.
                </div>
              )}

            </div>

            {tx.method === "qris" && (
              <div className="flex flex-col items-center">
                <div className="rounded-lg border-4 border-white bg-white p-1 shadow-md">
                  <img
                    src={tx.paymentUrl}
                    alt="QRIS Code"
                    className="h-56 w-56 object-contain"
                  />
                </div>
                <div className="mt-2 text-center text-[11px] text-emerald-700">
                  {tx.currency}{" "}
                  <strong className="text-base">
                    {tx.amount.toLocaleString("id-ID")}
                  </strong>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
        <div className="mb-2 text-sm font-semibold text-amber-900">
          🧪 Simulate Webhook (DEV)
        </div>

        <p className="mb-3 text-xs text-amber-800">
          Status transaksi awal selalu <code>pending</code>. Di produksi, status
          baru berubah saat customer benar-benar bayar dan provider kirim webhook.
          Karena provider kita masih mock, gunakan tombol di bawah untuk
          simulasi callback dari provider.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => simulate("success")}
            disabled={simulating || isTerminal}
            className="rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
          >
            ✓ Mark as Success
          </button>
          <button
            onClick={() => simulate("failed")}
            disabled={simulating || isTerminal}
            className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            ✗ Mark as Failed
          </button>
          <button
            onClick={() => simulate("expired")}
            disabled={simulating || isTerminal}
            className="rounded-md bg-slate-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            ⏱ Mark as Expired
          </button>
          {isTerminal && (
            <span className="self-center text-xs text-amber-800">
              Transaksi sudah di status terminal — tidak bisa diubah lagi.
            </span>
          )}
        </div>
      </div>

      {tx.status === "success" && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
          <div className="mb-2 text-sm font-semibold text-blue-900">
            💸 Refund
          </div>
          <p className="mb-3 text-xs text-blue-800">
            Refund hanya bisa dilakukan untuk transaksi yang sudah{" "}
            <code>success</code>. Operasi ini idempotent — request berulang
            tidak akan dobel.
          </p>
          <button
            onClick={doRefund}
            disabled={refunding}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {refunding ? "Memproses…" : "Refund transaksi ini"}
          </button>
        </div>
      )}

      {tx.status === "refunded" && (
        <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800">
          Transaksi ini sudah di-refund.
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">

        <div className="card p-5">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-600">
            Informasi
          </h2>
          <dl className="grid grid-cols-1 gap-3 text-sm">
            {fields.map(([label, value], i) => (
              <div
                key={i}
                className="flex flex-col gap-0.5 border-b border-slate-100 pb-2 last:border-0 sm:flex-row sm:items-start sm:justify-between sm:gap-3"
              >
                <dt className="shrink-0 text-xs font-medium uppercase tracking-wide text-slate-500 sm:text-sm sm:font-normal sm:normal-case sm:tracking-normal">
                  {label}
                </dt>
                <dd className="min-w-0 break-all text-slate-900 sm:text-right">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </div>


        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-600">
            Provider Attempts ({tx.attempts.length})
          </h2>
          <ul className="space-y-3">
            {tx.attempts.map((a, i) => (
              <li
                key={i}
                className={`rounded-md border p-3 text-sm ${
                  a.success
                    ? "border-green-200 bg-green-50"
                    : "border-red-200 bg-red-50"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium capitalize">
                    {i + 1}. {a.providerName}
                  </span>
                  <span
                    className={
                      a.success ? "text-green-700" : "text-red-700"
                    }
                  >
                    {a.success ? "✓ success" : "✗ failed"}
                  </span>
                </div>
                {a.error && (
                  <div className="mt-1 text-xs text-slate-600">{a.error}</div>
                )}
                <div className="mt-1 text-xs text-slate-500">
                  {new Date(a.at).toLocaleString("id-ID")}
                </div>
              </li>
            ))}
            {tx.attempts.length === 0 && (
              <li className="text-sm text-slate-500">Tidak ada attempts.</li>
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}
