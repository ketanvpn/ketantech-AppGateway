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

export default function TelegramPage() {
  const [data, setData] = useState<TelegramConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [botToken, setBotToken] = useState("");
  const [chatIds, setChatIds] = useState("");
  const [reloading, setReloading] = useState(false);
  const [restarting, setRestarting] = useState(false);

  async function load() {
    setError(null);
    try {
      const response = await fetch(`${getApiBase()}/api/v1/admin/telegram`, {
        headers: {
          "X-Admin-Key": getAdminKey(),
        },
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.message || "Gagal memuat konfigurasi");
      }
      setData(body.data);
      setBotToken("");
      setChatIds(body.data.adminChatIds.join(", "));
    } catch (e: any) {
      setError(e?.message || "Gagal memuat konfigurasi Telegram");
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (!botToken && !chatIds) {
      alert("Minimal isi salah satu field");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const payload: any = {};
      if (botToken) payload.botToken = botToken;
      if (chatIds) payload.adminChatIds = chatIds;

      const response = await fetch(`${getApiBase()}/api/v1/admin/telegram`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "X-Admin-Key": getAdminKey(),
        },
        body: JSON.stringify(payload),
      });

      const body = await response.json();

      if (!response.ok) {
        // Jika 501 (Not Implemented), tampilkan instruksi
        if (response.status === 501) {
          alert(
            `${body.message}\n\n` +
            `Instruksi:\n` +
            `1. ${body.instructions.step1}\n` +
            `2. ${body.instructions.step2}\n` +
            `3. ${body.instructions.step3}\n` +
            `4. ${body.instructions.step4}`
          );
        } else {
          throw new Error(body.message || "Gagal menyimpan");
        }
      } else {
        alert("Berhasil menyimpan! Restart server untuk apply perubahan.");
        await load();
        setEditing(false);
      }
    } catch (e: any) {
      setError(e?.message || "Gagal menyimpan konfigurasi");
    } finally {
      setSaving(false);
    }
  }

  function handleEdit() {
    setEditing(true);
    setBotToken("");
    setChatIds(data?.adminChatIds.join(", ") || "");
  }

  function handleCancel() {
    setEditing(false);
    setBotToken("");
    setChatIds(data?.adminChatIds.join(", ") || "");
    setError(null);
  }

  async function handleReloadBot() {
    if (!confirm("Reload Telegram bot dengan settings baru dari .env?\n\nPastikan Anda sudah edit file .env terlebih dahulu.")) {
      return;
    }

    setReloading(true);
    setError(null);

    try {
      const response = await fetch(`${getApiBase()}/api/v1/admin/telegram/reload`, {
        method: "POST",
        headers: {
          "X-Admin-Key": getAdminKey(),
        },
      });

      const body = await response.json();

      if (!response.ok) {
        throw new Error(body.message || "Gagal reload bot");
      }

      alert("✅ " + body.message);
      await load();
    } catch (e: any) {
      setError(e?.message || "Gagal reload bot");
      alert("❌ " + (e?.message || "Gagal reload bot"));
    } finally {
      setReloading(false);
    }
  }

  async function handleRestartServer() {
    if (!confirm("⚠️ RESTART SERVER?\n\nServer akan mati dan restart otomatis (jika menggunakan PM2/systemd).\n\nJika run manual dengan npm, server akan mati tanpa restart!\n\nLanjutkan?")) {
      return;
    }

    setRestarting(true);
    setError(null);

    try {
      const response = await fetch(`${getApiBase()}/api/v1/admin/system/restart`, {
        method: "POST",
        headers: {
          "X-Admin-Key": getAdminKey(),
        },
      });

      const body = await response.json();

      if (!response.ok) {
        throw new Error(body.message || "Gagal restart server");
      }

      alert("🔄 " + body.message + "\n\nHalaman akan reload otomatis dalam 10 detik...");
      
      // Auto reload halaman setelah 10 detik
      setTimeout(() => {
        window.location.reload();
      }, 10000);
    } catch (e: any) {
      // Error expected karena server mati
      if (e?.message?.includes("fetch")) {
        alert("🔄 Server sedang restart...\n\nHalaman akan reload otomatis dalam 10 detik.");
        setTimeout(() => {
          window.location.reload();
        }, 10000);
      } else {
        setError(e?.message || "Gagal restart server");
        alert("❌ " + (e?.message || "Gagal restart server"));
      }
    } finally {
      setRestarting(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="card h-32 animate-pulse" />
        <div className="card h-64 animate-pulse" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        {error || "Gagal memuat konfigurasi Telegram"}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="card overflow-hidden">
        <div className="border-b border-slate-100 bg-gradient-to-br from-blue-50 to-white p-5">
          <div className="flex items-start gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-100 text-blue-700">
              <svg
                viewBox="0 0 24 24"
                fill="currentColor"
                className="h-6 w-6"
              >
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69.01-.03.01-.14-.07-.2-.08-.06-.19-.04-.27-.02-.12.03-1.99 1.27-5.61 3.73-.53.36-1.01.54-1.44.53-.47-.01-1.38-.27-2.06-.49-.83-.27-1.49-.42-1.43-.88.03-.24.37-.49 1.02-.75 4-1.74 6.68-2.88 8.03-3.44 3.82-1.59 4.62-1.87 5.14-1.88.11 0 .37.03.54.17.14.11.18.26.2.37.01.08.03.29.01.45z" />
              </svg>
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-900">
                Telegram Bot
              </div>
              <p className="mt-1 text-sm text-slate-700">
                Konfigurasi bot Telegram untuk notifikasi dan kontrol gateway
                via chat. Bot bisa kirim alert saat ada transaksi sukses/gagal,
                provider down, dan menerima command untuk monitoring & pengaturan.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Status Card */}
      <div className="card">
        <div className="border-b border-slate-100 bg-slate-50/40 p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">
              {editing ? "Edit Konfigurasi" : "Status Saat Ini"}
            </h2>
            <div className="flex items-center gap-2">
              {data.enabled ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-700">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  Aktif
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                  <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
                  Tidak Aktif
                </span>
              )}
              {!editing && (
                <button
                  onClick={handleEdit}
                  className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 transition"
                >
                  Edit
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="p-5 space-y-4">
          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700">
              {error}
            </div>
          )}

          {editing ? (
            <>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Bot Token <span className="text-slate-500">(opsional, kosongkan jika tidak ingin ubah)</span>
                </label>
                <input
                  type="text"
                  value={botToken}
                  onChange={(e) => setBotToken(e.target.value)}
                  placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs font-mono focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <p className="mt-1 text-xs text-slate-500">
                  Token dari @BotFather di Telegram
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Admin Chat IDs <span className="text-slate-500">(pisahkan dengan koma)</span>
                </label>
                <input
                  type="text"
                  value={chatIds}
                  onChange={(e) => setChatIds(e.target.value)}
                  placeholder="123456789, 987654321"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs font-mono focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <p className="mt-1 text-xs text-slate-500">
                  Chat ID admin yang boleh menggunakan bot (dapatkan dari /getUpdates)
                </p>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="rounded-md bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition"
                >
                  {saving ? "Menyimpan..." : "Simpan"}
                </button>
                <button
                  onClick={handleCancel}
                  disabled={saving}
                  className="rounded-md border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition"
                >
                  Batal
                </button>
              </div>

              <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800">
                ⚠️ <strong>Catatan:</strong> Perubahan memerlukan restart server untuk apply. Setelah save, jalankan <code className="rounded bg-amber-100 px-1">npm run dev</code> atau <code className="rounded bg-amber-100 px-1">npm start</code>
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Bot Token
                </label>
                {data.botTokenSet ? (
                  <div className="flex items-center gap-2">
                    <code className="flex-1 rounded-md bg-slate-50 px-3 py-2 font-mono text-xs text-slate-700">
                      {data.botToken}
                    </code>
                    <span className="text-xs text-emerald-600">✓ Terisi</span>
                  </div>
                ) : (
                  <div className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">
                    ⚠ Belum diset
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Admin Chat IDs ({data.adminChatIds.length})
                </label>
                {data.adminChatIds.length > 0 ? (
                  <ul className="space-y-1">
                    {data.adminChatIds.map((chatId, i) => (
                      <li
                        key={i}
                        className="flex items-center gap-2 rounded-md bg-slate-50 px-3 py-2"
                      >
                        <span className="font-mono text-xs text-slate-700">
                          {chatId}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">
                    ⚠ Belum ada chat ID yang terdaftar
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Setup Instructions */}
      <div className="card">
        <div className="border-b border-slate-100 bg-slate-50/40 p-5">
          <h2 className="text-sm font-semibold text-slate-900">
            Cara Setup Telegram Bot
          </h2>
        </div>

        <div className="p-5 space-y-4">
          <div className="space-y-3">
            <div className="flex gap-3">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-blue-700">
                1
              </div>
              <div className="flex-1">
                <div className="text-sm font-medium text-slate-900">
                  Buat Bot di Telegram
                </div>
                <p className="mt-1 text-xs text-slate-600">
                  Buka Telegram, cari <code className="rounded bg-slate-100 px-1">@BotFather</code>,
                  kirim command <code className="rounded bg-slate-100 px-1">/newbot</code>.
                  Ikuti instruksi untuk membuat bot baru. Simpan token yang diberikan.
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-blue-700">
                2
              </div>
              <div className="flex-1">
                <div className="text-sm font-medium text-slate-900">
                  Dapatkan Chat ID Anda
                </div>
                <p className="mt-1 text-xs text-slate-600">
                  Kirim pesan ke bot Anda, lalu buka:{" "}
                  <code className="rounded bg-slate-100 px-1 text-[10px]">
                    https://api.telegram.org/bot&lt;YOUR_BOT_TOKEN&gt;/getUpdates
                  </code>
                  <br />
                  Cari field <code className="rounded bg-slate-100 px-1">chat.id</code> di response JSON.
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-blue-700">
                3
              </div>
              <div className="flex-1">
                <div className="text-sm font-medium text-slate-900">
                  Edit File .env
                </div>
                <p className="mt-1 text-xs text-slate-600 mb-2">
                  Buka file <code className="rounded bg-slate-100 px-1">.env</code> di root project,
                  tambahkan atau edit baris berikut:
                </p>
                <pre className="rounded-md bg-slate-900 p-3 text-xs text-slate-100 overflow-x-auto">
{`TELEGRAM_BOT_TOKEN=123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11
TELEGRAM_ADMIN_CHAT_IDS=123456789,987654321`}
                </pre>
                <p className="mt-2 text-xs text-slate-500">
                  💡 Untuk multiple admin, pisahkan chat ID dengan koma
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-blue-700">
                4
              </div>
              <div className="flex-1">
                <div className="text-sm font-medium text-slate-900">
                  Restart Server
                </div>
                <p className="mt-1 text-xs text-slate-600">
                  Restart backend gateway dengan command:
                </p>
                <pre className="mt-2 rounded-md bg-slate-900 p-3 text-xs text-slate-100">
                  npm run dev
                </pre>
                <p className="mt-2 text-xs text-slate-500">
                  Atau untuk production: <code className="rounded bg-slate-100 px-1">npm start</code>
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-semibold text-emerald-700">
                ✓
              </div>
              <div className="flex-1">
                <div className="text-sm font-medium text-slate-900">
                  Test Bot
                </div>
                <p className="mt-1 text-xs text-slate-600">
                  Kirim command <code className="rounded bg-slate-100 px-1">/help</code> ke bot Anda.
                  Jika bot membalas dengan daftar command, setup berhasil!
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Available Commands */}
      {data.enabled && (
        <div className="card">
          <div className="border-b border-slate-100 bg-slate-50/40 p-5">
            <h2 className="text-sm font-semibold text-slate-900">
              Command yang Tersedia
            </h2>
          </div>

          <div className="p-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-md border border-slate-200 p-3">
                <div className="text-xs font-semibold text-slate-900 mb-2">
                  📊 Monitoring
                </div>
                <ul className="space-y-1 text-xs text-slate-600">
                  <li><code className="text-blue-600">/stats</code> — Statistik hari ini</li>
                  <li><code className="text-blue-600">/last [n]</code> — Transaksi terakhir</li>
                  <li><code className="text-blue-600">/health</code> — Status provider</li>
                </ul>
              </div>

              <div className="rounded-md border border-slate-200 p-3">
                <div className="text-xs font-semibold text-slate-900 mb-2">
                  ⚡ Actions
                </div>
                <ul className="space-y-1 text-xs text-slate-600">
                  <li><code className="text-blue-600">/sync</code> — Sync OrderKuota</li>
                  <li><code className="text-blue-600">/refund &lt;id&gt;</code> — Refund transaksi</li>
                </ul>
              </div>

              <div className="rounded-md border border-slate-200 p-3 sm:col-span-2">
                <div className="text-xs font-semibold text-slate-900 mb-2">
                  ⚙️ Settings
                </div>
                <ul className="space-y-1 text-xs text-slate-600">
                  <li><code className="text-blue-600">/settings</code> — Lihat konfigurasi</li>
                  <li><code className="text-blue-600">/provider order &lt;list&gt;</code> — Ubah urutan fallback</li>
                  <li><code className="text-blue-600">/provider enable &lt;name&gt;</code> — Aktifkan provider</li>
                  <li><code className="text-blue-600">/provider disable &lt;name&gt;</code> — Nonaktifkan provider</li>
                </ul>
              </div>
            </div>

            <div className="mt-4 rounded-md bg-blue-50 p-3 text-xs text-blue-700">
              💡 <strong>Notifikasi Otomatis:</strong> Bot akan mengirim alert saat ada pembayaran sukses/gagal,
              refund, atau provider down.
            </div>
          </div>
        </div>
      )}

      {/* Quick Actions */}
      <div className="card">
        <div className="border-b border-slate-100 bg-slate-50/40 p-5">
          <h2 className="text-sm font-semibold text-slate-900">
            Quick Actions
          </h2>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {/* Reload Bot */}
            <div className="rounded-lg border border-slate-200 p-4">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-100 text-blue-700">
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </div>
                <div className="flex-1">
                  <h3 className="text-sm font-semibold text-slate-900">
                    Reload Bot
                  </h3>
                  <p className="mt-1 text-xs text-slate-600">
                    Reload Telegram bot dengan settings baru dari .env tanpa restart server
                  </p>
                  <button
                    onClick={handleReloadBot}
                    disabled={reloading}
                    className="mt-3 rounded-md bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition"
                  >
                    {reloading ? "Reloading..." : "🔄 Reload Bot"}
                  </button>
                </div>
              </div>
            </div>

            {/* Restart Server */}
            <div className="rounded-lg border border-red-200 p-4 bg-red-50/30">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-red-100 text-red-700">
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </div>
                <div className="flex-1">
                  <h3 className="text-sm font-semibold text-slate-900">
                    Restart Server
                  </h3>
                  <p className="mt-1 text-xs text-slate-600">
                    Restart seluruh server (butuh PM2/systemd untuk auto-restart)
                  </p>
                  <button
                    onClick={handleRestartServer}
                    disabled={restarting}
                    className="mt-3 rounded-md bg-red-600 px-4 py-2 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50 transition"
                  >
                    {restarting ? "Restarting..." : "⚠️ Restart Server"}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-md bg-slate-50 border border-slate-200 p-3 text-xs text-slate-700">
            <strong>Kapan menggunakan:</strong>
            <ul className="mt-2 space-y-1 ml-4 list-disc">
              <li><strong>Reload Bot:</strong> Setelah edit TELEGRAM_BOT_TOKEN atau TELEGRAM_ADMIN_CHAT_IDS di .env</li>
              <li><strong>Restart Server:</strong> Setelah update code, install dependencies, atau perubahan besar lainnya</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Security Note */}
      <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-xs text-amber-800">
        🔒 <strong>Keamanan:</strong> Hanya chat ID yang terdaftar di{" "}
        <code className="rounded bg-amber-100 px-1">TELEGRAM_ADMIN_CHAT_IDS</code> yang bisa
        menggunakan command bot. Orang lain yang coba akses akan diabaikan secara silent.
      </div>
    </div>
  );
}
