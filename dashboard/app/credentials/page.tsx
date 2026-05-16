"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import {
  ALL_PROVIDERS,
  CredentialField,
  CredentialsSnapshot,
  FIELD_LABELS,
  FIELDS_BY_PROVIDER,
  ProviderName,
} from "@/lib/types";
import { useToast } from "@/components/Toast";

export default function CredentialsPage() {
  const toast = useToast();
  const [data, setData] = useState<CredentialsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const d = await api.getCredentials();
      setData(d);
      setError(null);
    } catch (e: any) {
      setError(e?.message || "Gagal memuat credentials");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function update(
    provider: ProviderName,
    field: CredentialField,
    value: string,
  ) {
    try {
      const d = await api.updateCredential(provider, field, value);
      setData(d);
      toast.success(value === "" ? "Override dihapus" : "Tersimpan");
    } catch (e: any) {
      toast.error(e?.message || "Gagal menyimpan");
    }
  }

  if (loading) return <div className="text-slate-500">Memuat…</div>;
  if (!data)
    return (
      <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        {error || "Gagal memuat credentials"}
      </div>
    );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">
          Provider Credentials
        </h1>
        <p className="text-sm text-slate-500">
          Atur API key & base URL per provider. Nilai di sini menimpa{" "}
          <code>.env</code> dan tersimpan di SQLite (survive restart).
          Kosongkan untuk hapus override dan kembali ke <code>.env</code>.
        </p>
      </div>

      <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">

        ⚠️ <strong>Keamanan:</strong> Secrets disimpan di file SQLite local
        (<code>./data/gateway.db</code>). Untuk produksi sungguhan, lebih baik
        pakai secrets manager (AWS Secrets Manager, HashiCorp Vault, dll).
      </div>

      {ALL_PROVIDERS.map((provider) => (
        <ProviderSection
          key={provider}
          provider={provider}
          snapshot={data[provider]}
          onSave={(field, value) => update(provider, field, value)}
        />
      ))}
    </div>
  );
}

function ProviderSection({
  provider,
  snapshot,
  onSave,
}: {
  provider: ProviderName;
  snapshot: CredentialsSnapshot[ProviderName];
  onSave: (field: CredentialField, value: string) => Promise<void>;
}) {
  const fields = FIELDS_BY_PROVIDER[provider];
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="mb-4 text-base font-semibold capitalize text-slate-900">
        {provider}
      </h2>
      <div className="space-y-4">
        {fields.map((f) => (
          <CredentialFieldRow
            key={f}
            label={FIELD_LABELS[f]}
            field={f}
            info={snapshot?.[f]}
            onSave={(v) => onSave(f, v)}
          />
        ))}
      </div>
    </div>
  );
}

function CredentialFieldRow({
  label,
  field: _field,
  info,
  onSave,
}: {
  label: string;
  field: CredentialField;
  info?: { value: string; isSecret: boolean; source: "db" | "env" | "empty" };
  onSave: (value: string) => Promise<void>;
}) {

  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  const source = info?.source ?? "empty";
  const masked = info?.value ?? "";
  const isSecret = info?.isSecret ?? false;

  async function save() {
    setBusy(true);
    try {
      await onSave(draft);
      setDraft("");
      setEditing(false);
    } finally {
      setBusy(false);
    }
  }

  async function clearOverride() {
    if (!window.confirm(`Hapus ${label}? Akan jatuh balik ke .env.`)) return;
    setBusy(true);
    try {
      await onSave("");
      setDraft("");
      setEditing(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-b border-slate-100 pb-3 last:border-0 last:pb-0">
      <div className="mb-1 flex items-center justify-between">
        <label className="text-xs font-medium uppercase tracking-wide text-slate-600">
          {label}
        </label>
        <SourceBadge source={source} />
      </div>

      {!editing && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 flex-1 break-all font-mono text-sm text-slate-800">
            {masked || (
              <span className="text-slate-400">— belum diset —</span>
            )}
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              onClick={() => setEditing(true)}
              className="flex-1 rounded-md border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 sm:flex-none"
            >
              {source === "empty" ? "Set" : "Edit"}
            </button>
            {source === "db" && (
              <button
                onClick={clearOverride}
                disabled={busy}
                className="flex-1 rounded-md border border-red-200 bg-red-50 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-50 sm:flex-none"
              >
                Hapus
              </button>
            )}
          </div>
        </div>
      )}

      {editing && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            type={isSecret ? "password" : "text"}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={
              isSecret ? `Masukkan ${label} baru…` : `https://...`
            }
            className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-2 font-mono text-sm focus:border-brand-500 focus:outline-none"
            autoFocus
          />
          <div className="flex gap-2">
            <button
              onClick={save}
              disabled={busy || !draft.trim()}
              className="flex-1 rounded-md bg-brand-600 px-3 py-2 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50 sm:flex-none"
            >
              Simpan
            </button>
            <button
              onClick={() => {
                setEditing(false);
                setDraft("");
              }}
              disabled={busy}
              className="flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 sm:flex-none"
            >
              Batal
            </button>
          </div>
        </div>
      )}

    </div>
  );
}

function SourceBadge({ source }: { source: "db" | "env" | "empty" }) {
  if (source === "db") {
    return (
      <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-800">
        Dashboard
      </span>
    );
  }
  if (source === "env") {
    return (
      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
        .env
      </span>
    );
  }
  return (
    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
      Belum diset
    </span>
  );
}
