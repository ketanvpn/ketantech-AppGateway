"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { getApiBase } from "@/lib/api";
import { useSidebar } from "./SidebarContext";


/**
 * Mapping path → judul halaman + breadcrumb sederhana.
 * Pakai array of `[matcher, title, subtitle]` supaya gampang di-extend.
 */
const ROUTE_LABELS: Array<{
  match: (p: string) => boolean;
  title: string;
  subtitle?: string;
}> = [
  { match: (p) => p === "/", title: "Dashboard", subtitle: "Ringkasan transaksi & kesehatan provider" },
  {
    match: (p) => p.startsWith("/transactions/") && p !== "/transactions",
    title: "Detail Transaksi",
    subtitle: "Riwayat lengkap & aksi admin",
  },
  { match: (p) => p === "/transactions", title: "Transactions", subtitle: "Daftar semua transaksi" },
  { match: (p) => p === "/test-charge", title: "Test Charge", subtitle: "Uji coba flow charge & fallback" },
  { match: (p) => p === "/credentials", title: "Credentials", subtitle: "API key & secret per provider" },
  { match: (p) => p === "/orderkuota", title: "OrderKuota", subtitle: "Login OTP & sync mutasi QRIS" },
  { match: (p) => p === "/settings", title: "Providers", subtitle: "Urutan fallback & toggle status" },
  { match: (p) => p === "/system", title: "System", subtitle: "Rate limit, retry, CORS, client API keys" },
  { match: (p) => p === "/docs", title: "Docs", subtitle: "Cara integrasi ke aplikasi Anda" },
];

export function Topbar({ action }: { action?: React.ReactNode }) {
  const pathname = usePathname() ?? "/";
  const [apiBase, setApiBase] = useState("");
  const { toggle } = useSidebar();

  useEffect(() => {
    setApiBase(getApiBase());
  }, []);

  const meta = ROUTE_LABELS.find((r) => r.match(pathname)) ?? {
    title: "—",
    subtitle: undefined,
  };

  return (
    <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur sm:px-6 sm:py-3.5 lg:px-8">
      <div className="flex min-w-0 items-center gap-2">
        {/* Hamburger — hanya muncul di mobile / tablet */}
        <button
          onClick={toggle}
          className="-ml-1.5 inline-flex items-center justify-center rounded-md p-2 text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 lg:hidden"
          aria-label="Buka menu"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-5 w-5"
          >
            <line x1="4" y1="6" x2="20" y2="6" />
            <line x1="4" y1="12" x2="20" y2="12" />
            <line x1="4" y1="18" x2="20" y2="18" />
          </svg>
        </button>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-slate-900 sm:text-base">
            {meta.title}
          </div>
          {meta.subtitle && (
            <div className="hidden truncate text-xs text-slate-500 sm:block">
              {meta.subtitle}
            </div>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        {apiBase && (
          <div className="hidden items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 md:flex">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            <span className="font-mono text-[11px] text-slate-600">
              {apiBase.replace(/^https?:\/\//, "")}
            </span>
          </div>
        )}
        {action}
      </div>
    </header>
  );
}


