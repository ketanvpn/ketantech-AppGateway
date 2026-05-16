# Payment Gateway — Application Gateway Pattern

Gateway pembayaran multi-provider dengan **fallback otomatis**, dashboard admin, dan integrasi siap pakai untuk Node, PHP, Python.

> 📦 Repo: <https://github.com/ketanvpn/ketantech-AppGateway>
> 📘 [INTEGRATION.md](./INTEGRATION.md) — panduan integrasi ke aplikasi Anda
> 🔒 [SECURITY.md](./SECURITY.md) — kontrol keamanan & tanggung jawab operator

---

## Daftar Isi

1. [Apa & Kenapa](#apa--kenapa)
2. [Fitur](#fitur)
3. [Quick Start (Lokal)](#quick-start-lokal)
4. [Dashboard](#dashboard)
5. [Mengatur Credentials](#mengatur-credentials-provider)
6. [API](#api)
7. **[Deploy ke VPS](#deploy-ke-vps-tutorial-untuk-pemula)** ← tutorial step-by-step
8. **[Deploy ke Cloud Hosting](#deploy-ke-cloud-hosting)** ← Railway, Render, dll
9. [Push ke GitHub](#push-ke-github)
10. [Production Checklist](#production-checklist)

---

## Apa & Kenapa

Bayangkan toko online Anda mau terima QRIS, transfer bank, dan e-wallet. Tanpa gateway terpusat, tiap aplikasi internal harus integrasi langsung ke Midtrans, Xendit, DOKU, dst — masing-masing dengan auth & format response berbeda. Saat satu provider down, semua aplikasi ikut bermasalah.

**Gateway ini adalah perantara**. Aplikasi Anda cukup panggil **satu URL**, gateway yang urus mau pakai provider mana, fallback otomatis kalau provider utama down, retry pada error sementara, cegah double-charge via idempotency, dan log semua transaksi terpusat.

```
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│  App Internal A │  │  App Internal B │  │  App Internal C │
└────────┬────────┘  └────────┬────────┘  └────────┬────────┘
         └────────────────────┼────────────────────┘
                    ┌─────────▼─────────┐
                    │  Payment Gateway  │ ← Aplikasi ini
                    │  Idempotency      │
                    │  Rate limit       │
                    │  Retry            │
                    │  Fallback logic   │
                    └─────────┬─────────┘
                              │
        ┌──────────────┬──────┴──────┬──────────────┬──────────────┐
        ▼              ▼             ▼              ▼              ▼
   Midtrans         Xendit         DOKU         Tripay        OrderKuota
   (primary)      (fallback 1)  (fallback 2)  (fallback 3)   (QRIS only)
```

---

## Fitur

**Inti:**
- Multi-provider abstraction — interface seragam, mudah tambah provider baru
- Fallback otomatis — provider down → otomatis pindah ke berikutnya
- Retry exponential backoff
- Idempotency — cegah double-charge
- Rate limiting berlapis (payments, admin, webhook)

**5 Provider built-in:** Midtrans, Xendit, DOKU, Tripay, OrderKuota
- 4 provider pertama via REST API resmi (signature verification untuk webhook)
- OrderKuota: integrasi unofficial untuk QRIS dynamic + auto-poll mutasi (tidak ada webhook native)

**Security:**
- Admin auth dengan timing-safe compare
- Multi-tenant client API keys
- Production startup safety check (blok deploy dengan default key/CORS unsafe)
- Idempotency body-hash check
- Webhook strict deduplication (payload hash) + amount cross-check
- Audit log untuk refund, settings, credentials, system update, export
- PII redaction di logger (email/phone/secrets di-mask)
- Helmet + CORS allowlist + trust-proxy aware

**Operability:**
- Dashboard Next.js (mobile-friendly) untuk monitoring & manage
- Onboarding hero auto-detect setup progress
- Toast notifications global
- Export CSV transaksi
- Date range filter
- Refresh-status (pull dari provider, untuk recover transaksi yang webhook-nya hilang)
- Health endpoints: `/health`, `/health/ready` (DB), `/health/providers`
- OrderKuota background worker (sync mutasi tiap 30s di backend)
- Audit log queryable lewat `/admin/audit`

**Testing:** 97 tests dengan Jest + Supertest

---

## Quick Start (Lokal)

**Prasyarat:** Node 20+, npm.

```bash
# Clone repo
git clone https://github.com/ketanvpn/ketantech-AppGateway.git
cd ketantech-AppGateway

# Install backend + dashboard
npm install
cd dashboard && npm install && cd ..

# Copy env
cp .env.example .env
```

**Jalankan (1 terminal):**
```bash
npm run dev:all
```

Backend di port 3000, dashboard di port 3001. Hentikan dengan Ctrl+C.

**Login dashboard:** buka <http://localhost:3001>, masukkan `ADMIN_API_KEY` dari `.env` (default `dev-admin-key-change-me`).

**Tests:**
```bash
npm test
```

**Production build:**
```bash
npm run build:all   # build backend + dashboard
npm start           # backend
cd dashboard && npm start   # dashboard
```

---

## Dashboard

| Halaman | Fungsi |
|---|---|
| `/` | Stats real-time, provider health, distribusi status, onboarding hero |
| `/transactions` | List + filter (status, provider, order ID, date range), export CSV, pagination |
| `/transactions/[id]` | Detail + attempts history, refresh status, refund, simulate (dev) |
| `/test-charge` | Form uji coba charge & lihat fallback |
| `/credentials` | Set API key per provider, override `.env` (tanpa restart) |
| `/orderkuota` | Login OTP + sync mutasi |
| `/settings` | Urutan fallback + force-down toggle |
| `/system` | Rate limit, retry, CORS, client keys (untuk awam, dengan penjelasan) |
| `/docs` | Panduan integrasi (Node/PHP/Python/cURL) + glossary istilah |

Mobile-friendly: drawer sidebar, table → card list di layar kecil.

---

## Mengatur Credentials Provider

Dua cara menyimpan API key:

**1. File `.env`** (untuk dev / CI):
```env
MIDTRANS_SERVER_KEY=SB-Mid-server-xxxxxxxx
XENDIT_SECRET_KEY=xnd_dev_xxxxxxxx
XENDIT_CALLBACK_TOKEN=xxxxxxxx
DOKU_CLIENT_ID=BRN-xxxx
DOKU_SECRET_KEY=SK-xxxx
TRIPAY_API_KEY=DEV-xxxx
TRIPAY_PRIVATE_KEY=xxxx
TRIPAY_MERCHANT_CODE=Txxxx
ORDERKUOTA_USERNAME=...
ORDERKUOTA_AUTH_TOKEN=...
```

**2. Halaman `/credentials`** (runtime, tanpa restart):

Buka <http://localhost:3001/credentials>, set per field. Disimpan di SQLite, **override `.env`**. Klik **Hapus** untuk kembali ke `.env`.

Resolusi prioritas:
1. **Dashboard** (badge biru) — SQLite override
2. **`.env`** (badge abu-abu) — fallback
3. **Belum diset** (badge kuning) — kosong

> ⚠️ Untuk production sungguhan, pakai secrets manager (AWS Secrets Manager, HashiCorp Vault, Doppler) dan inject sebagai `.env` saat deploy.

---

## API

### Public (butuh `Idempotency-Key` & opsional `X-Client-Key`)

```
POST   /api/v1/payments/charge        # buat transaksi
GET    /api/v1/payments/:id           # detail by gateway tx ID
GET    /api/v1/payments?orderId=...   # detail by order ID
```

### Webhook (dari provider)

```
POST   /api/v1/webhooks/midtrans      # SHA512 signature_key
POST   /api/v1/webhooks/xendit        # x-callback-token header
POST   /api/v1/webhooks/doku          # HMAC-SHA256 Signature header
POST   /api/v1/webhooks/tripay        # HMAC-SHA256 X-Callback-Signature
```

### Admin (butuh header `X-Admin-Key`)

```
GET    /api/v1/admin/stats
GET    /api/v1/admin/transactions?status=&provider=&orderId=&from=&to=&page=&pageSize=
GET    /api/v1/admin/transactions/export.csv?...   # download CSV
GET    /api/v1/admin/transactions/:id
POST   /api/v1/admin/transactions/:id/refund       # idempotent
POST   /api/v1/admin/transactions/:id/refresh-status  # pull dari provider
POST   /api/v1/admin/transactions/:id/simulate-status  # DEV only

GET    /api/v1/admin/settings
PATCH  /api/v1/admin/settings

GET    /api/v1/admin/credentials      # masked
PUT    /api/v1/admin/credentials

GET    /api/v1/admin/system           # rate limit, retry, CORS, client keys
PATCH  /api/v1/admin/system

GET    /api/v1/admin/audit            # audit log

POST   /api/v1/admin/orderkuota/request-otp
POST   /api/v1/admin/orderkuota/exchange-otp
POST   /api/v1/admin/orderkuota/sync
GET    /api/v1/admin/orderkuota/mutasi
```

### Health

```
GET    /health                # liveness
GET    /health/ready          # readiness (DB)
GET    /health/providers      # status semua provider, 503 kalau semua down
```

### Contoh charge

```bash
curl -X POST http://localhost:3000/api/v1/payments/charge \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: order-001-attempt-1" \
  -d '{
    "orderId": "ORDER-001",
    "amount": 50000,
    "currency": "IDR",
    "method": "qris",
    "customer": { "name": "Budi", "email": "budi@example.com" }
  }'
```

Response 201 — termasuk `paymentUrl` (untuk QRIS = URL gambar QR), `providerName` (provider yang akhirnya berhasil), `attempts` (history fallback).

> 📘 Untuk integrasi lengkap dengan code Node/PHP/Python, lihat [INTEGRATION.md](./INTEGRATION.md) atau buka `/docs` di dashboard.

---

## Deploy ke VPS (Tutorial untuk Pemula)

Tutorial ini menggunakan **Ubuntu 22.04 LTS** di VPS apa saja (DigitalOcean, Vultr, Linode, Niagahoster, IDCloudHost, dll). Estimasi waktu: **30-45 menit**.

### Yang Anda butuhkan

- VPS dengan minimal **1 GB RAM, 1 vCPU, 20 GB disk** (paket termurah biasanya cukup)
- Domain (mis. `gateway.tokoanda.com`) yang sudah pointing ke IP VPS via DNS A record
- Akses SSH ke VPS sebagai user yang bisa `sudo`

### Langkah 1 — Login ke VPS & update sistem

```bash
ssh user@IP_VPS_ANDA

sudo apt update && sudo apt upgrade -y
```

### Langkah 2 — Install Node 20

```bash
# Install Node 20 via NodeSource (versi stabil, recommended)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Verifikasi
node -v   # harus v20.x
npm -v
```

### Langkah 3 — Install dependencies pendukung

```bash
# git untuk clone repo
sudo apt install -y git

# nginx untuk reverse proxy + HTTPS
sudo apt install -y nginx

# certbot untuk SSL gratis dari Let's Encrypt
sudo apt install -y certbot python3-certbot-nginx

# pm2 untuk jalankan Node sebagai service yang auto-restart
sudo npm install -g pm2
```

### Langkah 4 — Clone & setup aplikasi

```bash
# Pindah ke folder yang readable nginx
cd /var/www
sudo mkdir -p ketantech-gateway
sudo chown -R $USER:$USER ketantech-gateway
cd ketantech-gateway

# Clone
git clone https://github.com/ketanvpn/ketantech-AppGateway.git .

# Install
npm install
cd dashboard && npm install && cd ..

# Build production
npm run build:all
```

### Langkah 5 — Konfigurasi `.env` production

```bash
# Generate admin key yang aman
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# → output contoh: 7c3a8e9b...
```

Edit `.env`:

```bash
nano .env
```

Isi minimal:

```env
NODE_ENV=production
PORT=3000

# Tempel hasil generate tadi
ADMIN_API_KEY=7c3a8e9b...

# Domain dashboard production (BUKAN localhost)
CORS_ORIGIN=https://gateway.tokoanda.com

# Karena di belakang nginx
TRUST_PROXY=true

# Path SQLite — pakai folder absolut
DATABASE_PATH=/var/www/ketantech-gateway/data/gateway.db

# Provider order
PROVIDER_ORDER=midtrans,xendit,doku,tripay

# Provider keys (isi sesuai akun Anda di masing-masing provider)
MIDTRANS_SERVER_KEY=Mid-server-xxx
XENDIT_SECRET_KEY=xnd_xxx
XENDIT_CALLBACK_TOKEN=xxx
# ... dst
```

> ⚠️ **Penting:** kalau `NODE_ENV=production` tapi `ADMIN_API_KEY` masih default atau `CORS_ORIGIN` masih localhost, server akan **menolak start** (production safety check). Itu fitur, bukan bug.

### Langkah 6 — Buat folder data + permission

```bash
mkdir -p /var/www/ketantech-gateway/data
```

### Langkah 7 — Jalankan dengan PM2

```bash
cd /var/www/ketantech-gateway

# Backend gateway
pm2 start npm --name "gateway-backend" -- start

# Dashboard
pm2 start npm --name "gateway-dashboard" --cwd ./dashboard -- start

# Save & auto-startup
pm2 save
pm2 startup
# Copy & jalankan command yang muncul (biasanya berisi `sudo env PATH=...`)

# Cek status
pm2 status
pm2 logs   # lihat log real-time, Ctrl+C untuk keluar
```

Sekarang backend jalan di `:3000` dan dashboard di `:3001` (cuma localhost di VPS).

### Langkah 8 — Konfigurasi Nginx sebagai reverse proxy

```bash
sudo nano /etc/nginx/sites-available/gateway.tokoanda.com
```

Isi:

```nginx
# Dashboard di /
server {
    listen 80;
    server_name gateway.tokoanda.com;

    # Dashboard (Next.js) di port 3001
    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # Backend gateway API di /api dan /health
    location ~ ^/(api|health) {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Body size buat handle webhook payload besar
    client_max_body_size 1m;
}
```

Aktifkan & reload:

```bash
sudo ln -s /etc/nginx/sites-available/gateway.tokoanda.com /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

Tes: buka `http://gateway.tokoanda.com` di browser. Dashboard harus muncul.

### Langkah 9 — HTTPS gratis dengan Let's Encrypt

```bash
sudo certbot --nginx -d gateway.tokoanda.com
```

Ikuti prompt: masukkan email, setuju TOS, pilih opsi 2 (redirect HTTP → HTTPS). Selesai dalam 1-2 menit. Sekarang akses HTTPS otomatis aktif & cert auto-renew.

### Langkah 10 — Update dashboard backend URL

Buka <https://gateway.tokoanda.com> → login → buka Settings (browser localStorage). Atau langsung set di console browser:

```js
localStorage.setItem('apiBase', 'https://gateway.tokoanda.com');
```

Reload halaman.

### Langkah 11 — Konfigurasi webhook URL di provider

Login ke dashboard masing-masing provider (Midtrans, Xendit, dll) dan set webhook URL ke:

```
https://gateway.tokoanda.com/api/v1/webhooks/midtrans
https://gateway.tokoanda.com/api/v1/webhooks/xendit
https://gateway.tokoanda.com/api/v1/webhooks/doku
https://gateway.tokoanda.com/api/v1/webhooks/tripay
```

Tes dengan klik "Send test notification" di dashboard provider.

### Maintenance — Update aplikasi nanti

```bash
cd /var/www/ketantech-gateway
git pull
npm install
cd dashboard && npm install && cd ..
npm run build:all
pm2 restart all
```

### Maintenance — Backup database

```bash
# Backup harian (manual; untuk otomatis, pakai cron)
cp /var/www/ketantech-gateway/data/gateway.db ~/backup-gateway-$(date +%F).db
```

Untuk backup harian otomatis ke cloud, lihat tools seperti `restic` + Backblaze B2.

### Troubleshooting umum

| Masalah | Solusi |
|---|---|
| `EADDRINUSE :::3000` | Port sudah dipakai. `pm2 delete all` lalu `pm2 start ...` ulang. |
| Server tidak start, log "production safety check" | Cek `.env` — `ADMIN_API_KEY` jangan default, `CORS_ORIGIN` jangan localhost di production. |
| Webhook nyangkut, status pending terus | Cek log: `pm2 logs gateway-backend`. Atau klik "Cek Status" di detail transaksi (kecuali OrderKuota). |
| Dashboard putih | `pm2 restart gateway-dashboard`, hard refresh browser (Ctrl+Shift+R). |
| Disk penuh | `data/gateway.db` bisa membesar. Vacuum: stop service, jalankan `sqlite3 data/gateway.db "VACUUM;"`. |

---

## Deploy ke Cloud Hosting

Untuk yang tidak mau urus VPS, beberapa opsi cloud yang gampang:

### Railway.app (paling simpel, ada free tier)

1. Login Railway, klik **New Project** → **Deploy from GitHub** → pilih repo `ketantech-AppGateway`
2. Railway auto-detect Node — biarkan default
3. **Settings** → tambah env vars dari `.env.example`
4. **Generate Domain** → dapat URL `xxx.railway.app`
5. Backend & dashboard butuh **2 service terpisah** di Railway:
   - Service 1: backend, root dir `/`, start command `npm start`
   - Service 2: dashboard, root dir `/dashboard`, build `npm run build`, start `npm start`
6. Set `CORS_ORIGIN` di backend ke URL service dashboard

**Database persistent:** Railway volume — mount ke `/app/data`, set `DATABASE_PATH=/app/data/gateway.db`.

### Render.com (free tier dengan auto-sleep)

Mirip Railway:
1. **New** → **Web Service** → connect GitHub repo
2. Build: `npm install && npm run build`
3. Start: `npm start`
4. Tambah env vars
5. Untuk dashboard, buat Web Service kedua dengan root `dashboard/`
6. Tambah **Persistent Disk** untuk SQLite

> ⚠️ Free tier Render auto-sleep setelah 15 menit idle — request pertama jadi lambat. Untuk traffic produksi, pakai paid tier.

### Vercel (cuma untuk dashboard, backend tetap perlu hosting lain)

Vercel cocok untuk Next.js dashboard, tapi backend Express + SQLite nggak cocok di Vercel (serverless, no persistent FS).

Setup hybrid:
- **Backend**: Railway/Render/VPS
- **Dashboard**: Vercel — set env `NEXT_PUBLIC_API_BASE` ke URL backend

```bash
# Deploy dashboard ke Vercel
cd dashboard
npx vercel
```

### Fly.io / Heroku / DigitalOcean App Platform

Semuanya support Node. Pola sama: 2 service (backend + dashboard), persistent volume untuk SQLite, env vars dari `.env.example`. Konsultasi dokumentasi masing-masing platform.

### Untuk skala lebih besar (PostgreSQL + Redis)

SQLite cocok untuk single-instance / traffic moderate (<100 tx/menit). Untuk skala lebih besar, ganti:
- `src/store/db.ts` → PostgreSQL (better-postgres)
- `src/store/idempotencyStore.ts` → Redis dengan TTL
- Deploy minimal 2 instance backend di belakang load balancer

---

## Push ke GitHub

Repo target: <https://github.com/ketanvpn/ketantech-AppGateway>

### Pertama kali (init + push)

```bash
# Pastikan di root project
cd /path/to/Aplikasi-Gateway

# Init git (kalau belum)
git init
git branch -M main

# Cek file yang akan di-commit. Pastikan tidak ada .env / data/*.db
git status

# Sebaiknya commit dulu .gitignore biar gak ke-track yang sensitif
cat .gitignore   # cek ada: node_modules, .env, data/, dist/, .next/

# Add semua kecuali yang di .gitignore
git add .

# Commit
git commit -m "Initial commit: Payment Gateway with multi-provider fallback"

# Tambah remote
git remote add origin https://github.com/ketanvpn/ketantech-AppGateway.git

# Push
git push -u origin main
```

GitHub akan minta credential. Pilihan:
- **Personal Access Token (recommended)** — buat di <https://github.com/settings/tokens>, scope `repo`. Pakai token sebagai password.
- **SSH key** — kalau sudah set up, ganti remote ke `git@github.com:ketanvpn/ketantech-AppGateway.git`.

### Update berikutnya

```bash
git add .
git commit -m "feat: deskripsi perubahan"
git push
```

### Sebelum push — checklist keamanan

- [ ] `.env` **tidak ter-commit** (cek `git status` — kalau ada `.env`, `git rm --cached .env`)
- [ ] `data/*.db` tidak ter-commit (database lokal)
- [ ] `dist/` dan `.next/` tidak ter-commit (artifact build)
- [ ] Tidak ada secret hardcoded di kode (search `grep -r "Mid-server" src/` — harus kosong)

`.gitignore` di repo sudah konfigurasi ini, tapi cek manual sekali lagi sebelum push pertama.

### Setup auto-deploy dari GitHub

Kalau pakai Railway/Render/Vercel, mereka punya integrasi GitHub native — tiap push ke `main`, auto-rebuild & redeploy. Aktifkan di settings hosting Anda.

---

## Production Checklist

Sebelum go-live:

- [ ] `NODE_ENV=production` di backend
- [ ] `ADMIN_API_KEY` random 32+ karakter (pakai `randomBytes(32).toString('hex')`)
- [ ] `CORS_ORIGIN` di-set ke domain dashboard production (bukan `*` atau localhost)
- [ ] HTTPS aktif (Let's Encrypt via certbot, atau Cloudflare)
- [ ] `TRUST_PROXY=true` kalau di belakang nginx/Cloudflare
- [ ] Webhook URL di provider sudah pointing ke domain production (`/api/v1/webhooks/<provider>`)
- [ ] `MIDTRANS_SERVER_KEY` & `XENDIT_CALLBACK_TOKEN` di-set (kalau kosong, signature webhook tidak diverifikasi — tidak aman)
- [ ] `CLIENT_API_KEYS` di-set kalau gateway exposed ke internet (kalau internal-only network OK kosong)
- [ ] Backup `data/gateway.db` terjadwal harian
- [ ] Monitoring `/health/ready` (UptimeRobot, Pingdom, atau internal)
- [ ] Alert untuk error rate `/health/providers` 503
- [ ] Aplikasi internal sudah update `GATEWAY_URL` ke domain production

---

## Mengganti Mock Provider dengan API Asli

Default-nya provider Midtrans/Xendit/DOKU/Tripay ada wrapper REST yang tinggal isi credential. Untuk OrderKuota, integrasi sudah complete (charge, sync mutasi).

Untuk tambah provider baru:
1. Buat `src/providers/<nama>Provider.ts` implement interface `PaymentProvider`
2. Tambah ke `ProviderName` di `src/types.ts` dan `ALL_PROVIDERS` di `dashboard/lib/types.ts`
3. Daftarkan di `src/providers/index.ts` (`registry`)

Dashboard otomatis support — tampil di filter, settings, credentials, dst.

---

## Lisensi & Kontribusi

Internal use. PR / issue di <https://github.com/ketanvpn/ketantech-AppGateway>.

---

**Build status:** 97 tests pass · TypeScript strict · Mobile-friendly dashboard
