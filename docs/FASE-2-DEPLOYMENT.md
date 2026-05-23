# Fase 2: Deployment ke Production

**Prioritas:** HIGH 🚀  
**Durasi:** 3-5 hari  
**Effort:** 3-5 hari kerja

---

## Item #5: Deploy ke Production

**Estimasi:** 1-2 hari  
**Prioritas:** HIGH

### Tujuan
Deploy gateway ke production environment dengan HTTPS dan monitoring.

### Prerequisites
- VPS/Cloud account (DigitalOcean, Vultr, Railway, dll)
- Domain sudah pointing ke IP server
- SSH access ke server

### Step-by-Step (VPS Ubuntu)

#### 1. Persiapan Server

```bash
# Login ke VPS
ssh user@your-server-ip

# Update sistem
sudo apt update && sudo apt upgrade -y

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Install dependencies
sudo apt install -y git nginx certbot python3-certbot-nginx

# Install PM2
sudo npm install -g pm2
```

#### 2. Clone & Setup Aplikasi

```bash
# Buat folder
cd /var/www
sudo mkdir -p ketantech-gateway
sudo chown -R $USER:$USER ketantech-gateway
cd ketantech-gateway

# Clone repo
git clone https://github.com/ketanvpn/ketantech-AppGateway.git .

# Install dependencies
npm install
cd dashboard && npm install && cd ..

# Build
npm run build:all
```

#### 3. Konfigurasi Environment

```bash
# Copy .env
cp .env.example .env
nano .env
```

Isi minimal:
```env
NODE_ENV=production
PORT=3000

# Keys dari Fase 1 Item #1
ADMIN_API_KEY=<generated-key>
ENCRYPTION_KEY=<generated-key>

# Domain production
CORS_ORIGIN=https://gateway.yourdomain.com

# Trust proxy (karena di belakang nginx)
TRUST_PROXY=true

# Database path
DATABASE_PATH=/var/www/ketantech-gateway/data/gateway.db

# Provider order
PROVIDER_ORDER=midtrans,xendit,doku,tripay,orderkuota,autogopay

# Provider credentials (dari dashboard masing-masing)
MIDTRANS_SERVER_KEY=Mid-server-xxx
XENDIT_SECRET_KEY=xnd_xxx
XENDIT_CALLBACK_TOKEN=xxx
DOKU_CLIENT_ID=BRN-xxx
DOKU_SECRET_KEY=SK-xxx
TRIPAY_API_KEY=xxx
TRIPAY_PRIVATE_KEY=xxx
TRIPAY_MERCHANT_CODE=xxx

# Sentry (dari Fase 1 Item #3)
SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx

# Telegram (optional)
TELEGRAM_BOT_TOKEN=xxx
TELEGRAM_ADMIN_CHAT_IDS=xxx
```

#### 4. Setup PM2

```bash
# Buat folder data
mkdir -p /var/www/ketantech-gateway/data

# Start backend
pm2 start npm --name "gateway-backend" -- start

# Start dashboard
pm2 start npm --name "gateway-dashboard" --cwd ./dashboard -- start

# Save & auto-startup
pm2 save
pm2 startup
# Copy & jalankan command yang muncul

# Check status
pm2 status
pm2 logs
```

#### 5. Konfigurasi Nginx

```bash
sudo nano /etc/nginx/sites-available/gateway.yourdomain.com
```

Isi:
```nginx
server {
    listen 80;
    server_name gateway.yourdomain.com;

    # Dashboard di /
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

    # Backend API di /api dan /health
    location ~ ^/(api|health) {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    client_max_body_size 1m;
}
```

Aktifkan:
```bash
sudo ln -s /etc/nginx/sites-available/gateway.yourdomain.com /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

#### 6. Setup HTTPS dengan Let's Encrypt

```bash
sudo certbot --nginx -d gateway.yourdomain.com
```

Ikuti prompt, pilih opsi 2 (redirect HTTP → HTTPS).

#### 7. Test Deployment

```bash
# Test health
curl https://gateway.yourdomain.com/health

# Test API
curl https://gateway.yourdomain.com/api/v1/admin/stats \
  -H "X-Admin-Key: $ADMIN_API_KEY"
```

### Testing Checklist
- [ ] Server accessible via SSH
- [ ] Node.js 20 installed
- [ ] PM2 running backend & dashboard
- [ ] Nginx reverse proxy configured
- [ ] HTTPS aktif (Let's Encrypt)
- [ ] /health endpoint return 200
- [ ] Dashboard accessible via browser
- [ ] Login dashboard berhasil
- [ ] Production safety check pass (no default keys)

### Rollback Plan
```bash
# Stop services
pm2 stop all

