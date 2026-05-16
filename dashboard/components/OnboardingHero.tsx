"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { CredentialsSnapshot, ProviderName } from "@/lib/types";

/**
 * Hero onboarding — hanya muncul kalau setup user belum lengkap
 * (zero transactions ATAU tidak ada provider yang punya credential).
 *
 * Auto-hide saat sudah ada minimal 1 transaksi DAN minimal 1 provider siap.
 *
 * Strategi UX: tunjukkan apa yang sudah dilakukan (✓) vs apa yang masih
 * perlu (•), bukan cuma list to-do generik. Pelan-pelan menghilang seiring
 * progress user, bukan tiba-tiba lenyap setelah satu klik.
 */

interface Step {
  id: string;
  label: string;
  hint: string;
  href: string;
  done: boolean;
}

export function OnboardingHero({
  totalTransactions,
}: {
  totalTransactions: number;
}) {
  const [creds, setCreds] = useState<CredentialsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    api
      .getCredentials()
      .then((c) => alive && setCreds(c))
      .catch(() => alive && setCreds({} as CredentialsSnapshot))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  if (loading) return null;

  const hasReadyProvider = !!creds && hasAnyReady(creds);
  const hasTransaction = totalTransactions > 0;

  // Sembunyikan kalau sudah lengkap
  if (hasReadyProvider && hasTransaction) return null;

  const steps: Step[] = [
    {
      id: "creds",
      label: "Atur kredensial provider",
      hint: "Set API key Midtrans / Xendit, atau login OTP OrderKuota",
      href: "/credentials",
      done: hasReadyProvider,
    },
    {
      id: "test",
      label: "Coba transaksi pertama",
      hint: "Bikin test charge untuk verifikasi semuanya jalan",
      href: "/test-charge",
      done: hasTransaction,
    },
    {
      id: "integrate",
      label: "Integrasi ke aplikasi Anda",
      hint: "Lihat docs untuk Node, PHP, Python, atau cURL",
      href: "/docs",
      done: false, // tidak ada cara deteksi otomatis — biarkan user klik manual
    },
  ];

  const completedCount = steps.filter((s) => s.done).length;
  const total = steps.length;
  const pct = (completedCount / total) * 100;

  return (
    <section className="card overflow-hidden border-brand-100">
      <div className="bg-gradient-to-br from-brand-50 via-white to-white p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-brand-700">
              <span>👋</span>
              <span>Selamat datang</span>
            </div>
            <h2 className="mt-1.5 text-lg font-bold tracking-tight text-slate-900 sm:text-xl">
              Setup Awal — {completedCount} dari {total} selesai
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Ikuti langkah berikut sekali saja, lalu gateway siap dipakai aplikasi Anda.
            </p>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold text-brand-700">
              {Math.round(pct)}%
            </div>
            <div className="text-[11px] text-slate-500">progress</div>
          </div>
        </div>

        {/* Progress bar */}
        <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-gradient-to-r from-brand-500 to-brand-400 transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>

        {/* Steps */}
        <ol className="mt-5 grid gap-2 sm:gap-3">
          {steps.map((s, i) => (
            <li key={s.id}>
              <Link
                href={s.href}
                className={`group flex items-start gap-3 rounded-lg border p-3 transition-all ${
                  s.done
                    ? "border-emerald-200 bg-emerald-50/40"
                    : "border-slate-200 bg-white hover:border-brand-300 hover:shadow-sm"
                }`}
              >
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                    s.done
                      ? "bg-emerald-500 text-white"
                      : "bg-slate-100 text-slate-600 group-hover:bg-brand-100 group-hover:text-brand-700"
                  }`}
                >
                  {s.done ? "✓" : i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div
                    className={`text-sm font-medium ${
                      s.done
                        ? "text-emerald-900 line-through decoration-emerald-400/60 decoration-2"
                        : "text-slate-900"
                    }`}
                  >
                    {s.label}
                  </div>
                  <div
                    className={`text-xs ${s.done ? "text-emerald-700" : "text-slate-500"}`}
                  >
                    {s.hint}
                  </div>
                </div>
                {!s.done && (
                  <span className="self-center text-slate-400 transition-transform group-hover:translate-x-0.5 group-hover:text-brand-600">
                    →
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/**
 * Heuristic: provider dianggap "siap" kalau punya semua field essential.
 * - midtrans/xendit/doku/tripay: cek field utama (serverKey/secretKey/apiKey)
 * - orderkuota: cek username + authToken
 */
function hasAnyReady(snap: CredentialsSnapshot): boolean {
  const checks: Array<[ProviderName, string[]]> = [
    ["midtrans", ["serverKey"]],
    ["xendit", ["secretKey"]],
    ["doku", ["clientId", "secretKey"]],
    ["tripay", ["apiKey", "privateKey", "merchantCode"]],
    ["orderkuota", ["username", "authToken"]],
  ];
  for (const [provider, requiredFields] of checks) {
    const fields = snap[provider];
    if (!fields) continue;
    const allFilled = requiredFields.every((f) => {
      const info = fields[f as keyof typeof fields];
      return info && info.source !== "empty";
    });
    if (allFilled) return true;
  }
  return false;
}
