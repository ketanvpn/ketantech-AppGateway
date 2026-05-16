"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { ALL_PROVIDERS, ProviderName, Settings } from "@/lib/types";

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getSettings()
      .then(setSettings)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  async function update(patch: Partial<Settings>) {
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const next = await api.updateSettings(patch);
      setSettings(next);
      setMessage("Tersimpan");
      setTimeout(() => setMessage(null), 1500);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  function moveProvider(name: ProviderName, dir: -1 | 1) {
    if (!settings) return;
    const order = [...settings.providerOrder];
    const idx = order.indexOf(name);
    const target = idx + dir;
    if (idx === -1 || target < 0 || target >= order.length) return;
    [order[idx], order[target]] = [order[target], order[idx]];
    update({ providerOrder: order });
  }

  function toggleInOrder(name: ProviderName) {
    if (!settings) return;
    const order = [...settings.providerOrder];
    const idx = order.indexOf(name);
    if (idx >= 0) {
      if (order.length === 1) return; // jangan kosongkan
      order.splice(idx, 1);
    } else {
      order.push(name);
    }
    update({ providerOrder: order });
  }

  function setForceDown(name: ProviderName, value: boolean) {
    update({ forceDown: { ...settings!.forceDown, [name]: value } });
  }

  if (loading) return <div className="text-slate-500">Memuat…</div>;
  if (!settings)
    return (
      <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        {error || "Gagal memuat settings"}
      </div>
    );

  const inactiveProviders = ALL_PROVIDERS.filter(
    (p) => !settings.providerOrder.includes(p),
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Settings</h1>
        <p className="text-sm text-slate-500">
          Perubahan langsung berlaku tanpa restart, tersimpan di SQLite, dan
          survive saat server di-restart.
        </p>

      </div>

      {message && (
        <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-700">
          {message}
        </div>
      )}
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="mb-1 text-base font-semibold text-slate-900">
          Provider Order (Fallback)
        </h2>
        <p className="mb-4 text-sm text-slate-500">
          Provider paling atas = primary. Jika gagal, otomatis fallback ke
          bawahnya. Klik provider untuk aktif/non-aktifkan.
        </p>
        <ul className="space-y-2">
          {settings.providerOrder.map((p, i) => (
            <li
              key={p}
              className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2"
            >
              <span className="font-medium capitalize text-slate-800">
                {i + 1}. {p}
              </span>
              <div className="flex gap-2">
                <button
                  disabled={saving || i === 0}
                  onClick={() => moveProvider(p, -1)}
                  className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs disabled:opacity-50"
                >
                  ↑
                </button>
                <button
                  disabled={saving || i === settings.providerOrder.length - 1}
                  onClick={() => moveProvider(p, 1)}
                  className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs disabled:opacity-50"
                >
                  ↓
                </button>
                <button
                  disabled={saving || settings.providerOrder.length === 1}
                  onClick={() => toggleInOrder(p)}
                  className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700 disabled:opacity-50"
                >
                  Nonaktifkan
                </button>
              </div>
            </li>
          ))}
        </ul>

        {inactiveProviders.length > 0 && (
          <div className="mt-4 border-t border-slate-100 pt-3">
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
              Tidak aktif
            </div>
            <ul className="space-y-2">
              {inactiveProviders.map((p) => (
                <li
                  key={p}
                  className="flex items-center justify-between rounded-md border border-dashed border-slate-200 px-3 py-2"
                >
                  <span className="font-medium capitalize text-slate-500">
                    {p}
                  </span>
                  <button
                    disabled={saving}
                    onClick={() => toggleInOrder(p)}
                    className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs disabled:opacity-50"
                  >
                    Aktifkan
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="mb-1 text-base font-semibold text-slate-900">
          Force-Down (Simulasi Provider Mati)
        </h2>
        <p className="mb-4 text-sm text-slate-500">
          Aktifkan untuk simulasi provider tidak tersedia. Berguna untuk
          mengetes mekanisme fallback.
        </p>
        {ALL_PROVIDERS.map((p) => (
          <Toggle
            key={p}
            label={`${p} force down`}
            value={settings.forceDown?.[p] ?? false}
            disabled={saving}
            onChange={(v) => setForceDown(p, v)}
          />
        ))}
      </div>
    </div>
  );
}

function Toggle({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="mb-2 flex cursor-pointer items-center justify-between rounded-md border border-slate-100 px-3 py-2">
      <span className="text-sm capitalize text-slate-700">{label}</span>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(!value)}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${
          value ? "bg-red-500" : "bg-slate-300"
        } disabled:opacity-50`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${
            value ? "translate-x-6" : "translate-x-1"
          }`}
        />
      </button>
    </label>
  );
}
