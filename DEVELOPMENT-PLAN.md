# Development Plan — KetantechPay Gateway

> **Dokumen ini berisi rencana pengembangan detail untuk semua fase improvement.**
> **Dibuat:** 23 Mei 2026
> **Status:** Living document (akan diupdate seiring progress)

---

## 📋 Overview

Dokumen ini adalah roadmap teknis lengkap untuk pengembangan KetantechPay Gateway dari hasil audit. Setiap fase memiliki detail implementasi, code examples, testing checklist, dan estimasi waktu.

### Quick Navigation
- [Fase 1: Stabilisasi & Keamanan](#fase-1-stabilisasi--keamanan)
- [Fase 2: Deployment ke Production](#fase-2-deployment-ke-production)
- [Fase 3: Quick Wins Improvements](#fase-3-quick-wins-improvements)
- [Fase 4: Analytics & Reporting](#fase-4-analytics--reporting)
- [Fase 5: Optimization & Code Quality](#fase-5-optimization--code-quality)
- [Fase 6: Fitur Tambahan](#fase-6-fitur-tambahan)
- [Fase 7: Evolusi ke SaaS](#fase-7-evolusi-ke-saas)

---

## Fase 1: Stabilisasi & Keamanan

**Prioritas:** CRITICAL ⚠️  
**Durasi:** 1-2 minggu  
**Effort:** 3-4 hari kerja

### Item #1: Generate Secure Keys

**Estimasi:** 30 menit  
**Prioritas:** CRITICAL

#### Tujuan
Generate API keys yang aman untuk production deployment.

#### Prerequisites
- Node.js installed
- Access ke .env file

#### Step-by-Step

1. **Generate ADMIN_API_KEY**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# Output: 7c3a8e9b2f1d4a6c8e0f9b3a5d7c9e1b2f4a6c8e0f9b3a5d7c9e1b2f4a6c8e
```

2. **Generate ENCRYPTION_KEY** (terpisah dari ADMIN_API_KEY)
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# Output: 1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p7q8r9s0t1u2v3w4x5y6z7a8b9c0d1e
```

3. **Update .env**
```env
ADMIN_API_KEY=7c3a8e9b2f1d4a6c8e0f9b3a5d7c9e1b2f4a6c8e0f9b3a5d7c9e1b2f4a6c8e
ENCRYPTION_KEY=1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p7q8r9s0t1u2v3w4x5y6z7a8b9c0d1e
```

4. **Backup keys ke password manager** (1Password, Bitwarden, LastPass)

5. **Test login dashboard**
```bash
# Restart server
npm start

# Buka http://localhost:3001
# Login dengan ADMIN_API_KEY yang baru
```

#### Testing Checklist
- [ ] ADMIN_API_KEY minimal 32 karakter
- [ ] ENCRYPTION_KEY berbeda dari ADMIN_API_KEY
- [ ] Login dashboard berhasil dengan key baru
- [ ] Keys tersimpan aman di password manager
- [ ] .env tidak ter-commit ke git

#### Rollback Plan
Kalau ada masalah, restore .env dari backup.

---

### Item #2: Setup Backup Otomatis

**Estimasi:** 2-3 jam  
**Prioritas:** CRITICAL

#### Tujuan
Backup database harian otomatis dengan retention policy.

#### Prerequisites
- Akses ke server/hosting
- Cloud storage account (Google Drive/Dropbox/B2)

#### Step-by-Step

1. **Buat script backup**

Buat file `scripts/backup.sh`:
```bash
#!/bin/bash
# Backup script untuk gateway.db

DATE=$(date +%Y-%m-%d)
BACKUP_DIR="/var/backups/ketantech-gateway"
DB_PATH="/var/www/ketantech-gateway/data/gateway.db"
BACKUP_FILE="$BACKUP_DIR/gateway-$DATE.db"

# Create backup directory
mkdir -p $BACKUP_DIR

# Backup database
cp $DB_PATH $BACKUP_FILE

# Compress
gzip $BACKUP_FILE

# Keep only last 30 days
find $BACKUP_DIR -name "gateway-*.db.gz" -mtime +30 -delete

echo "Backup completed: $BACKUP_FILE.gz"
```

2. **Make executable**
```bash
chmod +x scripts/backup.sh
```

3. **Test manual backup**
```bash
./scripts/backup.sh
ls -lh /var/backups/ketantech-gateway/
```

4. **Setup cron job** (harian jam 2 pagi)
```bash
crontab -e

# Tambahkan:
0 2 * * * /var/www/ketantech-gateway/scripts/backup.sh >> /var/log/gateway-backup.log 2>&1
```

5. **Setup upload ke cloud** (optional tapi recommended)

Install rclone:
```bash
curl https://rclone.org/install.sh | sudo bash
rclone config  # Setup Google Drive/Dropbox
```

Update script backup tambahkan:
```bash
# Upload to cloud
rclone copy $BACKUP_FILE.gz gdrive:ketantech-backups/
```

#### Testing Checklist
- [ ] Script backup berjalan tanpa error
- [ ] File backup ter-create di /var/backups
- [ ] File backup ter-compress (.gz)
- [ ] Cron job terdaftar (crontab -l)
- [ ] Test restore: copy backup → data/gateway.db
- [ ] Upload ke cloud berhasil (kalau pakai)

#### Rollback Plan
Restore dari backup terakhir:
```bash
gunzip /var/backups/ketantech-gateway/gateway-2026-05-23.db.gz
cp /var/backups/ketantech-gateway/gateway-2026-05-23.db /var/www/ketantech-gateway/data/gateway.db
pm2 restart all
```

---

### Item #3: Monitoring & Alerting (Sentry)

**Estimasi:** 1 hari  
**Prioritas:** HIGH

#### Tujuan
Real-time error tracking dan alerting untuk production.

#### Prerequisites
- Sentry account (free tier cukup)
- npm access

#### Step-by-Step

1. **Buat project di Sentry**
- Login ke https://sentry.io
- Create new project → Node.js
- Copy DSN: `https://xxx@xxx.ingest.sentry.io/xxx`

2. **Install Sentry SDK**
```bash
npm install @sentry/node @sentry/profiling-node
```

3. **Integrate di backend**

Edit `src/index.ts`:
```typescript
import * as Sentry from "@sentry/node";
import { ProfilingIntegration } from "@sentry/profiling-node";

// Initialize Sentry BEFORE any other code
if (config.nodeEnv === "production") {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    integrations: [
      new ProfilingIntegration(),
    ],
    tracesSampleRate: 0.1, // 10% transactions
    profilesSampleRate: 0.1,
    environment: config.nodeEnv,
  });
}

// ... rest of code
```

4. **Add error handler**

Edit `src/app.ts`:
```typescript
// Sentry error handler (harus sebelum error handler lain)
if (config.nodeEnv === "production") {
  app.use(Sentry.Handlers.requestHandler());
  app.use(Sentry.Handlers.tracingHandler());
}

// ... routes ...

// Sentry error handler (harus setelah routes, sebelum error handler)
if (config.nodeEnv === "production") {
  app.use(Sentry.Handlers.errorHandler());
}

// Your error handler
app.use((err, req, res, next) => {
  // ...
});
```

5. **Add to .env**
```env
SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx
```

6. **Test error tracking**
```typescript
// Tambah endpoint test (DEV only)
if (config.nodeEnv === "development") {
  app.get("/debug-sentry", () => {
    throw new Error("Test Sentry error tracking");
  });
}
```

7. **Setup alerts di Sentry dashboard**
- Settings → Alerts → New Alert Rule
- Condition: Error count > 10 in 5 minutes
- Action: Send to Telegram/Email

#### Testing Checklist
- [ ] Sentry SDK installed
- [ ] DSN configured di .env
- [ ] Test error muncul di Sentry dashboard
- [ ] Alert notification terkirim
- [ ] Performance monitoring aktif
- [ ] Source maps uploaded (untuk stack trace)

#### Rollback Plan
Kalau Sentry menyebabkan masalah, comment out Sentry.init() dan restart.

---

### Item #4: Security Penetration Testing

**Estimasi:** 1-2 hari  
**Prioritas:** HIGH

#### Tujuan
Verify semua security controls berfungsi dengan baik.

#### Prerequisites
- Gateway running di dev/staging
- Tools: curl, Postman, OWASP ZAP (optional)

#### Test Cases

**1. SQL Injection Test**
```bash
# Test parameterized query
curl -X GET "http://localhost:3000/api/v1/payments?orderId='; DROP TABLE transactions; --"
# Expected: 404 atau empty result, BUKAN error SQL
```

**2. SSRF Test**
```bash
# Test private IP block
curl -X PUT http://localhost:3000/api/v1/admin/credentials \
  -H "X-Admin-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "midtrans",
    "field": "baseUrl",
    "value": "http://169.254.169.254/latest/meta-data"
  }'
# Expected: 400 Bad Request "SSRF attempt detected"
```

**3. Account Lockout Test**
```bash
# Test brute force protection
for i in {1..11}; do
  curl -X GET http://localhost:3000/api/v1/admin/stats \
    -H "X-Admin-Key: wrong-key-$i"
done
# Expected: Setelah 10 attempts, return 429 Too Many Requests
```

**4. Webhook Signature Test**
```bash
# Test webhook tanpa signature
curl -X POST http://localhost:3000/api/v1/webhooks/midtrans \
  -H "Content-Type: application/json" \
  -d '{"order_id": "TEST-001", "transaction_status": "settlement"}'
# Expected: 401 Unauthorized
```

**5. Encryption Test**
```bash
# Set credential via dashboard
# Check database: sqlite3 data/gateway.db "SELECT * FROM credentials"
# Expected: value_json berisi "enc:v1:..." (encrypted)
```

**6. Rate Limiting Test**
```bash
# Test rate limit /payments
for i in {1..101}; do
  curl -X POST http://localhost:3000/api/v1/payments/charge \
    -H "Idempotency-Key: test-$i" \
    -H "Content-Type: application/json" \
    -d '{"orderId":"TEST","amount":1000,"currency":"IDR","method":"qris"}'
done
# Expected: Setelah 100 requests, return 429
```

**7. CORS Test**
```bash
# Test CORS dari origin tidak diizinkan
curl -X POST http://localhost:3000/api/v1/payments/charge \
  -H "Origin: https://evil.com" \
  -H "Content-Type: application/json"
# Expected: CORS error atau no Access-Control-Allow-Origin header
```

#### Testing Checklist
- [ ] SQL injection blocked
- [ ] SSRF attempts blocked (private IP, localhost, AWS metadata)
- [ ] Account lockout aktif setelah 10 failed attempts
- [ ] Webhook signature verification berfungsi
- [ ] Credentials encrypted di database
- [ ] Rate limiting berfungsi untuk semua endpoints
- [ ] CORS hanya allow origin yang di-whitelist
- [ ] Audit log mencatat semua admin actions
- [ ] PII redaction di log (email/phone di-mask)

#### Rollback Plan
Tidak ada rollback - ini testing only.

#### Report Template
```markdown
# Security Penetration Test Report
Date: 2026-05-23
Tester: [Name]

## Test Results
| Test Case | Status | Notes |
|-----------|--------|-------|
| SQL Injection | ✅ PASS | Parameterized queries working |
| SSRF Protection | ✅ PASS | Private IP blocked |
| Account Lockout | ✅ PASS | Locked after 10 attempts |
| Webhook Signature | ✅ PASS | Invalid signature rejected |
| Encryption at Rest | ✅ PASS | AES-256-GCM working |
| Rate Limiting | ✅ PASS | 429 after threshold |
| CORS | ✅ PASS | Only whitelisted origins |

## Findings
- No critical vulnerabilities found
- All security controls functioning as expected

## Recommendations
- Continue quarterly penetration testing
- Monitor Sentry for unusual patterns
```

---

## Fase 2: Deployment ke Production

**Prioritas:** HIGH 🚀  
**Durasi:** 3-5 hari  
**Effort:** 3-5 hari kerja

**📄 Detail lengkap:** [docs/FASE-2-DEPLOYMENT.md](./docs/FASE-2-DEPLOYMENT.md)

### Item #5: Deploy ke Production (1-2 hari)
- Setup VPS Ubuntu dengan Node.js 20, Nginx, PM2
- Clone repo & build production
- Konfigurasi .env dengan keys dari Fase 1
- Setup HTTPS dengan Let's Encrypt
- Test health endpoints

### Item #6: Konfigurasi Provider Webhooks (2-3 jam)
- Set webhook URL di Midtrans, Xendit, DOKU, Tripay, AutoGoPay
- Test webhook dengan test transaction
- Verify signature verification berfungsi

### Item #7: Testing Production (1 hari)
- Test charge untuk semua provider
- Test webhook callback & status update
- Test fallback mechanism
- Test refund & idempotency

### Item #8: Load Testing (1 hari)
- Install k6 load testing tool
- Run load test (10 → 50 → 100 concurrent users)
- Measure throughput, latency, error rate
- Document capacity (~50 tx/minute untuk SQLite)

---

## Fase 3: Quick Wins Improvements

**Prioritas:** MEDIUM 📈  
**Durasi:** 1-2 minggu  
**Effort:** 5-7 hari kerja

### Item #9: OpenAPI/Swagger Documentation (1-2 hari)
- Install `swagger-ui-express` & `swagger-jsdoc`
- Buat `openapi.yaml` dengan spec untuk semua endpoints
- Expose di `/api-docs` dengan Swagger UI
- Update INTEGRATION.md dengan link dokumentasi

### Item #10: Webhook Retry Queue (2-3 hari)
- Buat tabel `webhook_queue` untuk failed webhooks
- Implement exponential backoff retry (1min, 5min, 15min, 1hr, 6hr)
- Background worker untuk process queue
- Dashboard page `/webhooks` untuk monitor & manual retry

### Item #11: Dark Mode Dashboard (1 hari)
- Tambah theme toggle button di navbar
- Implement dark theme dengan Tailwind `dark:` classes
- Save preference ke localStorage
- Test semua halaman (transactions, settings, docs)

### Item #12: Email Notification (1-2 hari)
- Integrasi SMTP (Resend/Postmark/AWS SES)
- Email template untuk: payment success, failed, refund
- Konfigurasi SMTP di `/settings`
- Test email delivery

### Item #13: i18n Support (2-3 hari)
- Install `next-i18next` untuk dashboard
- Translate semua text ke English
- Language switcher di navbar (ID/EN)
- Update documentation

---

## Fase 4: Analytics & Reporting

**Prioritas:** MEDIUM 📊  
**Durasi:** 1 minggu  
**Effort:** 3-5 hari kerja

### Item #14: Enhanced Analytics (2-3 hari)
- Chart success rate per provider (Chart.js/Recharts)
- Chart average response time per provider
- Revenue tracking & projection
- Export report PDF/Excel dengan jsPDF/ExcelJS

### Item #15: Transaction Search & Filter (1-2 hari)
- Full-text search di transaction (customer name, email, order ID)
- Advanced filter: amount range, date range, provider, status
- Saved filter presets
- Bulk operations (export selected, bulk refund)

---

## Fase 5: Optimization & Code Quality

**Prioritas:** LOW ⚡  
**Durasi:** 1-2 minggu  
**Effort:** 4-6 hari kerja

### Item #16: Performance Optimization (2-3 hari)
- Database indexing (transactions.orderId, transactions.createdAt)
- Response caching untuk `/health/providers` (30s TTL)
- Gzip compression untuk API responses
- CDN untuk dashboard static assets (Cloudflare/Vercel)

### Item #17: Code Refactoring (2-3 hari)
- Setup ESLint + Prettier dengan pre-commit hook
- Refactor duplicate code (extract utilities)
- Add JSDoc comments untuk public APIs
- Remove dead code & unused imports

### Item #18: API Rate Limit Per Client (1 hari)
- Implement per-client rate limiting (berbeda dari global)
- Different tiers: free (10 req/min), paid (100 req/min)
- Dashboard untuk monitor client usage
- Alert saat mendekati limit

---

## Fase 6: Fitur Tambahan

**Prioritas:** OPTIONAL ✨  
**Durasi:** 2-3 minggu  
**Effort:** Variable

### Item #19: Provider Baru (2-3 hari per provider)
- **Flip:** QRIS, VA, e-wallet (https://flip.id)
- **Duitku:** Multi-channel payment (https://duitku.com)
- **Nicepay:** Kartu kredit, installment (https://nicepay.co.id)
- **Faspay:** VA, retail (Indomaret/Alfamart)
- Implement provider class, test, dokumentasi

### Item #20: Advanced Features (1-2 minggu)
- **Recurring payment:** Subscription billing otomatis
- **Split payment:** Marketplace (split ke multiple accounts)
- **Escrow:** Hold funds sampai kondisi terpenuhi
- **Multi-currency:** Support USD, SGD, MYR
- **QR generator internal:** Generate QR tanpa provider

---

## Fase 7: Evolusi ke SaaS

**Prioritas:** FUTURE 🚀  
**Durasi:** 2-3 bulan  
**Effort:** 6-9 minggu kerja

### Item #21: Multi-User Authentication (1-2 minggu)
- Tabel `users` (email, password bcrypt, role, organizationId)
- Login form email/password (replace admin key dialog)
- JWT session dengan refresh token
- Forgot password flow (email reset link)
- Email verification saat signup
- Role-based access: owner, admin, viewer

### Item #22: Multi-Tenancy (2-3 minggu)
- Tabel `organizations` (name, plan, billing_status)
- Add `organizationId` ke semua tabel (transactions, credentials, settings)
- Middleware auto-inject organizationId ke query
- Per-org credentials & settings isolation
- Per-org rate limiting
- Super admin panel untuk manage orgs

### Item #23: Billing & Subscription (2-3 minggu)
- Tabel `subscriptions` (org_id, plan, period_start, period_end, status)
- Tabel `invoices` (org_id, period, amount, paid_at)
- Plan tiers: Free (100 tx/mo), Starter (1K tx/mo), Pro (10K tx/mo)
- Usage counter & quota enforcement
- Self-service billing (pakai gateway sendiri!)
- Invoice generation & email reminder
- Webhook handler untuk subscription payment

### Item #24: Database Migration (1 minggu)
- Migrasi SQLite → PostgreSQL
- Setup Redis untuk idempotency store & rate limit
- Connection pooling (pg-pool)
- Update queries (SQLite syntax → PostgreSQL)
- Setup load balancer (Nginx/HAProxy)
- Multi-instance deployment

---

## Progress Tracking

- [ ] Fase 1: Stabilisasi & Keamanan (0/4)
- [ ] Fase 2: Deployment (0/4)
- [ ] Fase 3: Quick Wins (0/5)
- [ ] Fase 4: Analytics (0/2)
- [ ] Fase 5: Optimization (0/3)
- [ ] Fase 6: Fitur Tambahan (0/2)
- [ ] Fase 7: SaaS Evolution (0/4)

**Total Progress: 0/24 items**

---

---

## 📝 Quick Reference

### Fase 1: Stabilisasi & Keamanan (DETAIL LENGKAP ✅)
1. Generate Secure Keys (30 menit)
2. Setup Backup Otomatis (2-3 jam)
3. Monitoring & Alerting - Sentry (1 hari)
4. Security Penetration Testing (1-2 hari)

### Fase 2: Deployment (DETAIL LENGKAP ✅)
5. Deploy ke Production (1-2 hari) - [docs/FASE-2-DEPLOYMENT.md](./docs/FASE-2-DEPLOYMENT.md)
6. Konfigurasi Provider Webhooks (2-3 jam)
7. Testing Production (1 hari)
8. Load Testing (1 hari)

### Fase 3: Quick Wins (RINGKASAN ✅)
9. OpenAPI/Swagger Documentation (1-2 hari)
10. Webhook Retry Queue (2-3 hari)
11. Dark Mode Dashboard (1 hari)
12. Email Notification (1-2 hari)
13. i18n Support (2-3 hari)

### Fase 4: Analytics (RINGKASAN ✅)
14. Enhanced Analytics (2-3 hari)
15. Transaction Search & Filter (1-2 hari)

### Fase 5: Optimization (RINGKASAN ✅)
16. Performance Optimization (2-3 hari)
17. Code Refactoring (2-3 hari)
18. API Rate Limit Per Client (1 hari)

### Fase 6: Fitur Tambahan (RINGKASAN ✅)
19. Provider Baru - Flip, Duitku, Nicepay, Faspay (2-3 hari per provider)
20. Advanced Features - Recurring, Split, Escrow, Multi-currency (1-2 minggu)

### Fase 7: SaaS Evolution (RINGKASAN ✅)
21. Multi-User Authentication (1-2 minggu)
22. Multi-Tenancy (2-3 minggu)
23. Billing & Subscription (2-3 minggu)
24. Database Migration PostgreSQL + Redis (1 minggu)

---

## 🎯 Next Steps

**Untuk mulai development:**
1. **Fase 1** - Baca detail lengkap di atas, eksekusi item #1-4
2. **Fase 2** - Baca [docs/FASE-2-DEPLOYMENT.md](./docs/FASE-2-DEPLOYMENT.md), eksekusi item #5-8
3. **Fase 3-7** - Baca ringkasan di atas, eksekusi sesuai prioritas

**Rekomendasi urutan:**
- **Quick launch:** Fase 1-2 saja (2-3 minggu)
- **Production ready:** Fase 1-3 (1-2 bulan)
- **Feature complete:** Fase 1-5 (2-3 bulan)
- **SaaS platform:** Semua fase (4-6 bulan)

---

## 📞 Support & Maintenance

**Saat eksekusi:**
- Baca Prerequisites sebelum mulai
- Ikuti Step-by-Step secara berurutan
- Check Testing Checklist untuk verify
- Gunakan Rollback Plan kalau ada masalah

**Update progress:**
- Mark checkbox di Progress Tracking setelah selesai
- Update document version kalau ada perubahan besar
- Commit ke git setelah setiap fase selesai

---

**Document Version:** 2.0  
**Last Updated:** 23 Mei 2026  
**Status:** Semua fase documented (Fase 1 detail lengkap, Fase 2 file terpisah, Fase 3-7 ringkasan)  
**Total Items:** 24 items across 7 phases
