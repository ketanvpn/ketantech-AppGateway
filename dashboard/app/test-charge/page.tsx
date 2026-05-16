"use client";

import { useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { PaymentMethod, Transaction } from "@/lib/types";
import { StatusBadge } from "@/components/StatusBadge";

const METHODS: PaymentMethod[] = [
  "qris",
  "ewallet",
  "bank_transfer",
  "credit_card",
];

export default function TestChargePage() {
  const [orderId, setOrderId] = useState(`ORDER-${Date.now()}`);
  const [amount, setAmount] = useState(50000);
  const [method, setMethod] = useState<PaymentMethod>("qris");
  const [name, setName] = useState("Budi Hartono");
  const [email, setEmail] = useState("budi@example.com");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<Transaction | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setResult(null);
    try {
      const tx = await api.testCharge({
        orderId,
        amount: Number(amount),
        currency: "IDR",
        method,
        customer: { name, email },
        description: "Test charge dari dashboard",
      });
      setResult(tx);
      setOrderId(`ORDER-${Date.now()}`); // generate new untuk request berikutnya
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Test Charge</h1>
        <p className="text-sm text-slate-500">
          Coba kirim charge ke gateway dari sini. Useful untuk mengetes
          fallback &amp; melihat behaviour.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <form
          onSubmit={submit}
          className="space-y-4 rounded-lg border border-slate-200 bg-white p-5"
        >
          <Field label="Order ID">
            <input
              required
              value={orderId}
              onChange={(e) => setOrderId(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
            />
          </Field>

          <Field label="Amount (IDR)">
            <input
              type="number"
              min={1}
              required
              value={amount}
              onChange={(e) => setAmount(parseInt(e.target.value, 10) || 0)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
            />
          </Field>

          <Field label="Method">
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value as PaymentMethod)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
            >
              {METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Customer Name">
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
            />
          </Field>

          <Field label="Customer Email">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
            />
          </Field>

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {submitting ? "Mengirim…" : "Send Charge"}
          </button>
        </form>

        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-600">
            Hasil
          </h2>
          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}
          {!result && !error && (
            <div className="text-sm text-slate-500">
              Belum ada hasil. Submit form untuk mencoba.
            </div>
          )}
          {result && (
            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Status</span>
                <StatusBadge status={result.status} />
              </div>
              <Row label="Provider" value={result.providerName} />
              <Row label="Order ID" value={result.orderId} mono />
              <Row
                label="Amount"
                value={`${result.currency} ${result.amount.toLocaleString("id-ID")}`}
              />
              <Row
                label="Provider Tx ID"
                value={result.providerTransactionId || "—"}
                mono
              />
              <div className="text-xs text-slate-500">
                Attempts: {result.attempts.length}
              </div>
              <Link
                href={`/transactions/${result.id}`}
                className="inline-block text-sm font-medium text-brand-600 hover:text-brand-700"
              >
                Lihat detail →
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-600">
        {label}
      </label>
      {children}
    </div>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between border-b border-slate-100 pb-2">
      <span className="text-slate-500">{label}</span>
      <span
        className={`text-right text-slate-900 ${mono ? "font-mono text-xs" : ""}`}
      >
        {value}
      </span>
    </div>
  );
}
