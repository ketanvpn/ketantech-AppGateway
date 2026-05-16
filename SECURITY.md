# Security Posture

Dokumen ini merangkum kontrol keamanan yang sudah diterapkan di Payment Gateway, plus apa yang masih jadi tanggung jawab operator (Anda) saat deploy.

> Karena gateway ini adalah perantara transaksi finansial, security harus jadi pertimbangan utama. Audit ulang setiap kali ada perubahan besar.

## 1. Authentication & Authorization

| Endpoint | Auth | Mekanisme |
|----------|------|-----------|
| `POST /api/v1/payments/charge` | Client API key (opsional) | Header `X-Client-Key` — wajib kalau `CLIENT_API_KEYS` di env di-set |
| `GET /api/v1/payments/:id` | Client API key (opsional) | Sama seperti di atas |
| `GET /api/v1/payments?orderId=` | Client API key (opsional) | Sama seperti di atas. Tidak bisa list semua transaksi tanpa orderId. |
| `POST /api/v1/admin/*` | **Admin key wajib** | Header `X-Admin-Key` |
| `POST /api/v1/webhooks/:provider` | **Provider signature wajib** | Per provider — SHA512 / HMAC / token |
| `GET /health`, `/health/ready`, `/health/providers` | Public | — |

**Properti penting:**
- Comparison key pakai `crypto.timingSafeEqual` — tahan terhadap timing attack untuk brute force.
- Multi-tenant: `CLIENT_API_KEYS=keyA,keyB` → tiap aplikasi internal punya key sendiri yang bisa di-rotate independen.
- Mode terbuka (`CLIENT_API_KEYS` kosong) hanya OK kalau gateway di-deploy di network internal yang isolated (Kubernetes ClusterIP, VPC private subnet, dll).

## 2. Idempotency Hardening

`POST /charge` wajib pakai `Idempotency-Key`. Server menyimpan **hash body** dari first request:

- Retry dengan key sama + body sama → return cached response (tidak charge ulang). ✓
- Retry dengan key sama + body **berbeda** → reject 422 `IDEMPOTENCY_KEY_MISMATCH`. ✗

Body hash pakai canonical JSON (key di-sort), jadi `{a:1,b:2}` dan `{b:2,a:1}` dianggap sama.

Ini menutup vector: attacker yang kebetulan tahu idempotency key client tidak bisa "swap" body untuk charge ke order/customer berbeda.

Tambahan validasi:
- `Idempotency-Key` max 255 char (cegah memory abuse).
- TTL 24 jam (entry kadaluarsa otomatis).

## 3. Webhook Defense in Depth

Webhook adalah entry point dari luar (provider) yang mengubah state transaksi → harus paranoid:

1. **Signature verification** wajib. Per provider:
   - Midtrans: SHA512 di field `signature_key`
   - Xendit: header `x-callback-token` (timing-safe compare)
   - DOKU: HMAC-SHA256 atas raw body di header `Signature`
   - Tripay: HMAC-SHA256 atas raw body di header `X-Callback-Signature`
2. **Production strict mode:** kalau secret kosong di `NODE_ENV=production`, semua webhook ditolak. Tidak ada bypass.
3. **Strict deduplication via payload hash** — payload byte-identical yang dikirim dua kali tidak diproses ulang, bahkan kalau status sudah berubah lagi sejak terakhir.
4. **Amount cross-check** — webhook dengan amount yang berbeda dari record DB di-reject 400 `AMOUNT_MISMATCH`. Defense kalau signature scheme dipalsukan.
5. **Terminal status protection** — webhook ke transaksi yang sudah `success`/`failed`/`expired`/`refunded` di-ignore (tidak bisa downgrade status).
6. **Webhook rate limit** — 300 req/menit per IP (cegah flood/DoS).

## 4. Rate Limiting

| Scope | Default | Tujuan |
|-------|---------|--------|
| `/api/v1/payments/*` | 100 req/menit per IP (configurable) | Throttle abuse normal |
| `/api/v1/admin/*` | 30 req/menit per IP (skip on success) | **Cegah brute force `ADMIN_API_KEY`** |
| `/api/v1/webhooks/*` | 300 req/menit per IP | Cegah flood DoS |

Untuk multi-instance production, swap `express-rate-limit` ke store Redis (`rate-limit-redis`) supaya counter share antar instance.

## 5. Audit Trail

Operasi sensitif di catat di tabel `audit_logs`:

| Action | Yang dicatat |
|--------|--------------|
| `admin.refund` | Tx ID, orderId, amount, currency, provider, IP admin |
| `admin.settings.update` | Snapshot before & after |
| `admin.credentials.update` / `clear` | Provider + field name (TANPA value secret-nya) |
| `admin.simulate-status` | Tx ID, status from→to (DEV-only endpoint) |

Akses via `GET /api/v1/admin/audit` dengan filter `action`, `targetId`, `limit`.

⚠️ **SQLite tidak immutable.** Untuk produksi yang serius (compliance / forensic-ready), ship juga audit log ke storage append-only: S3 + Object Lock, AWS QLDB, atau service log dedicated.

## 6. PII Handling

