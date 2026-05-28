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
  enabled: boolean;
  events: Array<(typeof EVENT_OPTIONS)[number]>;
};

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
      await api.updateWebhookTargets(payload);
      setMsg("✅ Tersimpan. Webhook multi-app sudah aktif.");
      setItems((prev) => prev.map((p) => ({ ...p, secret: "" })));
    } catch (e: any) {
      setMsg(`❌ Gagal simpan: ${e?.message || "unknown error"}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Integrasi App (Webhook Hub)</h1>
        <p className="text-sm text-slate-500">
          Daftarkan banyak aplikasi (WebVPN, WiFi, dll). KetantechPay akan kirim update status otomatis.
        </p>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-700">
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
            <div key={idx} className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
              <div className="grid gap-3 md:grid-cols-2">
                <input
                  className="rounded border px-3 py-2 text-sm"
                  placeholder="ID (contoh: webvpn-prod)"
                  value={item.id}
                  onChange={(e) =>
                    setItems((prev) => prev.map((p, i) => (i === idx ? { ...p, id: e.target.value } : p)))
                  }
                />
                <input
                  className="rounded border px-3 py-2 text-sm"
                  placeholder="Nama App"
                  value={item.name}
                  onChange={(e) =>
                    setItems((prev) => prev.map((p, i) => (i === idx ? { ...p, name: e.target.value } : p)))
                  }
                />
                <input
                  className="rounded border px-3 py-2 text-sm md:col-span-2"
                  placeholder="https://appmu.com/api/webhooks/ketantechpay"
                  value={item.url}
                  onChange={(e) =>
                    setItems((prev) => prev.map((p, i) => (i === idx ? { ...p, url: e.target.value } : p)))
                  }
                />
                <input
                  className="rounded border px-3 py-2 text-sm md:col-span-2"
                  placeholder="Secret (isi ulang saat edit/simpan)"
                  value={item.secret}
                  onChange={(e) =>
                    setItems((prev) => prev.map((p, i) => (i === idx ? { ...p, secret: e.target.value } : p)))
                  }
                />
              </div>

              <div className="flex flex-wrap items-center gap-3 text-sm">
                <label className="flex items-center gap-2">
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
                      <label key={ev} className="flex items-center gap-1 rounded border px-2 py-1">
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
                  className="ml-auto rounded border px-3 py-1.5 text-xs text-red-700"
                  onClick={() => setItems((prev) => prev.filter((_, i) => i !== idx))}
                >
                  Hapus
                </button>
              </div>
            </div>
          ))}

          <div className="flex gap-2">
            <button onClick={addItem} className="rounded border px-3 py-2 text-sm">
              + Tambah App
            </button>
            <button onClick={save} disabled={saving} className="rounded bg-brand-600 px-3 py-2 text-sm text-white">
              {saving ? "Menyimpan..." : "Simpan Semua"}
            </button>
          </div>

          {msg && <div className="text-sm">{msg}</div>}
        </div>
      )}
    </div>
  );
}
