"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { Stats } from "@/lib/types";
import { OnboardingHero } from "@/components/OnboardingHero";


function formatRupiah(n: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
  }).format(n);
}

const PROVIDER_LABELS: Record<string, string> = {
  midtrans: "Midtrans",
  xendit: "Xendit",
  doku: "DOKU",
  tripay: "Tripay",
  orderkuota: "OrderKuota",
};

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  useEffect(() => {
    let interval: number | null = null;
    const load = async () => {
      try {
        const s = await api.getStats();
        setStats(s);
        setLastUpdate(new Date());
        setError(null);
      } catch (e: any) {
        setError(e?.message || "Gagal memuat stats");
      } finally {
        setLoading(false);
      }
    };
    load();
    interval = window.setInterval(load, 5000);
    return () => {
      if (interval) window.clearInterval(interval);
    };
  }, []);

  if (loading)
    return (
      <div className="space-y-6">
        <SkeletonCards />
      </div>
    );
  if (error)
    return (
      <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        {error}
      </div>
    );
  if (!stats) return null;

  const totalSuccess = stats.byStatus.success ?? 0;
  const totalPending = stats.byStatus.pending ?? 0;
  const totalFailed = stats.byStatus.failed ?? 0;
  const totalAll = stats.totalTransactions;

  return (
    <div className="space-y-6">
      {/* Onboarding hero — auto-hide kalau setup sudah lengkap */}
      <OnboardingHero totalTransactions={totalAll} />

      {/* Header bar */}
      <div className="flex flex-wrap items-end justify-between gap-3">

        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Overview
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Ringkasan Hari Ini
          </h1>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          <span>Live · auto-refresh 5s</span>
          {lastUpdate && (
            <span className="text-slate-400">
              · update {lastUpdate.toLocaleTimeString("id-ID")}
            </span>
          )}
        </div>
      </div>

      {/* Hero stat cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total Transaksi"
          value={totalAll.toLocaleString("id-ID")}
          icon={<IconReceipt />}
          tone="brand"
        />
        <StatCard
          label="Total Sukses"
          value={formatRupiah(stats.totalAmountSuccess)}
          icon={<IconWallet />}
          tone="emerald"
        />
        <StatCard
          label="Success Rate"
          value={`${stats.successRate}%`}
          icon={<IconTrendingUp />}
          tone="sky"
          progress={stats.successRate}
        />
        <StatCard
          label="Pending"
          value={String(totalPending)}
          icon={<IconClock />}
          tone="amber"
          subtitle={
            totalPending > 0 ? "Sedang menunggu pembayaran" : "Tidak ada"
          }
        />
      </div>

      {/* Provider Health & Status Distribution */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card
          title="Provider Health"
          subtitle="Status real-time"
          className="lg:col-span-2"
        >
          <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {stats.providerHealth.map((p) => (
              <li
                key={p.name}
                className="flex items-center justify-between rounded-lg border border-slate-200/70 bg-slate-50/40 px-3.5 py-2.5"
              >
                <div className="flex items-center gap-2.5">
                  <ProviderIcon name={p.name} />
                  <span className="text-sm font-medium text-slate-800">
                    {PROVIDER_LABELS[p.name] ?? p.name}
                  </span>
                </div>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${
                    p.healthy
                      ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                      : "bg-red-50 text-red-700 ring-1 ring-red-200"
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${p.healthy ? "bg-emerald-500" : "bg-red-500"}`}
                  />
                  {p.healthy ? "Healthy" : "Down"}
                </span>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Status Distribution" subtitle="Breakdown semua transaksi">
          {totalAll === 0 ? (
            <EmptyState message="Belum ada transaksi." />
          ) : (
            <ul className="space-y-2.5">
              {(["success", "pending", "failed", "expired", "refunded"] as const).map(
                (k) => {
                  const v = stats.byStatus[k] ?? 0;
                  const pct = totalAll === 0 ? 0 : (v / totalAll) * 100;
                  return (
                    <li key={k}>
                      <div className="mb-1 flex items-center justify-between text-xs">
                        <span className="capitalize text-slate-600">{k}</span>
                        <span className="font-semibold text-slate-900">
                          {v}{" "}
                          <span className="font-normal text-slate-400">
                            ({pct.toFixed(0)}%)
                          </span>
                        </span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                        <div
                          className={`h-full rounded-full ${BAR_COLORS[k]}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </li>
                  );
                },
              )}
            </ul>
          )}
        </Card>
      </div>

      {/* Per Provider + Quick Actions */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card
          title="Transaksi per Provider"
          subtitle="Distribusi yang berhasil masuk"
          className="lg:col-span-2"
        >
          {Object.keys(stats.byProvider).length === 0 ? (
            <EmptyState message="Belum ada transaksi via provider manapun." />
          ) : (
            <ul className="space-y-2.5">
              {Object.entries(stats.byProvider)
                .sort(([, a], [, b]) => b - a)
                .map(([name, count]) => {
                  const pct = totalAll === 0 ? 0 : (count / totalAll) * 100;
                  return (
                    <li key={name}>
                      <div className="mb-1 flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2.5">
                          <ProviderIcon name={name} />
                          <span className="font-medium text-slate-800">
                            {PROVIDER_LABELS[name] ?? name}
                          </span>
                        </div>
                        <span className="text-slate-700">
                          <strong>{count}</strong>
                          <span className="ml-1 text-xs text-slate-400">
                            ({pct.toFixed(0)}%)
                          </span>
                        </span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-brand-500 to-brand-400"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </li>
                  );
                })}
            </ul>
          )}
        </Card>

        <Card title="Aksi Cepat" subtitle="Shortcut yang sering dipakai">
          <div className="grid grid-cols-1 gap-2">
            <QuickAction
              href="/test-charge"
              label="Test Charge"
              hint="Bikin transaksi uji coba"
              icon={<IconBolt />}
            />
            <QuickAction
              href="/transactions"
              label="Lihat Transaksi"
              hint="List + filter + refund"
              icon={<IconReceipt />}
            />
            <QuickAction
              href="/credentials"
              label="Provider Credentials"
              hint="Set API key per provider"
              icon={<IconKey />}
            />
            <QuickAction
              href="/orderkuota"
              label="OrderKuota Setup"
              hint="OTP login + sync mutasi"
              icon={<IconMobile />}
            />
          </div>
        </Card>
      </div>

      <div className="text-[11px] text-slate-400">
        {totalFailed > 0 && (
          <span>
            {totalFailed} transaksi gagal · cek detailnya di{" "}
            <Link
              href="/transactions?status=failed"
              className="text-brand-600 hover:underline"
            >
              Transactions
            </Link>
          </span>
        )}
      </div>
    </div>
  );
}

