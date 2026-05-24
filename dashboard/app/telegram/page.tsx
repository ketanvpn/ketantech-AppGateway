"use client";

import { useEffect, useState } from "react";
import { getApiBase, getAdminKey } from "@/lib/api";

interface TelegramConfig {
  botToken: string;
  botTokenSet: boolean;
  adminChatIds: string[];
  enabled: boolean;
  source: "env" | "db";
}

type Notice = { type: "success" | "error" | "info"; message: string } | null;

const COMMAND_GROUPS = [
  {
    title: "Monitoring",
    icon: "📊",
    items: [
      ["/stats", "Ringkasan transaksi & revenue"],
      ["/last [n]", "Transaksi terakhir"],
      ["/health", "Status provider pembayaran"],
    ],
  },
  {
    title: "Operasional",
    icon: "⚡",
    items: [
      ["/sync", "Sinkronisasi OrderKuota"],
      ["/refund <id>", "Refund transaksi"],
    ],
  },
  {
    title: "Provider",
    icon: "⚙️",
    items: [
      ["/settings", "Lihat konfigurasi gateway"],
      ["/provider order <list>", "Ubah urutan fallback"],
      ["/provider enable <name>", "Aktifkan provider"],
      ["/provider disable <name>", "Nonaktifkan provider"],
    ],
  },
];

