# KetantechPay — Roadmap

Catatan untuk pengembangan ke depan. Aplikasi sudah siap untuk **single-tenant** (satu organisasi, satu Admin API Key shared). Roadmap berikut adalah arah saat siap di-publish untuk umum (SaaS).

---

## Status Saat Ini (v1.0)

✅ **Production-ready untuk single-tenant:**
- 5 provider built-in (Midtrans, Xendit, DOKU, Tripay, OrderKuota)
- Auto-fallback + retry + idempotency
- Dashboard admin (mobile-friendly)
- 97 tests, security hardened
- Single shared `ADMIN_API_KEY` untuk login
- Multi-tenant client API keys (untuk aplikasi yang panggil gateway)

---

## Untuk Publish ke Umum (SaaS Berbayar)

Kalau nanti mau jual sebagai **layanan berbayar** (mis. Rp 200rb/bulan untuk merchant kecil), butuh fitur tambahan:

### Fase 1: Multi-User Authentication

Saat ini login pakai shared `ADMIN_API_KEY`. Untuk SaaS, tiap merchant perlu akun terpisah.

**Yang perlu ditambah:**
- [ ] Tabel `users` (email, password hashed dengan bcrypt, role, createdAt)
- [ ] Tabel `organizations` (nama, plan, billing status)
- [ ] Login form: email + password (replace dialog admin key)
- [ ] Session/JWT — pakai `httpOnly cookie` + refresh token
- [ ] Forgot password flow (email reset link)
- [ ] Email verification saat signup
- [ ] Role-based access: `owner`, `admin`, `viewer`
- [ ] UI: `/users` page untuk owner add/remove user
- [ ] Per-user audit log (siapa yang refund, siapa yang ubah credential)

**Estimasi:** 3-5 hari kerja.

**Tech stack tambahan yang dibutuhkan:**
- `bcrypt` (sudah ada di Node, atau pakai `argon2` untuk lebih aman)
- `jsonwebtoken` atau `iron-session` untuk session
- SMTP service untuk email (Postmark, Resend, SES, atau Mailgun)

### Fase 2: Multi-Tenancy Data Isolation

Saat ini semua transaksi & credentials di satu DB shared. Untuk SaaS, tiap organisasi harus pisah datanya.

**Yang perlu ditambah:**
- [ ] Tambah kolom `organizationId` ke semua tabel (transactions, credentials, settings, audit_logs)
- [ ] Filter semua query by `organizationId` (middleware auto-inject)
- [ ] Per-org credentials (tiap merchant punya Midtrans key sendiri, dst)
- [ ] Per-org settings (provider order, force-down, dst)
- [ ] Per-org rate limit (cegah satu merchant abuse resource bersama)

**Estimasi:** 2-3 hari kerja.

### Fase 3: Billing & Subscription

**Yang perlu ditambah:**
- [ ] Tabel `subscriptions` (org_id, plan, period_start, period_end, status)
- [ ] Tabel `invoices` (org_id, period, amount, paid_at, payment_url)
- [ ] Plan tiers: Free / Starter / Pro / Enterprise (mis. limit 100 / 1000 / 10000 / unlimited tx per bulan)
- [ ] Counter monthly transaction usage
- [ ] Auto-block kalau lewat quota (return 403 dengan "upgrade required")
- [ ] Self-service billing — bisa pakai gateway sendiri (KetantechPay buat KetantechPay) 😊
- [ ] Invoice generation + email reminder
- [ ] Webhook handler untuk pembayaran subscription

**Estimasi:** 4-7 hari kerja.

### Fase 4: Admin / Super-Admin Panel

Anda sebagai owner platform butuh dashboard untuk monitor semua merchant.

**Yang perlu ditambah:**
- [ ] Super-admin role yang bisa akses cross-org
- [ ] `/admin/organizations` — list semua merchant
- [ ] Stats agregat: total tx semua merchant, MRR, churn
- [ ] Manual override: suspend account, perpanjang trial, dll

**Estimasi:** 2-3 hari kerja.

### Fase 5: Onboarding & Self-Service

- [ ] Landing page (terpisah dari dashboard) — marketing site dengan pricing
- [ ] Self-service signup tanpa manual approve
- [ ] Onboarding wizard (saat ini ada hero progress, tapi belum guided full)
- [ ] In-app tutorial / tooltip
- [ ] Sandbox mode (provider mock) untuk merchant testing tanpa pakai uang asli

### Fase 6: Operasional Production

- [ ] Pindah dari SQLite ke PostgreSQL (multi-instance support)
- [ ] Redis untuk idempotency store + rate limit (shared across instances)
- [ ] Background job queue (BullMQ) untuk OrderKuota worker, email, retry logic
- [ ] Monitoring: Sentry untuk error, Plausible/Umami untuk analytics, Grafana untuk metrics
- [ ] Status page (mis. statuspage.io free tier)
- [ ] Auto backup harian dengan rotation

---

## Pertimbangan Bisnis

Sebelum publish berbayar:

- [ ] **Legal:** TOS, Privacy Policy, MoU dengan provider yang dipakai
- [ ] **Compliance:** Pastikan tidak melanggar TOS provider (terutama OrderKuota yang integrasi unofficial — pertimbangkan drop kalau jadi SaaS publik)
- [ ] **PCI-DSS:** Kalau handle data kartu, butuh sertifikasi (mahal). Lebih aman: jangan pernah simpan data kartu, semua via tokenization provider
- [ ] **Tax & Invoice:** PPN 11% untuk merchant Indonesia, butuh sistem e-faktur
- [ ] **Support channel:** WhatsApp / email / Discord untuk merchant
- [ ] **Pricing model:** Flat fee per bulan VS percentage per transaksi VS hybrid

---

## Quick Wins yang Bisa Dikerjakan Sekarang (Tanpa Nunggu SaaS)

Hal-hal yang nice-to-have untuk versi current:

- [ ] **i18n** — kalau pengen support English untuk demo (4-8 jam)
- [ ] **Dark mode** untuk dashboard (2-3 jam)
- [ ] **Webhook log viewer** di dashboard — lihat raw webhook yang masuk + retry button (1 hari)
- [ ] **Notification settings** — email/Telegram saat error rate tinggi atau provider down (1-2 hari)
- [ ] **API key rotation reminder** — alert kalau key sudah > 90 hari (beberapa jam)
- [ ] **Integration helper sederhana** — generator code di dashboard (input order amount → keluar curl/Node code siap copy) (1 hari)

---

## Catatan

Roadmap ini **bukan komitmen waktu**. Estimasi hari kerja asumsi 1 developer full-time. Tergantung priority bisnis, urutan & scope bisa berubah.

Untuk versi **single-tenant** saat ini sudah cukup untuk:
- ✅ Internal company gateway (1 organisasi, beberapa app)
- ✅ Personal toko online (1 merchant)
- ✅ White-label deployment (deploy sendiri-sendiri per merchant, tanpa shared infra)

Versi **multi-tenant SaaS** baru perlu kalau kita mau jualan ke banyak merchant dari satu deployment.