const BAR_COLORS: Record<string, string> = {
  success: "bg-gradient-to-r from-emerald-500 to-emerald-400",
  pending: "bg-gradient-to-r from-amber-500 to-amber-400",
  failed: "bg-gradient-to-r from-red-500 to-red-400",
  expired: "bg-gradient-to-r from-slate-400 to-slate-300",
  refunded: "bg-gradient-to-r from-sky-500 to-sky-400",
};

const TONE_STYLES: Record<
  string,
  { iconWrap: string; iconColor: string; progressFrom: string }
> = {
  brand: {
    iconWrap: "bg-brand-50",
    iconColor: "text-brand-600",
    progressFrom: "from-brand-500",
  },
  emerald: {
    iconWrap: "bg-emerald-50",
    iconColor: "text-emerald-600",
    progressFrom: "from-emerald-500",
  },
  sky: {
    iconWrap: "bg-sky-50",
    iconColor: "text-sky-600",
    progressFrom: "from-sky-500",
  },
  amber: {
    iconWrap: "bg-amber-50",
    iconColor: "text-amber-600",
    progressFrom: "from-amber-500",
  },
};

// ── Reusable components ────────────────────────────────────────

function StatCard({
  label,
  value,
  subtitle,
  icon,
  tone,
  progress,
}: {
  label: string;
  value: string;
  subtitle?: string;
  icon: React.ReactNode;
  tone: keyof typeof TONE_STYLES;
  progress?: number;
}) {
  const t = TONE_STYLES[tone];
  return (
    <div className="card group p-5 transition-all hover:-translate-y-0.5 hover:shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          {label}
        </div>
        <div
          className={`flex h-9 w-9 items-center justify-center rounded-lg ${t.iconWrap} ${t.iconColor} transition-transform group-hover:scale-105`}
        >
          {icon}
        </div>
      </div>
      <div className="mt-2 truncate text-2xl font-bold tracking-tight text-slate-900">
        {value}
      </div>
      {subtitle && <div className="mt-0.5 text-xs text-slate-500">{subtitle}</div>}
      {typeof progress === "number" && (
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-slate-100">
          <div
            className={`h-full rounded-full bg-gradient-to-r ${t.progressFrom} to-transparent`}
            style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
          />
        </div>
      )}
    </div>
  );
}

