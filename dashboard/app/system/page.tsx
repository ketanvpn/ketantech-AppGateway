"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { SystemSettingsSnapshot } from "@/lib/types";

/**
 * System Settings page — diatur supaya ramah untuk operator non-teknis.
 * Tiap kartu punya:
 *  - Judul awam (bukan istilah teknis)
 *  - Penjelasan singkat: "ini apa, kapan kamu perlu ubah"
 *  - Status saat ini dengan visualisasi
 *  - Edit form yang minimal
 *  - Detail teknis di expand toggle (untuk yang penasaran)
 */
export default function SystemPage() {
  const [data, setData] = useState<SystemSettingsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      setData(await api.getSystem());
    } catch (e: any) {
      setError(e?.message || "Gagal memuat system settings");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function applyPatch(patch: any, successMsg = "Tersimpan") {
    setError(null);
    setMessage(null);
    try {
      const updated = await api.updateSystem(patch);
      setData(updated);
      setMessage(successMsg);
      setTimeout(() => setMessage(null), 2000);
    } catch (e: any) {
      setError(e?.message || "Gagal menyimpan");
    }
  }

  if (loading)
    return (
      <div className="space-y-4">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="card h-32 animate-pulse" />
        ))}
      </div>
    );
  if (!data)
    return (
      <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        {error || "Gagal memuat system settings"}
      </div>
    );

  return (
    <div className="space-y-6">
      {/* ── Pengantar untuk awam ─────────────────────────────── */}
      <div className="card overflow-hidden">
        <div className="border-b border-slate-100 bg-gradient-to-br from-brand-50 to-white p-5">
          <div className="flex items-start gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-100 text-brand-700">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-5 w-5"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="M12 8v4M12 16h.01" />
              </svg>
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-900">
                Apa ini?
              </div>
              <p className="mt-1 text-sm text-slate-700">
                Halaman ini buat ngatur <strong>aturan main</strong> gateway —
                kayak siapa yang boleh akses, berapa banyak transaksi boleh
                masuk per menit, dll. Kalau bingung, biarkan default-nya saja.
                Default sudah aman buat dipakai.
              </p>
              <p className="mt-2 text-xs text-slate-500">
                Tiap setting punya badge:{" "}
                <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-700">
                  default (.env)
                </span>{" "}
                atau{" "}
                <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">
                  diubah
                </span>
                . Tombol <em>Reset ke default</em> akan kembalikan ke nilai dari
                file konfigurasi awal.
              </p>
            </div>
          </div>
        </div>
      </div>

      {message && (
        <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
          <span>✓</span> {message}
        </div>
      )}
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* ── Cards ────────────────────────────────────────────── */}
      <ClientKeysCard
        snapshot={data.clientApiKeys}
        onSave={(keys) => applyPatch({ clientApiKeys: keys })}
        onClear={() =>
          applyPatch({ clientApiKeys: null }, "Kembali ke default")
        }
      />

      <RateLimitCard
        snapshot={data.rateLimit}
        onSave={(v) => applyPatch({ rateLimit: v })}
        onClear={() => applyPatch({ rateLimit: null }, "Kembali ke default")}
      />

      <RetryCard
        snapshot={data.retry}
        onSave={(v) => applyPatch({ retry: v })}
        onClear={() => applyPatch({ retry: null }, "Kembali ke default")}
      />

      <CorsCard
        snapshot={data.corsOrigins}
        onSave={(v) => applyPatch({ corsOrigins: v })}
        onClear={() => applyPatch({ corsOrigins: null }, "Kembali ke default")}
      />

      <TrustProxyCard
        snapshot={data.trustProxy}
        onSave={(v) => applyPatch({ trustProxy: v })}
        onClear={() => applyPatch({ trustProxy: null }, "Kembali ke default")}
      />

      <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
        ⚠️ <strong>Catatan:</strong> setting <em>API Key Aplikasi</em> langsung
        berlaku saat disimpan. Setting lain (Rate Limit, CORS, Trust Proxy)
        butuh <strong>restart server backend</strong> supaya benar-benar aktif.
      </div>
    </div>
  );
}

// ─── UI building blocks ─────────────────────────────────────

