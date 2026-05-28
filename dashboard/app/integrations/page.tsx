"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { WebhookTarget } from "@/lib/types";

const EVENT_OPTIONS = ["success", "failed", "expired", "refunded"] as const;

type EditableTarget = {
  id: string;
  name: string;
  url: string;
  secret: string;
  secretMasked?: string;
  enabled: boolean;
  events: Array<(typeof EVENT_OPTIONS)[number]>;
};

function slugifyAppName(name: string): string {
  const s = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "app";
}

function randomHex(bytes = 16): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export default function IntegrationsPage() {
  const [items, setItems] = useState<EditableTarget[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string>("");

  useEffect(() => {
    (async () => {
      try {
        const rows = await api.getWebhookTargets();
        setItems(
          rows.map((r: WebhookTarget) => ({
            id: r.id,
            name: r.name,
            url: r.url,
            secret: "",
            secretMasked: r.secretMasked,
            enabled: r.enabled,
            events: (r.events?.filter((e) => EVENT_OPTIONS.includes(e as any)) as EditableTarget["events"]) || ["success"],
          })),
        );
      } catch (e: any) {
        setMsg(`Gagal load: ${e?.message || "unknown error"}`);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const addItem = () => {
    setItems((prev) => [
      ...prev,
      {
        id: `app-${Date.now()}`,
        name: "",
        url: "",
        secret: "",
        enabled: true,
        events: ["success"],
      },
    ]);
  };

  const save = async () => {
    setSaving(true);
    setMsg("");
    try {
      const payload = items.map((i) => ({
        id: i.id.trim(),
        name: i.name.trim(),
        url: i.url.trim(),
        secret: i.secret.trim(),
        enabled: i.enabled,
        events: i.events,
      }));
      const saved = await api.updateWebhookTargets(payload);
      const maskedMap = new Map(saved.map((s) => [s.id, s.secretMasked || ""]));
      setMsg("✅ Tersimpan. Webhook multi-app sudah aktif.");
      setItems((prev) =>
        prev.map((p) => ({
          ...p,
          secret: "",
          secretMasked: maskedMap.get(p.id) || p.secretMasked,
        })),
      );
    } catch (e: any) {
      setMsg(`❌ Gagal simpan: ${e?.message || "unknown error"}`);
    } finally {
      setSaving(false);
    }
  };

  const enabledCount = items.filter((x) => x.enabled).length;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Integrasi App (Webhook Hub)</h1>
            <p className="mt-1 text-sm text-slate-500">
              Daftarkan banyak aplikasi (WebVPN, WiFi, dll). KetantechPay akan kirim update status otomatis.
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            {items.length} app • {enabledCount} aktif
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700 shadow-sm">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Checklist Cepat</p>
        <ol className="ml-5 list-decimal space-y-1">
          <li>Isi URL webhook aplikasi tujuan.</li>
          <li>Isi secret yang sama dengan secret di aplikasi tujuan.</li>
          <li>Pilih event minimal <code>success</code>, lalu aktifkan toggle.</li>
        </ol>
      </div>

      {loading ? (
        <div className="text-sm text-slate-500">Loading...</div>
      ) : (
        <div className="space-y-4">
          {items.map((item, idx) => (
            <div key={idx} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
              <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900">{item.name || "App Baru"}</p>
                  <p className="text-xs text-slate-500">ID: {item.id || "-"}</p>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${item.enabled ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                  {item.enabled ? "Aktif" : "Nonaktif"}
                </span>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <input
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  placeholder="ID (contoh: webvpn-prod)"
                  value={item.id}
                  onChange={(e) =>
                    setItems((prev) => prev.map((p, i) => (i === idx ? { ...p, id: e.target.value } : p)))
                  }
                />
                <input
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  placeholder="Nama App"
                  value={item.name}
                  onChange={(e) =>
                    setItems((prev) => prev.map((p, i) => (i === idx ? { ...p, name: e.target.value } : p)))
                  }
                />
                <input
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-2"
                  placeholder="https://appmu.com/api/webhooks/ketantechpay"
                  value={item.url}
                  onChange={(e) =>
                    setItems((prev) => prev.map((p, i) => (i === idx ? { ...p, url: e.target.value } : p)))
                  }
                />
                <input
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-2"
                  placeholder="Secret (isi ulang saat edit/simpan)"
                  value={item.secret}
                  onChange={(e) =>
                    setItems((prev) => prev.map((p, i) => (i === idx ? { ...p, secret: e.target.value } : p)))
                  }
                />
                <div className="md:col-span-2 flex justify-end">
                  <button
                    type="button"
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-50"
                    onClick={() => {
                      const prefix = slugifyAppName(item.name || item.id);
                      const generated = `whsec_${prefix}_${randomHex(20)}`;
                      setItems((prev) =>
                        prev.map((p, i) => (i === idx ? { ...p, secret: generated } : p)),
                      );
                    }}
                  >
                    Generate Secret
                  </button>
                </div>
                {item.secretMasked && !item.secret && (
                  <div className="md:col-span-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                    Secret tersimpan: <code>{item.secretMasked}</code>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-3 text-sm border-t border-slate-100 pt-3">
                <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5">
                  <input
                    type="checkbox"
                    checked={item.enabled}
                    onChange={(e) =>
                      setItems((prev) => prev.map((p, i) => (i === idx ? { ...p, enabled: e.target.checked } : p)))
                    }
                  />
                  Aktif
                </label>

                <div className="flex flex-wrap gap-2">
                  {EVENT_OPTIONS.map((ev) => {
                    const checked = item.events.includes(ev);
                    return (
                      <label key={ev} className={`flex items-center gap-1 rounded-lg border px-2.5 py-1 ${checked ? "border-brand-300 bg-brand-50 text-brand-700" : "border-slate-200"}`}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            setItems((prev) =>
                              prev.map((p, i) => {
                                if (i !== idx) return p;
                                const next = e.target.checked
                                  ? [...p.events, ev]
                                  : p.events.filter((x) => x !== ev);
                                return { ...p, events: next.length ? next : ["success"] };
                              }),
                            );
                          }}
                        />
                        {ev}
                      </label>
                    );
                  })}
                </div>

                <button
                  className="ml-auto rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
                  onClick={() => setItems((prev) => prev.filter((_, i) => i !== idx))}
                >
                  Hapus
                </button>
              </div>
            </div>
          ))}

          <div className="flex gap-2">
            <button onClick={addItem} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50">
              + Tambah App
            </button>
            <button onClick={save} disabled={saving} className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60">
              {saving ? "Menyimpan..." : "Simpan Semua"}
            </button>
          </div>

          {msg && <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm">{msg}</div>}
        </div>
      )}
    </div>
  );
}
