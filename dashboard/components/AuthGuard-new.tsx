"use client";

import { useEffect, useState } from "react";
import { getAdminKey, getApiBase, setAdminKey, setApiBase } from "@/lib/api";

/**
 * Login modern & profesional dengan auto-detect base URL
 */
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [hasKey, setHasKey] = useState(false);
  const [keyInput, setKeyInput] = useState("");
  const [baseInput, setBaseInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    setHasKey(Boolean(getAdminKey()));
    // Auto-detect base URL dari current domain
    const currentBase = typeof window !== 'undefined' 
      ? `${window.location.protocol}//${window.location.host}`
      : 'http://localhost:3000';
    setBaseInput(getApiBase() || currentBase);
    setReady(true);
  }, []);

  if (!ready) return null;

  if (!hasKey) {
    return (
      <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-4">
        {/* Animated gradient backdrop */}
        <div className="pointer-events-none absolute inset-0 opacity-30">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-500/20 via-purple-500/20 to-cyan-500/20 animate-pulse" 
               style={{ animationDuration: '8s' }} />
        </div>
        
        {/* Grid pattern */}
        <div className="pointer-events-none absolute inset-0 opacity-10"
             style={{
               backgroundImage: 'linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)',
               backgroundSize: '50px 50px'
             }} />

        {/* Login Card */}
        <div className="relative w-full max-w-md">
          {/* Logo & Title */}
          <div className="mb-8 text-center">
            <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center">
              <img src="/logo.svg" alt="KetantechPay" className="h-20 w-20 drop-shadow-2xl" />
            </div>
            <h1 className="text-3xl font-bold text-white mb-2">
              KetantechPay
            </h1>
            <p className="text-slate-400 text-sm">
              Multi-Provider Payment Gateway
            </p>
          </div>

          {/* Login Form Card */}
          <div className="relative rounded-2xl border border-slate-800/50 bg-slate-900/50 p-8 shadow-2xl backdrop-blur-xl">
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!keyInput.trim()) return;
                setError(null);
                setLoggingIn(true);
                
                try {
                  const base = baseInput.trim() || `${window.location.protocol}//${window.location.host}`;
                  
                  // Test admin key
                  const res = await fetch(`${base}/api/v1/admin/stats`, {
                    headers: { "X-Admin-Key": keyInput.trim() },
                  });

                  if (!res.ok) {
                    const data = await res.json().catch(() => ({}));
                    throw new Error(data.message || "API key tidak valid");
                  }

                  // Save & reload
                  setApiBase(base);
                  setAdminKey(keyInput.trim());
                  setHasKey(true);
                  window.location.reload();
                } catch (err: any) {
                  setError(err.message || "Gagal login. Periksa API key Anda.");
                  setLoggingIn(false);
                }
              }}
              className="space-y-6"
            >
              {/* API Key Input */}
              <div>
                <label htmlFor="apiKey" className="block text-sm font-medium text-slate-300 mb-2">
                  Admin API Key
                </label>
                <input
                  id="apiKey"
                  type="password"
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  placeholder="Masukkan API key Anda"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800/50 px-4 py-3 text-white placeholder-slate-500 transition focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  disabled={loggingIn}
                  autoFocus
                />
              </div>

              {/* Advanced Settings Toggle */}
              <button
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="text-sm text-slate-400 hover:text-slate-300 transition"
              >
                {showAdvanced ? '▼' : '▶'} Advanced Settings
              </button>

              {/* API Base URL (Advanced) */}
              {showAdvanced && (
                <div className="animate-fade-in">
                  <label htmlFor="apiBase" className="block text-sm font-medium text-slate-300 mb-2">
                    API Base URL
                  </label>
                  <input
                    id="apiBase"
                    type="text"
                    value={baseInput}
                    onChange={(e) => setBaseInput(e.target.value)}
                    placeholder="https://pay.ketantech.my.id"
                    className="w-full rounded-lg border border-slate-700 bg-slate-800/50 px-4 py-3 text-white placeholder-slate-500 transition focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                    disabled={loggingIn}
                  />
                  <p className="mt-2 text-xs text-slate-500">
                    Auto-detected: {typeof window !== 'undefined' ? `${window.location.protocol}//${window.location.host}` : ''}
                  </p>
                </div>
              )}

              {/* Error Message */}
              {error && (
                <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                  ⚠️ {error}
                </div>
              )}

              {/* Submit Button */}
              <button
                type="submit"
                disabled={loggingIn || !keyInput.trim()}
                className="w-full rounded-lg bg-gradient-to-r from-blue-600 to-cyan-600 px-4 py-3 font-semibold text-white shadow-lg shadow-blue-500/30 transition hover:from-blue-500 hover:to-cyan-500 hover:shadow-blue-500/50 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:from-blue-600 disabled:hover:to-cyan-600"
              >
                {loggingIn ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Verifying...
                  </span>
                ) : (
                  'Login to Dashboard'
                )}
              </button>
            </form>

            {/* Footer Info */}
            <div className="mt-6 text-center text-xs text-slate-500">
              <p>Secure admin access · API key stored locally</p>
            </div>
          </div>

          {/* Version */}
          <div className="mt-6 text-center text-xs text-slate-600">
            KetantechPay v1.0 · by Ketantech
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
