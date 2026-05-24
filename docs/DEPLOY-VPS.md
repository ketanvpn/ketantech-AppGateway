# KetantechPay VPS Deploy Guide

Panduan singkat deploy KetantechPay ke VPS production/staging.

## One-command deploy

Dari folder repo:

```bash
./scripts/deploy-vps.sh
```

Default script akan:

1. cek working tree tracked bersih,
2. `git pull --ff-only origin main`,
3. `npm ci`,
4. build backend TypeScript,
5. `npm --prefix dashboard ci`,
6. build dashboard Next.js,
7. restart systemd service,
8. cek `/health` dan `/health/providers`.

## Default path & service

Script default mengikuti VPS saat ini:

```bash
APP_DIR=/root/.openclaw/workspace/projects/ketantech-AppGateway
BRANCH=main
PAYMENT_SERVICE=ketantech-payment.service
DASHBOARD_SERVICE=ketantech-dashboard.service
HEALTH_URL=http://127.0.0.1:3000/health
PROVIDERS_URL=http://127.0.0.1:3000/health/providers
```

Kalau repo ada di path lain:

```bash
APP_DIR=/root/ketantech-AppGateway ./scripts/deploy-vps.sh
```

Kalau mau deploy branch lain:

```bash
BRANCH=staging ./scripts/deploy-vps.sh
```

Kalau hanya backend tanpa dashboard:

```bash
SKIP_DASHBOARD=1 ./scripts/deploy-vps.sh
```

Kalau source sudah dipull manual:

```bash
SKIP_PULL=1 ./scripts/deploy-vps.sh
```

## Manual fallback

Kalau script tidak bisa dipakai, jalankan manual:

```bash
cd /root/.openclaw/workspace/projects/ketantech-AppGateway
git pull --ff-only origin main
npm ci
npm run build
npm --prefix dashboard ci
npm --prefix dashboard run build
systemctl restart ketantech-payment.service
systemctl restart ketantech-dashboard.service
curl -fsS http://127.0.0.1:3000/health
curl -fsS http://127.0.0.1:3000/health/providers
```

## Jangan commit file ini

Pastikan file berikut tidak ikut commit/push:

- `.env`
- `dashboard/.env.local`
- `data/gateway.db`
- backup lokal `*.backup`
- arsip/deploy artifact lokal `*.tar.gz`

## Setelah deploy

Cek dari luar VPS:

- Dashboard: `https://pay.ketantech.my.id`
- API health: `https://pay.ketantech.my.id/health`
- Telegram bot: kirim `/menu`

## Rollback cepat

Cari commit sebelumnya:

```bash
git log --oneline -5
```

Checkout commit aman, build, restart:

```bash
git checkout <commit>
npm ci
npm run build
npm --prefix dashboard ci
npm --prefix dashboard run build
systemctl restart ketantech-payment.service ketantech-dashboard.service
curl -fsS http://127.0.0.1:3000/health
```

Setelah selesai emergency rollback, jangan lupa balik ke branch:

```bash
git checkout main
```