- Logger Pino dikonfigurasi dengan **redaction** untuk: `customer.email`, `customer.phone`, `customer.name`, semua header secret (`X-Admin-Key`, `X-Client-Key`, `Authorization`, `Cookie`, `x-callback-token`, `Idempotency-Key`), dan provider credentials (`serverKey`, `secretKey`, `privateKey`, `apiKey`, `callbackToken`).
- Audit log untuk credential update **hanya simpan provider+field**, tidak menyimpan value.
- Endpoint dashboard `GET /admin/credentials` mengembalikan secret yang **dimask** (`********1234`).

## 7. HTTP Security Headers

Semua response punya:
- `X-Powered-By` dihilangkan (kurangi fingerprinting).
- Helmet defaults: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Strict-Transport-Security` (HTTPS-only), dll.
- `Cache-Control: no-store, no-cache, must-revalidate, private` di semua response — transaksi tidak boleh di-cache di proxy/CDN.
- CORS allowlist via `CORS_ORIGIN` (comma-separated). Tidak menerima wildcard di production.

## 8. Input Validation

- Semua body request divalidasi dengan **Zod** schema (orderId max 64, amount harus positive integer, email harus valid, dll).
- JSON body limit 1 MB (`express.json({ limit: "1mb" })`).
- Provider field validation di credentials endpoint — tidak bisa set field yang tidak relevan.

## 9. Secrets Management

Dua mode:

**A. `.env` (recommended for production):**
- File `.env` di-inject dari secrets manager (AWS Secrets Manager / HashiCorp Vault / Doppler / GCP Secret Manager).
- Jangan commit `.env` ke git (sudah di-gitignore).

**B. Dashboard `/credentials` (runtime, untuk dev/single-instance):**
- Disimpan di SQLite lokal (`./data/gateway.db`).
- Di-mask saat ditampilkan, tidak masuk audit log/access log.
- ⚠️ Cocok untuk dev / single-instance. Bukan opsi terbaik untuk produksi multi-instance — pakai mode A.

## 10. Production Startup Safety Checks

Saat `NODE_ENV=production`, server **menolak start** kalau:
- `ADMIN_API_KEY` masih `dev-admin-key-change-me` atau pendek (<16 char).
- `CORS_ORIGIN` mengandung `*` atau `localhost`.

Ini mencegah deploy tidak sengaja dengan default value yang tidak aman.

## 11. Apa yang Masih Tanggung Jawab Anda

Gateway tidak bisa cover semua. Operator (Anda) harus:

- [ ] **HTTPS-only** — TLS termination di LB / reverse proxy (nginx/Cloudflare/ELB). Tidak boleh HTTP plain di production.
- [ ] **Network isolation** — kalau pakai `CLIENT_API_KEYS` kosong (mode terbuka), pastikan gateway tidak bisa diakses dari internet — hanya dari VPC private / cluster internal.
- [ ] **Rotate secrets** secara berkala (`ADMIN_API_KEY`, `CLIENT_API_KEYS`, provider credentials).
- [ ] **Monitoring & alerting** — alert jika audit log menunjukkan banyak `UNAUTHORIZED`, atau rate-limit hit tinggi.
- [ ] **Backup database** harian — `gateway.db` mengandung transaksi finansial.
- [ ] **WAF / DDoS protection** di edge (Cloudflare, AWS WAF) untuk public-facing webhook endpoint.
- [ ] **Patch management** — `npm audit`, `npm outdated` rutin, ikuti CVE advisory.
- [ ] **PCI-DSS scope** — kalau ada credit card, gunakan tokenization dari provider; jangan pernah simpan PAN/CVV.

## 12. Threat Model Singkat

| Threat | Mitigasi |
|--------|----------|
| Brute force `ADMIN_API_KEY` | Rate limit 30/min + timing-safe compare + safety check di startup |
| Replay attack (idempotency abuse) | Body-hash check, mismatch → 422 |
| Webhook spoofing | Signature wajib + amount cross-check + dedup hash |
| Status downgrade attack | Terminal status protection di webhookService |
| Transaction enumeration via UUID | Client API key auth + tidak ada list-all endpoint publik |
| PII leak via logs | Pino redaction (email/phone/name/secrets) |
| Credential leak via response | Mask di GET /credentials, tidak masuk audit log |
| Cache poisoning | `Cache-Control: no-store` di semua response |
| Clickjacking dashboard | Helmet `X-Frame-Options: DENY` |
| Timing attack pada secret comparison | `crypto.timingSafeEqual` di adminAuth + clientAuth + webhook verify |
| CSRF (untuk dashboard) | API pakai header auth (X-Admin-Key), bukan cookie session — immune by design |

## 13. Tests yang Mengkover Security

Semua dijalankan di CI:
- `tests/security.test.ts` — idempotency body-hash, client auth, audit log, security headers (16 tests)
- `tests/credentials.test.ts` — secret mask, env fallback, invalid field reject (6 tests)
- `tests/webhookDedup.test.ts` — strict dedup, amount cross-check (3 tests)
- `tests/webhook.test.ts` — Midtrans/Xendit signature verify (12 tests)
- `tests/dokuTripayWebhook.test.ts` — DOKU/Tripay signature verify (6 tests)
- `tests/refund.test.ts` — admin auth requirement (6 tests)
- `tests/admin.test.ts` — admin auth requirement, settings persistence (15 tests)

**Total: 74/74 passing.**

## 14. Reporting Security Issue

Kalau menemukan vulnerability, **jangan buka public issue.** Kontak maintainer secara private.