# Restore previous version
git checkout <previous-commit>
npm install
npm run build:all
pm2 restart all
```

---

## Item #6: Konfigurasi Provider Webhooks

**Estimasi:** 2-3 jam  
**Prioritas:** HIGH

### Tujuan
Set webhook URL di dashboard provider agar notifikasi payment masuk ke gateway.

### Prerequisites
- Gateway sudah deploy dengan HTTPS
- Akses ke dashboard provider

### Step-by-Step

#### 1. Midtrans

Login ke https://dashboard.midtrans.com

- Settings → Configuration
- Payment Notification URL: `https://gateway.yourdomain.com/api/v1/webhooks/midtrans`
- Recurring/Pay Account Notification URL: (sama)
- Save

Test:
- Settings → Configuration → Send Test Notification
- Check log: `pm2 logs gateway-backend | grep midtrans`

#### 2. Xendit

Login ke https://dashboard.xendit.co

- Settings → Webhooks → Callbacks
- Invoice Paid: `https://gateway.yourdomain.com/api/v1/webhooks/xendit`
- Verification Token: (copy dari .env `XENDIT_CALLBACK_TOKEN`)
- Save

Test:
- Create test invoice
- Pay dengan test card
- Check log

#### 3. DOKU

Login ke https://dashboard.doku.com

- Integration → Webhook
- Notification URL: `https://gateway.yourdomain.com/api/v1/webhooks/doku`
- Save

Test:
- Create test transaction
- Check log

#### 4. Tripay

Login ke https://tripay.co.id/member

- API → Webhook
- Callback URL: `https://gateway.yourdomain.com/api/v1/webhooks/tripay`
- Save

Test:
- Create test transaction
- Check log

#### 5. AutoGoPay

Login ke https://v1-gateway.autogopay.site

- Settings → Webhook
- Callback URL: `https://gateway.yourdomain.com/api/v1/webhooks/autogopay`
- Save

### Testing Checklist
- [ ] Midtrans webhook configured & tested
- [ ] Xendit webhook configured & tested
- [ ] DOKU webhook configured & tested
- [ ] Tripay webhook configured & tested
- [ ] AutoGoPay webhook configured & tested
- [ ] Webhook signature verification berfungsi
- [ ] Transaction status update otomatis
- [ ] Telegram notification terkirim (kalau aktif)

### Troubleshooting

**Webhook tidak masuk:**
- Check firewall: port 443 open
- Check nginx log: `sudo tail -f /var/log/nginx/error.log`
- Check PM2 log: `pm2 logs gateway-backend`
- Test manual: `curl -X POST https://gateway.yourdomain.com/api/v1/webhooks/midtrans`

**Signature verification failed:**
- Verify `MIDTRANS_SERVER_KEY` di .env match dengan dashboard
- Verify `XENDIT_CALLBACK_TOKEN` match
- Check log untuk detail error

---

## Item #7: Testing Production

**Estimasi:** 1 hari  
**Prioritas:** HIGH

### Tujuan
Verify semua fitur berfungsi di production environment.

### Test Scenarios

#### 1. Test Charge (Setiap Provider)

**Midtrans:**
```bash
curl -X POST https://gateway.yourdomain.com/api/v1/payments/charge \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: test-mid-001" \
  -d '{
    "orderId": "TEST-MID-001",
    "amount": 10000,
    "currency": "IDR",
    "method": "qris",
    "customer": {
      "name": "Test User",
      "email": "test@example.com",
      "phone": "081234567890"
    }
  }'
```

Expected: 201 Created dengan `paymentUrl` (QR code image)

**Xendit, DOKU, Tripay, AutoGoPay:** (sama, ganti Idempotency-Key & orderId)

#### 2. Test Webhook Callback

- Buat transaksi test
- Pay dengan test payment method
- Verify status update di dashboard
- Check Telegram notification (kalau aktif)

#### 3. Test Fallback Mechanism

```bash
# Force-down provider utama di dashboard
# Settings → Provider Settings → Midtrans → Force Down

# Charge lagi
curl -X POST https://gateway.yourdomain.com/api/v1/payments/charge \
  -H "Idempotency-Key: test-fallback-001" \
  -d '{ ... }'

# Expected: Fallback ke Xendit (provider kedua)
# Check response: "providerName": "xendit"
```

#### 4. Test Refund

- Buka dashboard → Transactions
- Pilih transaksi success
- Klik Refund
- Verify refund berhasil di provider dashboard

#### 5. Test Idempotency

```bash
# Kirim request yang sama 2x
IDEM_KEY="test-idem-$(date +%s)"

curl -X POST https://gateway.yourdomain.com/api/v1/payments/charge \
  -H "Idempotency-Key: $IDEM_KEY" \
  -d '{ "orderId": "TEST-IDEM", "amount": 5000, ... }'

# Kirim lagi dengan Idempotency-Key sama
curl -X POST https://gateway.yourdomain.com/api/v1/payments/charge \
  -H "Idempotency-Key: $IDEM_KEY" \
  -d '{ "orderId": "TEST-IDEM", "amount": 5000, ... }'

# Expected: Response kedua return cached result (tidak double-charge)
```