function Card({
  title,
  subtitle,
  className = "",
  children,
}: {
  title: string;
  subtitle?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={`card p-5 ${className}`}>
      <div className="mb-4 flex items-baseline justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
          {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

function QuickAction({
  href,
  label,
  hint,
  icon,
}: {
  href: string;
  label: string;
  hint: string;
  icon: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-3 rounded-lg border border-slate-200/80 px-3 py-2.5 transition-all hover:border-brand-300 hover:bg-brand-50/40 hover:shadow-sm"
    >
      <span className="flex h-8 w-8 items-center justify-center rounded-md bg-slate-100 text-slate-600 transition-colors group-hover:bg-brand-100 group-hover:text-brand-700">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-slate-900">{label}</div>
        <div className="truncate text-xs text-slate-500">{hint}</div>
      </div>
      <span className="text-slate-400 transition-transform group-hover:translate-x-0.5 group-hover:text-brand-600">
        →
      </span>
    </Link>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-200 px-3 py-6 text-center">
      <div className="mb-2 text-slate-300">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="32"
          height="32"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3 7.5 12 13l9-5.5M3 7.5v9L12 22l9-5.5v-9M3 7.5 12 2l9 5.5" />
        </svg>
      </div>
      <p className="text-sm text-slate-500">{message}</p>
    </div>
  );
}

function SkeletonCards() {
  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="card p-5">
            <div className="h-3 w-24 animate-pulse rounded bg-slate-200" />
            <div className="mt-3 h-7 w-32 animate-pulse rounded bg-slate-200" />
          </div>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="card p-5 lg:col-span-2">
          <div className="h-3 w-32 animate-pulse rounded bg-slate-200" />
          <div className="mt-4 space-y-3">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-10 animate-pulse rounded bg-slate-100"
              />
            ))}
          </div>
        </div>
        <div className="card p-5">
          <div className="h-3 w-32 animate-pulse rounded bg-slate-200" />
          <div className="mt-4 space-y-3">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-3 animate-pulse rounded bg-slate-100" />
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

function ProviderIcon({ name }: { name: string }) {
  // Initial circle dengan warna brand-spesifik (deterministic dari nama)
  const colors: Record<string, string> = {
    midtrans: "bg-emerald-100 text-emerald-700",
    xendit: "bg-sky-100 text-sky-700",
    doku: "bg-orange-100 text-orange-700",
    tripay: "bg-violet-100 text-violet-700",
    orderkuota: "bg-amber-100 text-amber-700",
  };
  const cls = colors[name] ?? "bg-slate-100 text-slate-700";
  return (
    <span
      className={`inline-flex h-7 w-7 items-center justify-center rounded-md text-[10px] font-bold uppercase ${cls}`}
    >
      {name.slice(0, 2)}
    </span>
  );
}

// ── Inline icons ───────────────────────────────────────────────

const ip = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "2",
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  className: "h-5 w-5",
};

function IconReceipt() {
  return (
    <svg {...ip}>
      <path d="M5 3h14v18l-3-2-3 2-3-2-3 2-2-2V3z" />
      <path d="M9 8h6M9 12h6M9 16h4" />
    </svg>
  );
}
function IconWallet() {
  return (
    <svg {...ip}>
      <path d="M3 7v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7H7a2 2 0 0 1 0-4h14V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2z" />
      <circle cx="17" cy="14" r="1" fill="currentColor" />
    </svg>
  );
}
function IconTrendingUp() {
  return (
    <svg {...ip}>
      <path d="M22 7 13.5 15.5l-5-5L2 17" />
      <path d="M16 7h6v6" />
    </svg>
  );
}
function IconClock() {
  return (
    <svg {...ip}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </svg>
  );
}
function IconBolt() {
  return (
    <svg {...ip} className="h-4 w-4">
      <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
    </svg>
  );
}
function IconKey() {
  return (
    <svg {...ip} className="h-4 w-4">
      <circle cx="7.5" cy="15.5" r="3.5" />
      <path d="M21 2 11 12M16 7l3 3M14 9l3 3" />
    </svg>
  );
}
function IconMobile() {
  return (
    <svg {...ip} className="h-4 w-4">
      <rect x="6" y="2" width="12" height="20" rx="2.5" />
      <line x1="11" y1="18" x2="13" y2="18" />
    </svg>
  );
}