function Card({
  icon,
  iconBg,
  title,
  whatIs,
  whenChange,
  source,
  showClear,
  onClear,
  children,
}: {
  icon: React.ReactNode;
  iconBg: string;
  title: string;
  whatIs: string;
  whenChange: string;
  source: "db" | "env";
  showClear?: boolean;
  onClear?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="card overflow-hidden">
      <div className="border-b border-slate-100 bg-slate-50/40 p-5">
        <div className="flex items-start gap-3">
          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${iconBg}`}
          >
            {icon}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
              <SourceBadge source={source} />
              {showClear && (
                <button
                  onClick={onClear}
                  className="ml-auto inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                >
                  ↺ Kembali ke default
                </button>
              )}
            </div>
            <div className="mt-1.5 grid gap-1 text-xs text-slate-600 sm:grid-cols-2">
              <div>
                <span className="font-semibold text-slate-700">Apa ini:</span>{" "}
                {whatIs}
              </div>
              <div>
                <span className="font-semibold text-slate-700">
                  Kapan diubah:
                </span>{" "}
                {whenChange}
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function SourceBadge({ source }: { source: "db" | "env" }) {
  if (source === "db") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-800">
        <span className="h-1 w-1 rounded-full bg-blue-500" />
        Diubah
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-700">
      <span className="h-1 w-1 rounded-full bg-slate-400" />
      Default
    </span>
  );
}

// ─── Per-setting cards ──────────────────────────────────────

function ClientKeysCard({
  snapshot,
  onSave,
  onClear,
}: {
  snapshot: SystemSettingsSnapshot["clientApiKeys"];
  onSave: (keys: string[]) => void;
  onClear: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [newKey, setNewKey] = useState("");

  return (
    <Card
      icon={<IconLock />}
      iconBg="bg-violet-100 text-violet-700"
      title="API Key Aplikasi"
      whatIs="Password rahasia yang dipakai aplikasi web/mobile Anda buat akses gateway ini."
      whenChange="Saat ada aplikasi baru yang mau pakai gateway, atau saat key bocor."
      source={snapshot.source}
      showClear={snapshot.source === "db"}
      onClear={onClear}
    >
      <div className="rounded-md bg-slate-50 p-3 text-xs text-slate-600">
        Saat ini ada{" "}
        <strong className="text-slate-900">{snapshot.count}</strong> key aktif.{" "}
        {snapshot.count === 0 ? (
          <span className="text-amber-700">
            ⚠ Mode terbuka — siapa pun yang bisa akses URL gateway bisa charge.
            Hanya OK kalau gateway di-deploy di network internal.
          </span>
        ) : (
          <span className="text-slate-600">
            Aplikasi yang panggil gateway harus kirim key ini di header{" "}
            <code className="rounded bg-white px-1 text-[10px]">
              X-Client-Key
            </code>
            .
          </span>
        )}
      </div>

      {snapshot.count > 0 && (
        <ul className="mt-3 space-y-1.5">
          {snapshot.previews.map((preview, i) => (
            <li
              key={i}
              className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2"
            >
              <span className="font-mono text-xs text-slate-700">
                Key #{i + 1}: {preview}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3">
        {!adding ? (
          <button
            onClick={() => setAdding(true)}
            className="btn-primary text-xs"
          >
            + Tambah / Ganti Key
          </button>
        ) : (
          <div className="space-y-2">
            <input
              type="text"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              placeholder="Tempel key baru di sini (minimal 8 karakter)"
              className="input font-mono text-xs"
              autoFocus
            />
            <div className="flex gap-2">
              <button
                onClick={() => {
                  if (newKey.trim().length < 8) {
                    alert("Key minimal 8 karakter");
                    return;
                  }
                  if (snapshot.count > 0) {
                    if (
                      !window.confirm(
                        `Saat ini sudah ada ${snapshot.count} key. Setelah simpan, semua key lama akan diganti dengan key baru ini saja. Aplikasi yang masih pakai key lama akan kehilangan akses. Lanjut?`,
                      )
                    )
                      return;
                  }
                  onSave([newKey.trim()]);
                  setNewKey("");
                  setAdding(false);
                }}
                className="btn-primary text-xs"
              >
                Simpan
              </button>
              <button
                onClick={() => {
                  setAdding(false);
                  setNewKey("");
                }}
                className="btn-secondary text-xs"
              >
                Batal
              </button>
            </div>
            <p className="text-[11px] text-slate-500">
              💡 Mau bikin key baru yang aman? Buka terminal, ketik:{" "}
              <code className="rounded bg-slate-100 px-1 text-[10px]">
                node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
              </code>
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}

function RateLimitCard({
  snapshot,
  onSave,
  onClear,
}: {
  snapshot: SystemSettingsSnapshot["rateLimit"];
  onSave: (v: { windowMs: number; max: number }) => void;
  onClear: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [windowSec, setWindowSec] = useState(snapshot.value.windowMs / 1000);
  const [max, setMax] = useState(snapshot.value.max);

  return (
    <Card
      icon={<IconShield />}
      iconBg="bg-sky-100 text-sky-700"
      title="Batas Request per Menit"
      whatIs="Berapa banyak transaksi boleh dilakukan dari satu pelanggan / IP dalam waktu tertentu."
      whenChange="Saat ada serangan / abuse (turunkan), atau saat traffic tinggi (naikkan)."
      source={snapshot.source}
      showClear={snapshot.source === "db"}
      onClear={onClear}
    >
      {!editing ? (
        <div className="flex items-center justify-between">
          <div className="text-sm text-slate-700">
            Saat ini:{" "}
            <strong className="text-slate-900">{snapshot.value.max}</strong>{" "}
            request per{" "}
            <strong className="text-slate-900">
              {snapshot.value.windowMs / 1000} detik
            </strong>{" "}
            per pelanggan
          </div>
          <button
            onClick={() => setEditing(true)}
            className="btn-secondary text-xs"
          >
            Ubah
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Maksimal request</label>
              <input
                type="number"
                min={1}
                max={100000}
                value={max}
                onChange={(e) => setMax(Number(e.target.value))}
                className="input"
              />
            </div>
            <div>
              <label className="label">Dalam berapa detik</label>
              <input
                type="number"
                min={1}
                max={3600}
                value={windowSec}
                onChange={(e) => setWindowSec(Number(e.target.value))}
                className="input"
              />
            </div>
          </div>
          <div className="rounded-md bg-slate-50 p-2 text-[11px] text-slate-600">
            💡 Contoh praktis:
            <ul className="mt-1 ml-4 list-disc space-y-0.5">
              <li>
                <strong>100 / 60 detik</strong> — default, cocok untuk mayoritas
                website
              </li>
              <li>
                <strong>30 / 60 detik</strong> — agresif, anti-bot/scraper
              </li>
              <li>
                <strong>500 / 60 detik</strong> — toleran, untuk traffic tinggi
              </li>
            </ul>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => {
                onSave({ windowMs: windowSec * 1000, max });
                setEditing(false);
              }}
              className="btn-primary text-xs"
            >
              Simpan
            </button>
            <button
              onClick={() => setEditing(false)}
              className="btn-secondary text-xs"
            >
              Batal
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}

function RetryCard({
  snapshot,
  onSave,
  onClear,
}: {
  snapshot: SystemSettingsSnapshot["retry"];
  onSave: (v: { maxAttempts: number; baseDelayMs: number }) => void;
  onClear: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [maxAttempts, setMaxAttempts] = useState(snapshot.value.maxAttempts);
  const [baseDelayMs, setBaseDelayMs] = useState(snapshot.value.baseDelayMs);

  return (
    <Card
      icon={<IconRefresh />}
      iconBg="bg-emerald-100 text-emerald-700"
      title="Coba Ulang Otomatis"
      whatIs="Kalau provider pembayaran (mis. Midtrans) sempat down, gateway akan retry otomatis sebelum nyerah & pindah ke provider lain."
      whenChange="Biasanya tidak perlu diubah. Default 3 kali sudah pas."
      source={snapshot.source}
      showClear={snapshot.source === "db"}
      onClear={onClear}
    >
      {!editing ? (
        <div className="flex items-center justify-between">
          <div className="text-sm text-slate-700">
            Saat ini: retry{" "}
            <strong className="text-slate-900">
              {snapshot.value.maxAttempts}
            </strong>{" "}
            kali, jeda awal{" "}
            <strong className="text-slate-900">
              {snapshot.value.baseDelayMs} ms
            </strong>{" "}
            (jeda makin lama tiap retry)
          </div>
          <button
            onClick={() => setEditing(true)}
            className="btn-secondary text-xs"
          >
            Ubah
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Berapa kali retry (1-10)</label>
              <input
                type="number"
                min={1}
                max={10}
                value={maxAttempts}
                onChange={(e) => setMaxAttempts(Number(e.target.value))}
                className="input"
              />
            </div>
            <div>
              <label className="label">Jeda awal (milidetik)</label>
              <input
                type="number"
                min={0}
                max={60000}
                value={baseDelayMs}
                onChange={(e) => setBaseDelayMs(Number(e.target.value))}
                className="input"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => {
                onSave({ maxAttempts, baseDelayMs });
                setEditing(false);
              }}
              className="btn-primary text-xs"
            >
              Simpan
            </button>
            <button
              onClick={() => setEditing(false)}
              className="btn-secondary text-xs"
            >
              Batal
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}

function CorsCard({
  snapshot,
  onSave,
  onClear,
}: {
  snapshot: SystemSettingsSnapshot["corsOrigins"];
  onSave: (v: string[]) => void;
  onClear: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(snapshot.value.join("\n"));

  return (
    <Card
      icon={<IconGlobe />}
      iconBg="bg-orange-100 text-orange-700"
      title="Domain yang Boleh Akses Dashboard"
      whatIs="Daftar alamat website yang diizinkan buka dashboard ini. Default: localhost (komputer Anda saja)."
      whenChange="Saat dashboard dipasang di domain production (mis. admin.tokoanda.com)."
      source={snapshot.source}
      showClear={snapshot.source === "db"}
      onClear={onClear}
    >
      {!editing ? (
        <div className="flex items-start justify-between gap-3">
          <ul className="flex-1 space-y-1 text-sm">
            {snapshot.value.length === 0 ? (
              <li className="text-slate-400">Tidak ada</li>
            ) : (
              snapshot.value.map((o) => (
                <li
                  key={o}
                  className="rounded bg-slate-50 px-2 py-1 font-mono text-xs text-slate-700"
                >
                  {o}
                </li>
              ))
            )}
          </ul>
          <button
            onClick={() => {
              setText(snapshot.value.join("\n"));
              setEditing(true);
            }}
            className="btn-secondary text-xs"
          >
            Ubah
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <label className="label">Satu domain per baris</label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="https://admin.tokoanda.com&#10;https://staging.tokoanda.com"
            rows={4}
            className="input font-mono text-xs"
          />
          <div className="rounded-md bg-amber-50 p-2 text-[11px] text-amber-700">
            ⚠ Jangan pakai <code>*</code> di production — itu artinya{" "}
            <em>siapa pun</em> boleh akses, kurang aman.
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => {
                const list = text
                  .split("\n")
                  .map((s) => s.trim())
                  .filter(Boolean);
                onSave(list);
                setEditing(false);
              }}
              className="btn-primary text-xs"
            >
              Simpan
            </button>
            <button
              onClick={() => setEditing(false)}
              className="btn-secondary text-xs"
            >
              Batal
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}

function TrustProxyCard({
  snapshot,
  onSave,
  onClear,
}: {
  snapshot: SystemSettingsSnapshot["trustProxy"];
  onSave: (v: boolean | number | string) => void;
  onClear: () => void;
}) {
  const v = snapshot.value;
  const isOn = v === true || (typeof v === "number" && v > 0);

  return (
    <Card
      icon={<IconServer />}
      iconBg="bg-slate-100 text-slate-700"
      title="Server di Belakang Cloudflare / Load Balancer?"
      whatIs="Setting teknis: kalau server gateway dipasang di belakang Cloudflare / nginx / AWS ELB, aktifkan ini biar IP pelanggan ke-baca dengan benar (penting untuk rate limit)."
      whenChange="Saat deploy ke production di belakang reverse proxy. Untuk dev/localhost, biarkan off."
      source={snapshot.source}
      showClear={snapshot.source === "db"}
      onClear={onClear}
    >
      <div className="flex items-center justify-between">
        <div className="text-sm text-slate-700">
          Saat ini:{" "}
          {isOn ? (
            <span className="inline-flex items-center gap-1.5 font-medium text-emerald-700">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Aktif
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 font-medium text-slate-500">
              <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
              Mati
            </span>
          )}
        </div>
        <div className="flex gap-2">
          {!isOn && (
            <button
              onClick={() => onSave(true)}
              className="btn-primary text-xs"
            >
              Aktifkan
            </button>
          )}
          {isOn && (
            <button
              onClick={() => onSave(false)}
              className="btn-secondary text-xs"
            >
              Matikan
            </button>
          )}
        </div>
      </div>
    </Card>
  );
}

// ─── Inline icons ───────────────────────────────────────────

const ip = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "2",
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  className: "h-5 w-5",
};

function IconLock() {
  return (
    <svg {...ip}>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
      <circle cx="12" cy="16" r="1" fill="currentColor" />
    </svg>
  );
}
function IconShield() {
  return (
    <svg {...ip}>
      <path d="M12 2 4 5v6c0 5.5 3.5 10.5 8 11 4.5-.5 8-5.5 8-11V5l-8-3z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}
function IconRefresh() {
  return (
    <svg {...ip}>
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16" />
      <path d="M3 21v-5h5" />
    </svg>
  );
}
function IconGlobe() {
  return (
    <svg {...ip}>
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15 15 0 0 1 4 10 15 15 0 0 1-4 10 15 15 0 0 1-4-10 15 15 0 0 1 4-10z" />
    </svg>
  );
}
function IconServer() {
  return (
    <svg {...ip}>
      <rect x="3" y="4" width="18" height="6" rx="2" />
      <rect x="3" y="14" width="18" height="6" rx="2" />
      <line x1="6" y1="7" x2="6.01" y2="7" />
      <line x1="6" y1="17" x2="6.01" y2="17" />
    </svg>
  );
}