### Testing Checklist
- [ ] Charge berhasil untuk semua provider
- [ ] Webhook callback update status
- [ ] Fallback mechanism berfungsi
- [ ] Refund berhasil
- [ ] Idempotency prevent double-charge
- [ ] Rate limiting berfungsi
- [ ] CORS hanya allow whitelisted origin
- [ ] HTTPS enforced (HTTP redirect ke HTTPS)
- [ ] Dashboard mobile-friendly
- [ ] Export CSV berfungsi

---

## Item #8: Load Testing

**Estimasi:** 1 hari  
**Prioritas:** MEDIUM

### Tujuan
Measure capacity & identify bottlenecks.

### Prerequisites
- k6 atau Artillery installed
- Gateway running di production

### Step-by-Step

#### 1. Install k6

```bash
# Di local machine
brew install k6  # macOS
# atau
sudo apt install k6  # Ubuntu
```

#### 2. Buat Load Test Script

`load-test.js`:
```javascript
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '1m', target: 10 },   // Ramp up to 10 users
    { duration: '3m', target: 50 },   // Stay at 50 users
    { duration: '1m', target: 100 },  // Spike to 100 users
    { duration: '2m', target: 0 },    // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<2000'], // 95% requests < 2s
    http_req_failed: ['rate<0.05'],    // Error rate < 5%
  },
};

export default function () {
  const url = 'https://gateway.yourdomain.com/api/v1/payments/charge';
  const payload = JSON.stringify({
    orderId: `LOAD-TEST-${Date.now()}-${__VU}-${__ITER}`,
    amount: 10000,
    currency: 'IDR',
    method: 'qris',
    customer: {
      name: 'Load Test User',
      email: 'loadtest@example.com',
    },
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': `load-${Date.now()}-${__VU}-${__ITER}`,
    },
  };

  const res = http.post(url, payload, params);

  check(res, {
    'status is 201': (r) => r.status === 201,
    'has paymentUrl': (r) => JSON.parse(r.body).paymentUrl !== undefined,
  });

  sleep(1);
}
```

#### 3. Run Load Test

```bash
k6 run load-test.js
```

#### 4. Analyze Results

Output contoh:
```
     ✓ status is 201
     ✓ has paymentUrl

     checks.........................: 100.00% ✓ 5000      ✗ 0
     data_received..................: 15 MB   50 kB/s
     data_sent......................: 5.0 MB  17 kB/s
     http_req_blocked...............: avg=1.2ms   min=0s   med=1ms   max=50ms  p(95)=3ms
     http_req_duration..............: avg=450ms   min=100ms med=400ms max=2s    p(95)=800ms
     http_req_failed................: 0.00%   ✓ 0        ✗ 5000
     http_reqs......................: 5000    16.67/s
     iteration_duration.............: avg=1.5s    min=1.1s med=1.4s  max=3s
     vus............................: 100     min=0      max=100
```

#### 5. Monitor Server Resources

Saat load test berjalan:
```bash
# CPU & Memory
htop

# PM2 monitoring
pm2 monit

# Database size
du -h data/gateway.db

# Nginx connections
sudo netstat -an | grep :443 | wc -l
```

### Testing Checklist
- [ ] Load test script berjalan tanpa error
- [ ] 95% requests < 2 detik
- [ ] Error rate < 5%
- [ ] Server CPU < 80%
- [ ] Server memory < 80%
- [ ] Database tidak corrupt
- [ ] No memory leaks (check `pm2 monit`)

### Capacity Planning

Berdasarkan hasil load test:

| Metric | Target | Actual | Status |
|--------|--------|--------|--------|
| Throughput | 50 req/s | 16.67 req/s | ⚠️ Need optimization |
| P95 Latency | < 2s | 800ms | ✅ Good |
| Error Rate | < 5% | 0% | ✅ Excellent |
| CPU Usage | < 80% | 45% | ✅ Good |
| Memory | < 80% | 60% | ✅ Good |

**Recommendations:**
- Current capacity: ~50 transactions/minute
- For higher load: Add Redis cache, PostgreSQL, load balancer
- Monitor Sentry for errors during peak

### Rollback Plan
Tidak ada rollback - ini testing only.

---

## Summary Fase 2

✅ **Completed:**
- Gateway deployed ke production dengan HTTPS
- Webhook configured untuk semua provider
- Production testing passed
- Load testing completed & capacity documented

🎯 **Next:** Fase 3 - Quick Wins Improvements
