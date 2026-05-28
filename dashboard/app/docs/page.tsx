"use client";

import { useState } from "react";
import { CodeBlock } from "@/components/CodeBlock";
import {
  CURL_CHARGE,
  CURL_GET,
  NODEJS_CLIENT,
  NODEJS_USAGE,
  PHP_CLIENT,
  PHP_USAGE,
  PYTHON_CLIENT,
  PYTHON_USAGE,
  RESPONSE_201,
  RESPONSE_503,
} from "./snippets";

type Lang = "node" | "php" | "python" | "curl";
type DocTab = "guide" | "api";

const LANG_TABS: { value: Lang; label: string; emoji: string }[] = [
  { value: "node", label: "Node.js", emoji: "🟩" },
  { value: "php", label: "PHP / Laravel", emoji: "🟪" },
  { value: "python", label: "Python", emoji: "🟦" },
  { value: "curl", label: "cURL", emoji: "🟫" },
];

export default function DocsPage() {
  const [lang, setLang] = useState<Lang>("node");
  const [docTab, setDocTab] = useState<DocTab>("guide");

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">
          Integration Docs
        </h1>
        <p className="text-sm text-slate-500">
          Panduan pasang Payment Gateway ini ke aplikasi internal Anda. Pilih
          bahasa, copy-paste code, jalan.
        </p>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-3">
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setDocTab("guide")}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
              docTab === "guide"
                ? "bg-brand-600 text-white"
                : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
            }`}
          >
            📘 Panduan Lengkap
          </button>
          <button
            onClick={() => setDocTab("api")}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
              docTab === "api"
                ? "bg-brand-600 text-white"
                : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
            }`}
          >
            ⚡ API & Webhook (Singkat)
          </button>
        </div>
      </section>

      {docTab === "api" && (
        <>
          <Section title="Yang Dibutuhkan (untuk awam)">
            <ul className="space-y-2 text-sm text-slate-700">
              <Check>
                Punya <code>BASE_URL</code> gateway (contoh: <code>https://pay.ketantech.my.id</code>)
              </Check>
              <Check>
                Saat bikin pembayaran, panggil <code>POST /api/v1/payments/charge</code>
              </Check>
              <Check>
                Wajib kirim header <code>Idempotency-Key</code> (anti double charge)
              </Check>
              <Check>
                Simpan <code>transactionId</code> dari response, lalu cek status via <code>GET /api/v1/payments/:id</code>
              </Check>
            </ul>
          </Section>

          <Section title="Endpoint Inti">
            <ApiBlock method="POST" path="/api/v1/payments/charge" desc="Buat tagihan baru" />
            <ApiBlock method="GET" path="/api/v1/payments/:id" desc="Cek status transaksi" />
            <ApiBlock method="GET" path="/api/v1/payments?orderId=..." desc="Cek transaksi pakai orderId Anda" />
          </Section>

          <Section title="Webhook (Ini Lokasinya)">
            <p className="mb-3 text-sm text-slate-700">
              Webhook dipakai provider untuk kirim update status pembayaran ke gateway Anda.
            </p>
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
              <div><code>POST /api/v1/webhooks/midtrans</code></div>
              <div><code>POST /api/v1/webhooks/xendit</code></div>
              <div><code>POST /api/v1/webhooks/doku</code></div>
              <div><code>POST /api/v1/webhooks/tripay</code></div>
            </div>
            <p className="mt-3 text-xs text-slate-500">
              Contoh URL production: <code>https://pay.ketantech.my.id/api/v1/webhooks/midtrans</code>
            </p>
          </Section>

          <Section title="Integrasi Banyak App (WebVPN, WiFi, dll)">
            <ol className="ml-5 list-decimal space-y-2 text-sm text-slate-700">
              <li>Setiap aplikasi punya endpoint webhook sendiri.</li>
              <li>Di aplikasi tujuan, simpan <strong>Webhook Secret</strong>.</li>
              <li>
                Di KetantechPay, tambah target di <code>/api/v1/admin/webhook-targets</code> (url + secret + events).
              </li>
              <li>Status pembayaran berubah → KetantechPay broadcast ke target yang aktif.</li>
            </ol>

            <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Contoh Payload Target</div>
              <CodeBlock
                language="json"
                code={`{
  "targets": [
    {
      "id": "webvpn-prod",
      "name": "WebVPN Production",
      "url": "https://webvpn-domain.com/api/webhooks/ketantechpay",
      "secret": "secret-webvpn-prod-32-char",
      "enabled": true,
      "events": ["success", "failed", "expired", "refunded"]
    },
    {
      "id": "wifi-prod",
      "name": "WiFi Voucher Production",
      "url": "https://wifi-domain.com/api/webhooks/ketantechpay",
      "secret": "secret-wifi-prod-32-char",
      "enabled": true,
      "events": ["success"]
    }
  ]
}`}
              />
            </div>
          </Section>

          <Section title="Alur Super Singkat">
            <ol className="ml-5 list-decimal space-y-2 text-sm text-slate-700">
              <li>App Anda create charge.</li>
              <li>User bayar via paymentUrl.</li>
              <li>Provider kirim webhook ke endpoint di atas.</li>
              <li>Status transaksi berubah ke success/failed/expired.</li>
              <li>App Anda cek status by transactionId.</li>
            </ol>
          </Section>
        </>
      )}

      {docTab === "guide" && (
        <>

      {/* ── Section 0: Pengantar untuk awam ──────────────────────── */}
      <section className="overflow-hidden rounded-xl border border-brand-100 bg-gradient-to-br from-brand-50/60 via-white to-white p-6 shadow-soft">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-brand-700">
          <span>👋</span> Untuk yang Belum Familiar
        </div>
        <h2 className="mt-2 text-lg font-bold tracking-tight text-slate-900">
          Apa itu Payment Gateway ini?
        </h2>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div>
            <p className="text-sm leading-relaxed text-slate-700">
              Bayangkan Anda punya warung online. Anda mau terima pembayaran
              lewat <strong>QRIS, transfer bank, e-wallet</strong>. Biasanya
              Anda harus daftar di Midtrans, Xendit, DOKU, dll satu per satu —
              dan masing-masing punya cara integrasi sendiri.
            </p>
            <p className="mt-3 text-sm leading-relaxed text-slate-700">
              Aplikasi ini adalah <strong>perantara</strong>. Aplikasi web /
              mobile Anda tinggal panggil <strong>satu URL</strong>, gateway
              yang urus mau pakai provider mana. Kalau Midtrans down, otomatis
              pindah ke Xendit. Aplikasi Anda tidak perlu tahu detailnya.
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="text-xs font-semibold uppercase text-slate-500">
              Analogi
            </div>
            <p className="mt-2 text-sm leading-relaxed text-slate-700">
              Mirip <strong>Gojek</strong> — Anda pesan makanan dari satu app,
              tapi di belakang ada banyak driver dari banyak warung. Anda nggak
              peduli driver A atau B yang antar, asal pesanan sampai. Gateway
              ini juga begitu: Anda nggak peduli Midtrans atau Xendit yang
              proses, asal pembayaran sukses.
            </p>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <FeatureChip
            icon="🔄"
            title="Auto Fallback"
            text="Provider down? Otomatis pindah."
          />
          <FeatureChip
            icon="🔁"
            title="Retry Pintar"
            text="Coba lagi sebelum nyerah."
          />
          <FeatureChip
            icon="🛡️"
            title="Anti Double Charge"
            text="Pelanggan klik 2x? Tetap charge sekali."
          />
        </div>
      </section>

      <Section title="1. Bagaimana Kerjanya">
        <p className="text-sm leading-relaxed text-slate-700">
          Aplikasi internal Anda cukup memanggil <strong>satu endpoint</strong>{" "}
          (<code>POST /api/v1/payments/charge</code>). Gateway akan memilih
          provider, fallback otomatis kalau ada yang down, retry pada error
          sementara, dan mencegah double-charge via idempotency key.
        </p>
        <FlowDiagram />
        <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
          📖 <strong>Istilah yang sering muncul:</strong>
          <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">
            <div>
              <dt className="font-semibold text-slate-800">Endpoint</dt>
              <dd className="text-slate-600">
                Alamat URL yang dipanggil aplikasi Anda
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-slate-800">Provider</dt>
              <dd className="text-slate-600">
                Layanan pembayaran (Midtrans, Xendit, dll)
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-slate-800">Webhook</dt>
              <dd className="text-slate-600">
                Notifikasi otomatis dari provider saat pelanggan bayar
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-slate-800">Charge</dt>
              <dd className="text-slate-600">
                Buat tagihan / minta pelanggan bayar
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-slate-800">Idempotency Key</dt>
              <dd className="text-slate-600">
                Kode unik biar pelanggan tidak ke-charge dobel
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-slate-800">Fallback</dt>
              <dd className="text-slate-600">
                Pindah otomatis ke provider lain kalau yang utama bermasalah
              </dd>
            </div>
          </dl>
        </div>
      </Section>


      <Section title="2. Aturan Wajib">
        <ul className="space-y-2 text-sm text-slate-700">
          <Rule>
            <strong>Header <code>Idempotency-Key</code> wajib</strong> di setiap
            POST /charge. Cegah double-charge saat retry.
          </Rule>
          <Rule>
            Idempotency key harus <strong>unik per attempt logikal</strong>{" "}
            (contoh: <code>{"`${orderId}-${uuid}`"}</code>).
          </Rule>
          <Rule>
            Set <strong>timeout 10 detik</strong> dari sisi app. Jangan biarkan
            request menggantung.
          </Rule>
          <Rule>
            Retry hanya pada <strong>5xx & network error</strong>. Jangan retry
            pada 400 / 401.
          </Rule>
          <Rule>
            <strong>Source of truth = gateway</strong>. Polling status via{" "}
            <code>GET /api/v1/payments/:id</code>, jangan dari DB lokal.
          </Rule>
        </ul>
      </Section>

      <Section title="3. Quick Start">
        <div className="mb-4 flex flex-wrap gap-2">
          {LANG_TABS.map((t) => (
            <button
              key={t.value}
              onClick={() => setLang(t.value)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                lang === t.value
                  ? "bg-brand-600 text-white"
                  : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              <span className="mr-1">{t.emoji}</span>
              {t.label}
            </button>
          ))}
        </div>

        {lang === "node" && (
          <div className="space-y-4">
            <Step n={1} title="Drop client wrapper ke project Anda">
              <CodeBlock
                code={NODEJS_CLIENT}
                language="javascript"
                filename="PaymentGatewayClient.js"
              />
            </Step>
            <Step n={2} title="Pakai di route handler">
              <CodeBlock
                code={NODEJS_USAGE}
                language="javascript"
                filename="server.js"
              />
            </Step>
          </div>
        )}

        {lang === "php" && (
          <div className="space-y-4">
            <Step n={1} title="Drop client wrapper ke project Anda">
              <CodeBlock
                code={PHP_CLIENT}
                language="php"
                filename="PaymentGatewayClient.php"
              />
            </Step>
            <Step n={2} title="Pakai di Controller (Laravel)">
              <CodeBlock
                code={PHP_USAGE}
                language="php"
                filename="CheckoutController.php"
              />
            </Step>
          </div>
        )}

        {lang === "python" && (
          <div className="space-y-4">
            <Step
              n={1}
              title="Install httpx, drop client ke project"
            >
              <CodeBlock code="pip install httpx" language="shell" />
              <CodeBlock
                code={PYTHON_CLIENT}
                language="python"
                filename="client.py"
              />
            </Step>
            <Step n={2} title="Pakai di FastAPI">
              <CodeBlock code={PYTHON_USAGE} language="python" filename="main.py" />
            </Step>
          </div>
        )}

        {lang === "curl" && (
          <div className="space-y-4">
            <Step n={1} title="Charge — buat transaksi baru">
              <CodeBlock code={CURL_CHARGE} language="shell" filename="charge.sh" />
            </Step>
            <Step n={2} title="Cek status">
              <CodeBlock code={CURL_GET} language="shell" filename="status.sh" />
            </Step>
          </div>
        )}
      </Section>

      <Section title="4. API Reference">
        <ApiBlock
          method="POST"
          path="/api/v1/payments/charge"
          desc="Buat transaksi pembayaran baru. Wajib header Idempotency-Key."
        >
          <FieldTable
            rows={[
              ["orderId", "string (1-64)", "ID order di sisi app Anda"],
              ["amount", "integer > 0", "Dalam satuan terkecil (rupiah)"],
              ["currency", "string (3 char)", '"IDR"'],
              [
                "method",
                "enum",
                "credit_card | bank_transfer | ewallet | qris",
              ],
              ["customer.name", "string", "Wajib"],
              ["customer.email", "email", "Wajib"],
              ["customer.phone", "string", "Opsional"],
              ["description", "string ≤ 255", "Opsional"],
            ]}
          />
          <div className="mt-3">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Response 201
            </div>
            <CodeBlock code={RESPONSE_201} language="json" />
          </div>
          <div className="mt-3">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Response 503 (semua provider down)
            </div>
            <CodeBlock code={RESPONSE_503} language="json" />
          </div>
        </ApiBlock>

        <ApiBlock
          method="GET"
          path="/api/v1/payments/:id"
          desc="Ambil detail transaksi by gateway transaction ID (UUID)."
        />

        <ApiBlock
          method="GET"
          path="/api/v1/payments?orderId=..."
          desc="Ambil detail transaksi by orderId yang Anda kirim saat charge."
        />

        <ApiBlock
          method="GET"
          path="/health/ready"
          desc="Readiness probe — cek koneksi DB. Pakai untuk Kubernetes / load balancer (200 = ready, 503 = not ready)."
        />

        <ApiBlock
          method="GET"
          path="/health/providers"
          desc="Status semua provider. 503 jika SEMUA provider down."
        />
      </Section>

      <Section title="5. Kode Error">
        <ErrorTable
          rows={[
            [
              "400",
              "IDEMPOTENCY_KEY_REQUIRED",
              "Header Idempotency-Key tidak diisi",
              "Fix code, jangan retry",
            ],
            [
              "400",
              "VALIDATION_ERROR",
              "Body request tidak valid",
              "Tampilkan error ke user, jangan retry",
            ],
            [
              "409",
              "IDEMPOTENCY_IN_PROGRESS",
              "Request dengan key sama sedang diproses",
              "Tunggu, lalu polling status",
            ],
            [
              "429",
              "RATE_LIMIT_EXCEEDED",
              "Terlalu banyak request",
              "Backoff & retry kemudian",
            ],
            [
              "503",
              "ALL_PROVIDERS_FAILED",
              "Semua provider tidak tersedia",
              'Tampilkan "coba lagi nanti" ke user',
            ],
            [
              "5xx",
              "(lainnya)",
              "Server error",
              "Auto-retry dengan exponential backoff",
            ],
          ]}
        />
      </Section>

      <Section title="6. Cara Test Skenario Fallback">
        <ol className="ml-5 list-decimal space-y-2 text-sm text-slate-700">
          <li>
            Buka{" "}
            <a
              href="/settings"
              className="font-medium text-brand-600 hover:underline"
            >
              /settings
            </a>{" "}
            → toggle <strong>Force Down</strong> di provider Midtrans.
          </li>
          <li>
            Coba charge dari app Anda — gateway akan otomatis fallback ke
            Xendit.
          </li>
          <li>
            Cek di response: <code>providerName</code> = <code>xendit</code>,{" "}
            <code>attempts</code> ada 2 entry.
          </li>
          <li>
            Toggle off Force Down setelah selesai testing.
          </li>
          <li>
            Untuk skenario "semua down" → toggle Force Down di semua provider →
            charge harus return 503 <code>ALL_PROVIDERS_FAILED</code>.
          </li>
        </ol>
      </Section>

      <Section title="7. OrderKuota — Catatan Khusus">
        <p className="mb-3 text-sm leading-relaxed text-slate-700">
          OrderKuota beda dari provider lain (Midtrans/Xendit/DOKU/Tripay).
          Sebelum pakai, pahami trade-off-nya:
        </p>
        <ul className="space-y-2 text-sm text-slate-700">
          <Rule>
            <strong>Auth pakai OTP login</strong>, bukan API key. Setup awal
            via halaman{" "}
            <a
              href="/orderkuota"
              className="font-medium text-brand-600 hover:underline"
            >
              /orderkuota
            </a>{" "}
            (request OTP → tukar dengan token).
          </Rule>
          <Rule>
            <strong>Tidak ada webhook native</strong>. Status update lewat polling{" "}
            <code>POST /api/v1/admin/orderkuota/sync</code>. Dashboard sudah
            auto-poll tiap 15 detik di halaman detail transaksi. Untuk production,
            jadwalkan cron tiap 30 detik.
          </Rule>
          <Rule>
            Hanya support <code>method: &quot;qris&quot;</code>. Method lain
            akan auto-fallback ke provider berikutnya.
          </Rule>
          <Rule>
            Match dengan mutasi pakai <strong>amount + timestamp</strong>.
            Untuk akurasi tinggi, generate amount unik per transaksi (mis.{" "}
            <code>50000 → 50037</code>) supaya tidak bingung kalau dua user bayar
            nominal sama berdekatan.
          </Rule>
          <Rule>
            Integrasi <strong>unofficial</strong> — reverse-engineer dari mobile
            app OrderKuota. Bisa break tiap kali mereka update aplikasi. Untuk
            production yang serius, prefer Midtrans/Xendit yang punya API resmi
            + webhook native.
          </Rule>
        </ul>

        <div className="mt-4 rounded-md border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800">
          💡 <strong>Cron untuk production:</strong>
          <CodeBlock
            code={`# Tiap 30 detik panggil sync (Linux cron tidak support sub-menit,
# pakai systemd timer atau loop di Node/Go yang call endpoint).

curl -X POST https://gateway.yourdomain.com/api/v1/admin/orderkuota/sync \\
  -H "X-Admin-Key: \${ADMIN_API_KEY}"`}
            language="shell"
          />
        </div>
      </Section>

      <Section title="8. Production Checklist">

        <ul className="space-y-2 text-sm text-slate-700">
          <Check>
            <code>NODE_ENV=production</code> di gateway
          </Check>
          <Check>
            <code>ADMIN_API_KEY</code> diganti ke nilai random 32+ char
          </Check>
          <Check>
            Credentials provider sudah diisi (lewat <code>.env</code> atau
            halaman <a href="/credentials" className="text-brand-600 hover:underline">/credentials</a>)
          </Check>
          <Check>HTTPS aktif (TLS termination di LB)</Check>
          <Check>
            <code>TRUST_PROXY=true</code> jika di belakang LB
          </Check>
          <Check>
            <code>CORS_ORIGIN</code> di-set ke domain dashboard production
          </Check>
          <Check>
            Webhook URL provider diarahkan ke{" "}
            <code>https://gateway.yourdomain.com/api/v1/webhooks/&lt;provider&gt;</code>
          </Check>
          <Check>
            Monitoring alert dipasang ke endpoint{" "}
            <code>/health/ready</code>
          </Check>
          <Check>App internal sudah update <code>GATEWAY_URL</code> ke production</Check>
        </ul>
      </Section>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Helper components
// ─────────────────────────────────────────────────────────

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6">
      <h2 className="mb-4 text-lg font-semibold text-slate-900">{title}</h2>
      {children}
    </section>
  );
}

function Step({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">
          {n}
        </span>
        <span className="text-sm font-medium text-slate-800">{title}</span>
      </div>
      <div className="ml-8 space-y-2">{children}</div>
    </div>
  );
}

function Rule({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <span className="mt-0.5 text-amber-500">⚠</span>
      <span>{children}</span>
    </li>
  );
}

function Check({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <span className="mt-0.5 text-green-600">✓</span>
      <span>{children}</span>
    </li>
  );
}

function FeatureChip({
  icon,
  title,
  text,
}: {
  icon: string;
  title: string;
  text: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="mb-1 flex items-center gap-1.5">
        <span className="text-lg">{icon}</span>
        <span className="text-sm font-semibold text-slate-900">{title}</span>
      </div>
      <p className="text-xs leading-snug text-slate-600">{text}</p>
    </div>
  );
}


function FlowDiagram() {
  const steps = [
    { label: "App Anda", sub: "POST /charge dengan Idempotency-Key" },
    { label: "Gateway", sub: "Pilih provider, fallback otomatis" },
    {
      label: "Provider",
      sub: "Midtrans → Xendit → DOKU → Tripay",
    },
    { label: "Customer", sub: "Buka paymentUrl, bayar" },
    { label: "Webhook", sub: "Provider notify gateway → status berubah" },
  ];
  return (
    <ol className="mt-4 space-y-2">
      {steps.map((s, i) => (
        <li key={i} className="flex items-start gap-3">
          <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-700">
            {i + 1}
          </span>
          <div>
            <div className="text-sm font-medium text-slate-800">{s.label}</div>
            <div className="text-xs text-slate-500">{s.sub}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}

function ApiBlock({
  method,
  path,
  desc,
  children,
}: {
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  path: string;
  desc: string;
  children?: React.ReactNode;
}) {
  const methodColor: Record<string, string> = {
    GET: "bg-blue-100 text-blue-800",
    POST: "bg-green-100 text-green-800",
    PUT: "bg-amber-100 text-amber-800",
    PATCH: "bg-amber-100 text-amber-800",
    DELETE: "bg-red-100 text-red-800",
  };
  return (
    <div className="mb-4 rounded-md border border-slate-200 p-4 last:mb-0">
      <div className="mb-2 flex items-center gap-3">
        <span
          className={`rounded px-2 py-0.5 text-xs font-bold ${methodColor[method]}`}
        >
          {method}
        </span>
        <code className="font-mono text-sm text-slate-800">{path}</code>
      </div>
      <p className="mb-2 text-sm text-slate-600">{desc}</p>
      {children}
    </div>
  );
}

function FieldTable({ rows }: { rows: Array<[string, string, string]> }) {
  return (
    <table className="mt-2 min-w-full text-sm">
      <thead>
        <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
          <th className="py-1.5 pr-3">Field</th>
          <th className="py-1.5 pr-3">Type</th>
          <th className="py-1.5">Catatan</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([f, t, n]) => (
          <tr key={f} className="border-b border-slate-100 last:border-0">
            <td className="py-1.5 pr-3 font-mono text-slate-800">{f}</td>
            <td className="py-1.5 pr-3 text-slate-600">{t}</td>
            <td className="py-1.5 text-slate-600">{n}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ErrorTable({ rows }: { rows: Array<[string, string, string, string]> }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
            <th className="py-2 pr-3">Status</th>
            <th className="py-2 pr-3">Error code</th>
            <th className="py-2 pr-3">Artinya</th>
            <th className="py-2">Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([s, c, m, a]) => (
            <tr key={c} className="border-b border-slate-100 last:border-0">
              <td className="py-2 pr-3 font-mono text-slate-800">{s}</td>
              <td className="py-2 pr-3 font-mono text-xs text-red-700">{c}</td>
              <td className="py-2 pr-3 text-slate-700">{m}</td>
              <td className="py-2 text-slate-600">{a}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
