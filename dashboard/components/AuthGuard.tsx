"use client";

import { useEffect, useState } from "react";
import { getAdminKey, getApiBase, setAdminKey, setApiBase } from "@/lib/api";

/**
 * Login sederhana berbasis Admin API Key (disimpan di localStorage).
 * Dashboard ini bukan untuk publik — berjalan di environment internal.
 */
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [hasKey, setHasKey] = useState(false);
  const [keyInput, setKeyInput] = useState("");
  const [baseInput, setBaseInput] = useState("http://localhost:3000");
  const [error, setError] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);

  useEffect(() => {
    setHasKey(Boolean(getAdminKey()));
    setBaseInput(getApiBase());
    setReady(true);
  }, []);

  if (!ready) return null;

  if (!hasKey) {
    return (
      <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-950 p-4">
        {/* Decorative gradient backdrop */}
        <div
          className="pointer-events-none absolute inset-0 opacity-50"
          style={{
            background:
              "radial-gradient(60% 50% at 50% 0%, rgb(61 99 235 / 0.35) 0%, transparent 70%)",
          }}
        />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-500/40 to-transparent" />

        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!keyInput.trim()) return;
            setError(null);
            setLoggingIn(true);
            try {
              const base = baseInput.trim() || "http://localhost:3000";
              // Test admin key sebelum simpan — biar user gak masuk dengan key salah
              const res = await fetch(`${base}/api/v1/admin/stats`, {
                headers: { "X-Admin-Key": keyInput.trim() },
              });
              if (!res.ok) {
                setError(
                  res.status === 401
                    ? "Admin key salah"
                    : `Gagal konek: ${res.status} ${res.statusText}`,
                );
                return;
              }
              setApiBase(base);
              setAdminKey(keyInput.trim());
              setHasKey(true);
            } catch (err: any) {
              setError(
                `Tidak bisa konek ke ${baseInput}. Pastikan backend jalan.`,
              );
            } finally {
              setLoggingIn(false);
            }
          }}
          className="relative z-10 w-full max-w-md animate-slide-up rounded-2xl border border-white/10 bg-slate-900/80 p-7 shadow-2xl backdrop-blur"
        >
          {/* Logo */}
          <div className="mb-6 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 shadow-lg shadow-brand-700/40">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-6 w-6 text-white"
              >
                <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
              </svg>
            </div>
            <div>
              <h1 className="text-lg font-semibold text-white">
                KetantechPay
              </h1>

              <p className="text-xs text-slate-400">Admin Dashboard</p>
            </div>
          </div>

          <p className="mb-6 text-sm text-slate-300">
            Login dengan Admin API Key. Lihat <code className="rounded bg-white/10 px-1 text-xs">.env</code> di backend untuk nilai default-nya.
          </p>

          <div className="mb-4">
            <label className="mb-1.5 block text-xs font-medium text-slate-300">
              API Base URL
            </label>
            <input
              type="url"
              value={baseInput}
              onChange={(e) => setBaseInput(e.target.value)}
              className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 font-mono text-xs text-slate-100 placeholder:text-slate-500 focus:border-brand-400 focus:bg-white/10 focus:ring-2 focus:ring-brand-400/30"
              placeholder="http://localhost:3000"
            />
          </div>

          <div className="mb-2">
            <label className="mb-1.5 block text-xs font-medium text-slate-300">
              Admin API Key
            </label>
            <input
              type="password"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 font-mono text-xs text-slate-100 placeholder:text-slate-500 focus:border-brand-400 focus:bg-white/10 focus:ring-2 focus:ring-brand-400/30"
              placeholder="••••••••••••••••"
              autoFocus
            />
          </div>

          {error && (
            <div className="mb-4 mt-3 flex items-start gap-2 rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              <span>⚠</span>
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={loggingIn}
            className="mt-5 w-full rounded-md bg-gradient-to-r from-brand-500 to-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-brand-700/30 transition-all hover:from-brand-400 hover:to-brand-500 disabled:opacity-50"
          >
            {loggingIn ? "Memverifikasi…" : "Login"}
          </button>

          <p className="mt-4 text-center text-[11px] text-slate-500">
            Default dev key:{" "}
            <code className="rounded bg-white/10 px-1.5 py-0.5 text-slate-300">
              dev-admin-key-change-me
            </code>
          </p>
        </form>
      </div>
    );
  }

  return <>{children}</>;
}

export function LogoutButton() {
  return (
    <button
      onClick={() => {
        if (typeof window === "undefined") return;
        window.localStorage.removeItem("adminApiKey");
        window.location.reload();
      }}
      className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-3.5 w-3.5"
      >
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
      </svg>
      Logout
    </button>
  );
}
