"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import {
  ALL_PROVIDERS,
  Pagination,
  PaymentStatus,
  ProviderName,
  Transaction,
} from "@/lib/types";
import { StatusBadge } from "@/components/StatusBadge";
import { useToast } from "@/components/Toast";


const STATUSES: PaymentStatus[] = [
  "pending",
  "success",
  "failed",
  "expired",
  "refunded",
];

function formatRupiah(n: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
  }).format(n);
}

export default function TransactionsPage() {
  const toast = useToast();
  const [items, setItems] = useState<Transaction[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<PaymentStatus | "">("");
  const [provider, setProvider] = useState<ProviderName | "">("");
  const [orderId, setOrderId] = useState("");
  const [from, setFrom] = useState(""); // YYYY-MM-DD format from <input type="date">
  const [to, setTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  // Convert YYYY-MM-DD ke ISO range. `from` = awal hari, `to` = akhir hari
  // (23:59:59) supaya filter intuitive: "tgl 1-3" dapat semua transaksi
  // termasuk yang jam 23.30 di tgl 3.
  const fromIso = from ? `${from}T00:00:00` : "";
  const toIso = to ? `${to}T23:59:59` : "";

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .listTransactions({
        page,
        pageSize: 20,
        status: status || undefined,
        provider: provider || undefined,
        orderId: orderId || undefined,
        from: fromIso || undefined,
        to: toIso || undefined,
      })
      .then((r) => {
        if (cancelled) return;
        setItems(r.data);
        setPagination(r.pagination);
        setError(null);
      })
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [page, status, provider, orderId, fromIso, toIso]);

  async function doExport() {
    setExporting(true);
    try {
      const blob = await api.exportTransactionsCsv({
        status: status || undefined,
        provider: provider || undefined,
        orderId: orderId || undefined,
        from: fromIso || undefined,
        to: toIso || undefined,
      });
      // Trigger download
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const ts = new Date().toISOString().slice(0, 10);
      a.download = `transactions-${ts}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("CSV berhasil di-download");
    } catch (e: any) {
      toast.error(e?.message || "Gagal export");
    } finally {
      setExporting(false);
    }
  }

  function clearFilters() {
    setStatus("");
    setProvider("");
    setOrderId("");
    setFrom("");
    setTo("");
    setPage(1);
  }

  const hasActiveFilter = !!(status || provider || orderId || from || to);


  return (
    <div className="space-y-5">
      {/* Filters — stack vertically on mobile, grid on sm+ */}
      <div className="card p-3 sm:p-4">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <input
            value={orderId}
            onChange={(e) => {
              setOrderId(e.target.value);
              setPage(1);
            }}
            placeholder="Cari Order ID…"
            className="input"
          />
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as PaymentStatus | "");
              setPage(1);
            }}
            className="input"
          >
            <option value="">Semua Status</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            value={provider}
            onChange={(e) => {
              setProvider(e.target.value as ProviderName | "");
              setPage(1);
            }}
            className="input"
          >
            <option value="">Semua Provider</option>
            {ALL_PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>

          {/* Date range — separated into own row to keep label readable */}
          <div className="grid grid-cols-2 gap-2 sm:col-span-2 lg:col-span-2">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
                Dari tanggal
              </span>
              <input
                type="date"
                value={from}
                max={to || undefined}
                onChange={(e) => {
                  setFrom(e.target.value);
                  setPage(1);
                }}
                className="input"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
                Sampai tanggal
              </span>
              <input
                type="date"
                value={to}
                min={from || undefined}
                onChange={(e) => {
                  setTo(e.target.value);
                  setPage(1);
                }}
                className="input"
              />
            </label>
          </div>

          {/* Action row */}
          <div className="flex items-end gap-2 lg:col-span-1">
            <button
              onClick={doExport}
              disabled={exporting}
              className="btn-primary flex-1 text-xs sm:text-sm"
              title="Download semua transaksi yang match filter sebagai CSV"
            >
              {exporting ? "Exporting…" : "📥 Export CSV"}
            </button>
            {hasActiveFilter && (
              <button
                onClick={clearFilters}
                className="btn-secondary text-xs sm:text-sm"
                title="Reset semua filter"
              >
                Reset
              </button>
            )}
          </div>
        </div>
      </div>


      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Mobile: card list (visible < md) */}
      <div className="space-y-2 md:hidden">
        {loading && (
          <div className="card p-6 text-center text-sm text-slate-500">
            Memuat…
          </div>
        )}
        {!loading && items.length === 0 && (
          <div className="card p-6 text-center text-sm text-slate-500">
            Belum ada transaksi.
          </div>
        )}
        {items.map((t) => (
          <Link
            key={t.id}
            href={`/transactions/${t.id}`}
            className="card block p-4 transition hover:border-brand-300 hover:shadow-card"
          >
            <div className="mb-2 flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-sm font-medium text-slate-900">
                  {t.orderId}
                </div>
                <div className="mt-0.5 text-xs text-slate-500">
                  {new Date(t.createdAt).toLocaleString("id-ID", {
                    dateStyle: "short",
                    timeStyle: "short",
                  })}
                </div>
              </div>
              <StatusBadge status={t.status} />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="font-semibold text-slate-900">
                {formatRupiah(t.amount)}
              </div>
              <div className="flex items-center gap-2 text-slate-500">
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-slate-600">
                  {t.providerName}
                </span>
                <span>·</span>
                <span>{t.method}</span>
              </div>
            </div>
          </Link>
        ))}
      </div>

      {/* Desktop: table (visible >= md) */}
      <div className="card hidden overflow-hidden md:block">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50/60">
              <tr className="text-left text-xs font-semibold uppercase tracking-wider text-slate-600">
                <th className="px-4 py-3">Order ID</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Provider</th>
                <th className="px-4 py-3">Method</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-8 text-center text-slate-500"
                  >
                    Memuat…
                  </td>
                </tr>
              )}
              {!loading && items.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-8 text-center text-slate-500"
                  >
                    Belum ada transaksi.
                  </td>
                </tr>
              )}
              {items.map((t) => (
                <tr key={t.id} className="text-sm hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-slate-800">
                    {t.orderId}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-700">
                    {formatRupiah(t.amount)}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={t.status} />
                  </td>
                  <td className="px-4 py-3 capitalize text-slate-700">
                    {t.providerName}
                  </td>
                  <td className="px-4 py-3 text-slate-700">{t.method}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">
                    {new Date(t.createdAt).toLocaleString("id-ID")}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/transactions/${t.id}`}
                      className="text-sm font-medium text-brand-600 hover:text-brand-700"
                    >
                      Detail →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {pagination && pagination.totalPages > 1 && (
        <div className="flex flex-col items-stretch gap-2 text-sm sm:flex-row sm:items-center sm:justify-between">
          <span className="text-slate-500">
            Halaman {pagination.page} / {pagination.totalPages} · Total{" "}
            {pagination.total}
          </span>
          <div className="flex gap-2">
            <button
              disabled={page === 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="btn-secondary flex-1 sm:flex-none"
            >
              ← Prev
            </button>
            <button
              disabled={page === pagination.totalPages}
              onClick={() =>
                setPage((p) => Math.min(pagination.totalPages, p + 1))
              }
              className="btn-secondary flex-1 sm:flex-none"
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