export default function TelegramPage() {
  const [data, setData] = useState<TelegramConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<Notice>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [botToken, setBotToken] = useState("");
  const [chatIds, setChatIds] = useState("");
  const [reloading, setReloading] = useState(false);
  const [restarting, setRestarting] = useState(false);

  async function load() {
    try {
      const response = await fetch(`${getApiBase()}/api/v1/admin/telegram`, {
        headers: { "X-Admin-Key": getAdminKey() },
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || "Gagal memuat konfigurasi Telegram");

      setData(body.data);
      setBotToken("");
      setChatIds(body.data.adminChatIds.join(", "));
    } catch (e: any) {
      setNotice({ type: "error", message: e?.message || "Gagal memuat konfigurasi Telegram" });
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (!botToken.trim() && !chatIds.trim()) {
      setNotice({ type: "error", message: "Isi Bot Token atau Admin Chat IDs terlebih dahulu." });
      return;
    }

    setSaving(true);
    setNotice(null);

    try {
      const payload: { botToken?: string; adminChatIds?: string } = {};
      if (botToken.trim()) payload.botToken = botToken.trim();
      if (chatIds.trim()) payload.adminChatIds = chatIds.trim();

      const response = await fetch(`${getApiBase()}/api/v1/admin/telegram`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "X-Admin-Key": getAdminKey(),
        },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || "Gagal menyimpan konfigurasi Telegram");

      await load();
      setEditing(false);
      setNotice({ type: "success", message: "Konfigurasi Telegram tersimpan. Gunakan Reload Bot agar setting aktif tanpa restart penuh." });
    } catch (e: any) {
      setNotice({ type: "error", message: e?.message || "Gagal menyimpan konfigurasi Telegram" });
    } finally {
      setSaving(false);
    }
  }

  function handleEdit() {
    setEditing(true);
    setBotToken("");
    setChatIds(data?.adminChatIds.join(", ") || "");
    setNotice(null);
  }

  function handleCancel() {
    setEditing(false);
    setBotToken("");
    setChatIds(data?.adminChatIds.join(", ") || "");
    setNotice(null);
  }

  async function handleReloadBot() {
    setReloading(true);
    setNotice(null);

    try {
      const response = await fetch(`${getApiBase()}/api/v1/admin/telegram/reload`, {
        method: "POST",
        headers: { "X-Admin-Key": getAdminKey() },
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || "Gagal reload Telegram bot");

      await load();
      setNotice({ type: "success", message: body.message || "Telegram bot berhasil direload." });
    } catch (e: any) {
      setNotice({ type: "error", message: e?.message || "Gagal reload Telegram bot" });
    } finally {
      setReloading(false);
    }
  }

  async function handleRestartServer() {
    if (!confirm("Restart backend gateway sekarang?\n\nGunakan hanya jika reload bot tidak cukup atau setelah update code.")) return;

    setRestarting(true);
    setNotice(null);

    try {
      const response = await fetch(`${getApiBase()}/api/v1/admin/system/restart`, {
        method: "POST",
        headers: { "X-Admin-Key": getAdminKey() },
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message || "Server sedang restart");
      setNotice({ type: "info", message: `${body.message || "Server restart dimulai."} Halaman akan reload dalam 10 detik.` });
    } catch (e: any) {
      setNotice({ type: "info", message: "Server sedang restart. Halaman akan reload dalam 10 detik." });
    } finally {
      window.setTimeout(() => window.location.reload(), 10_000);
      setRestarting(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-44 animate-pulse rounded-2xl bg-slate-100" />
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="h-32 animate-pulse rounded-xl bg-slate-100" />
          <div className="h-32 animate-pulse rounded-xl bg-slate-100" />
          <div className="h-32 animate-pulse rounded-xl bg-slate-100" />
        </div>
      </div>
    );
  }

  if (!data) {
    return <NoticeBox notice={notice || { type: "error", message: "Gagal memuat konfigurasi Telegram" }} />;
  }

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="relative overflow-hidden bg-slate-950 p-6 text-white">
          <div className="absolute inset-0 opacity-30 [background:radial-gradient(circle_at_top_right,#38bdf8,transparent_35%),radial-gradient(circle_at_bottom_left,#2563eb,transparent_30%)]" />
          <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/15">
                <TelegramIcon className="h-7 w-7 text-sky-300" />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl font-bold tracking-tight">Telegram Operations Bot</h1>
                  <StatusPill enabled={data.enabled} />
                </div>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
                  Pusat kontrol notifikasi dan command operasional KetantechPay. Dipakai untuk alert transaksi,
                  monitor provider, sync, dan tindakan admin cepat dari Telegram.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={load}
                className="rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/15"
              >
                Refresh Status
              </button>
              <button
                onClick={handleReloadBot}
                disabled={reloading}
                className="rounded-lg bg-sky-500 px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-sky-400 disabled:opacity-50"
              >
                {reloading ? "Reloading…" : "Reload Bot"}
              </button>
            </div>
          </div>
        </div>
      </section>

      <NoticeBox notice={notice} />

      <section className="grid gap-4 lg:grid-cols-3">
        <MetricCard label="Bot Status" value={data.enabled ? "Online" : "Needs Setup"} tone={data.enabled ? "green" : "amber"} helper={data.enabled ? "Token & admin chat tersedia" : "Lengkapi token dan chat ID"} />
        <MetricCard label="Config Source" value={data.source === "db" ? "Dashboard" : ".env"} tone="blue" helper={data.source === "db" ? "Dikelola dari database settings" : "Dibaca dari environment"} />
        <MetricCard label="Admin Access" value={`${data.adminChatIds.length} chat`} tone={data.adminChatIds.length ? "slate" : "amber"} helper="Hanya chat ID terdaftar yang bisa command" />
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 p-5">
            <div>
              <h2 className="text-base font-semibold text-slate-950">Configuration</h2>
              <p className="mt-1 text-xs text-slate-500">Kelola token bot dan daftar admin yang berhak menerima alert.</p>
            </div>
            {!editing && (
              <button onClick={handleEdit} className="rounded-lg bg-slate-950 px-3 py-2 text-xs font-semibold text-white transition hover:bg-slate-800">
                Edit Config
              </button>
            )}
          </div>

          <div className="p-5">
            {editing ? (
              <div className="space-y-5">
                <Field label="Bot Token" hint="Kosongkan jika tidak ingin mengubah token aktif.">
                  <input
                    type="password"
                    value={botToken}
                    onChange={(e) => setBotToken(e.target.value)}
                    placeholder="123456:ABC-DEF..."
                    className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm font-mono outline-none transition focus:border-sky-500 focus:ring-4 focus:ring-sky-100"
                  />
                </Field>

                <Field label="Admin Chat IDs" hint="Pisahkan dengan koma. Contoh: 690744680, 123456789">
                  <textarea
                    value={chatIds}
                    onChange={(e) => setChatIds(e.target.value)}
                    rows={3}
                    placeholder="690744680, 123456789"
                    className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm font-mono outline-none transition focus:border-sky-500 focus:ring-4 focus:ring-sky-100"
                  />
                </Field>

                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                  <div className="font-semibold">Security note</div>
                  <p className="mt-1 text-xs leading-5">
                    Token tidak ditampilkan penuh. Simpan token asli hanya saat update, lalu gunakan Reload Bot agar perubahan aktif.
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button onClick={handleSave} disabled={saving} className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-700 disabled:opacity-50">
                    {saving ? "Saving…" : "Save Changes"}
                  </button>
                  <button onClick={handleCancel} disabled={saving} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-5">
                <ConfigRow label="Bot Token" value={data.botTokenSet ? data.botToken || "••••••••••••" : "Not configured"} ok={data.botTokenSet} mono />
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Admin Chat IDs</div>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">{data.adminChatIds.length} admin</span>
                  </div>
                  {data.adminChatIds.length ? (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {data.adminChatIds.map((chatId) => (
                        <div key={chatId} className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                          <span className="font-mono text-sm text-slate-800">{chatId}</span>
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">allowed</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Belum ada admin chat ID.</div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        <aside className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-950">Recommended Setup</h3>
            <ol className="mt-4 space-y-3 text-sm text-slate-600">
              <SetupStep n="1" title="Create bot" text="Buat bot via @BotFather dan simpan token." />
              <SetupStep n="2" title="Find chat ID" text="Kirim pesan ke bot, lalu cek getUpdates untuk chat.id." />
              <SetupStep n="3" title="Add admins" text="Masukkan chat ID admin yang boleh menerima alert/command." />
              <SetupStep n="4" title="Reload" text="Klik Reload Bot dan test command /health." />
            </ol>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-950">Quick Actions</h3>
            <div className="mt-4 space-y-3">
              <ActionButton title="Reload Telegram Bot" description="Apply konfigurasi bot tanpa restart backend penuh." onClick={handleReloadBot} busy={reloading} />
              <button
                onClick={handleRestartServer}
                disabled={restarting}
                className="w-full rounded-xl border border-red-200 bg-red-50 p-4 text-left transition hover:bg-red-100 disabled:opacity-50"
              >
                <div className="text-sm font-semibold text-red-700">Restart Backend Gateway</div>
                <div className="mt-1 text-xs leading-5 text-red-600">Gunakan hanya setelah update code atau jika reload tidak cukup.</div>
              </button>
            </div>
          </div>
        </aside>
      </section>

      {data.enabled && (
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 p-5">
            <h2 className="text-base font-semibold text-slate-950">Command Reference</h2>
            <p className="mt-1 text-xs text-slate-500">Command yang bisa dipakai admin terdaftar dari Telegram.</p>
          </div>
          <div className="grid gap-4 p-5 lg:grid-cols-3">
            {COMMAND_GROUPS.map((group) => (
              <div key={group.title} className="rounded-xl border border-slate-200 p-4">
                <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-950">
                  <span>{group.icon}</span>
                  <span>{group.title}</span>
                </div>
                <div className="space-y-3">
                  {group.items.map(([cmd, desc]) => (
                    <div key={cmd}>
                      <code className="rounded-md bg-slate-950 px-2 py-1 text-xs font-semibold text-sky-200">{cmd}</code>
                      <div className="mt-1 text-xs leading-5 text-slate-500">{desc}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-700">
        <div className="font-semibold text-slate-950">Security boundary</div>
        <p className="mt-1 leading-6">
          Bot hanya merespons chat ID yang terdaftar. Token disimpan masked/encrypted di backend settings; jangan taruh token penuh di screenshot atau repo.
        </p>
      </section>
    </div>
  );
}

function NoticeBox({ notice }: { notice: Notice }) {
  if (!notice) return null;
  const cls = notice.type === "success"
    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
    : notice.type === "info"
      ? "border-sky-200 bg-sky-50 text-sky-800"
      : "border-red-200 bg-red-50 text-red-800";
  return <div className={`rounded-xl border px-4 py-3 text-sm ${cls}`}>{notice.message}</div>;
}

function StatusPill({ enabled }: { enabled: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${enabled ? "bg-emerald-400/15 text-emerald-200 ring-1 ring-emerald-300/20" : "bg-amber-400/15 text-amber-200 ring-1 ring-amber-300/20"}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${enabled ? "bg-emerald-300" : "bg-amber-300"}`} />
      {enabled ? "Active" : "Inactive"}
    </span>
  );
}

function MetricCard({ label, value, helper, tone }: { label: string; value: string; helper: string; tone: "green" | "amber" | "blue" | "slate" }) {
  const tones = {
    green: "bg-emerald-50 text-emerald-700 ring-emerald-100",
    amber: "bg-amber-50 text-amber-700 ring-amber-100",
    blue: "bg-sky-50 text-sky-700 ring-sky-100",
    slate: "bg-slate-50 text-slate-700 ring-slate-100",
  };
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-3 inline-flex rounded-xl px-3 py-2 text-lg font-bold ring-1 ${tones[tone]}`}>{value}</div>
      <p className="mt-3 text-xs leading-5 text-slate-500">{helper}</p>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-sm font-semibold text-slate-900">{label}</div>
      <div className="mb-2 mt-1 text-xs text-slate-500">{hint}</div>
      {children}
    </label>
  );
}

function ConfigRow({ label, value, ok, mono }: { label: string; value: string; ok: boolean; mono?: boolean }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${ok ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{ok ? "configured" : "missing"}</span>
      </div>
      <div className={`rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-800 ${mono ? "font-mono" : ""}`}>{value}</div>
    </div>
  );
}

function SetupStep({ n, title, text }: { n: string; title: string; text: string }) {
  return (
    <li className="flex gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-950 text-xs font-bold text-white">{n}</span>
      <span>
        <span className="block font-semibold text-slate-900">{title}</span>
        <span className="text-xs leading-5 text-slate-500">{text}</span>
      </span>
    </li>
  );
}

function ActionButton({ title, description, onClick, busy }: { title: string; description: string; onClick: () => void; busy: boolean }) {
  return (
    <button onClick={onClick} disabled={busy} className="w-full rounded-xl border border-sky-200 bg-sky-50 p-4 text-left transition hover:bg-sky-100 disabled:opacity-50">
      <div className="text-sm font-semibold text-sky-800">{busy ? "Processing…" : title}</div>
      <div className="mt-1 text-xs leading-5 text-sky-700">{description}</div>
    </button>
  );
}

function TelegramIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69.01-.03.01-.14-.07-.2-.08-.06-.19-.04-.27-.02-.12.03-1.99 1.27-5.61 3.73-.53.36-1.01.54-1.44.53-.47-.01-1.38-.27-2.06-.49-.83-.27-1.49-.42-1.43-.88.03-.24.37-.49 1.02-.75 4-1.74 6.68-2.88 8.03-3.44 3.82-1.59 4.62-1.87 5.14-1.88.11 0 .37.03.54.17.14.11.18.26.2.37.01.08.03.29.01.45z" />
    </svg>
  );
}
