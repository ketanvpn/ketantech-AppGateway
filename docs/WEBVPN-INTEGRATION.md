# Integrasi WebVPN ↔ KetantechPay (Tanpa Coding Rumit)

Dokumen ini khusus untuk integrasi **WebVPN** ke **KetantechPay** sebagai gateway pusat.

## Tujuan

- WebVPN tidak lagi webhook langsung ke provider satu-satu.
- Semua provider masuk ke KetantechPay.
- KetantechPay yang kirim webhook ke WebVPN.

---

## 1) Isi Pengaturan di WebVPN

Di **Admin → Payment Settings → KetantechPay**, isi:

1. **Base URL KetantechPay**
   - Contoh: `https://pay.ketantech.my.id`
2. **Client API Key** (opsional)
   - Isi jika KetantechPay mewajibkan key untuk endpoint public charge.
3. **Webhook Secret** (wajib)
   - Contoh: `secret-webvpn-prod-32-char`

> Simpan nilai secret ini. Harus sama persis dengan secret target di KetantechPay.

---

## 2) Daftarkan Webhook Target di KetantechPay

Tambahkan target webhook outbound ke WebVPN.

- **URL target WebVPN**:  
  `https://DOMAIN-WEBVPN-MU/api/webhooks/ketantechpay`
- **Secret**: sama persis dengan `Webhook Secret` di WebVPN.
- **Events minimum**: `success`
- **Saran**: `success`, `failed`, `expired`, `refunded`

Contoh request (admin API KetantechPay):

```bash
curl -X PUT https://pay.ketantech.my.id/api/v1/admin/webhook-targets \
  -H "Content-Type: application/json" \
  -H "X-Admin-Key: <ADMIN_API_KEY>" \
  -d '{
    "targets": [
      {
        "id": "webvpn-prod",
        "name": "WebVPN Production",
        "url": "https://DOMAIN-WEBVPN-MU/api/webhooks/ketantechpay",
        "secret": "secret-webvpn-prod-32-char",
        "enabled": true,
        "events": ["success", "failed", "expired", "refunded"]
      }
    ]
  }'
```

---

## 3) Cara Kerja Singkat

1. User checkout/topup di WebVPN.
2. WebVPN minta QRIS ke KetantechPay (`/api/v1/payments/charge`).
3. User bayar.
4. Provider update ke KetantechPay (webhook provider).
5. KetantechPay kirim webhook ke WebVPN (`/api/webhooks/ketantechpay`).
6. WebVPN auto-proses topup/order.

---

## 4) Checklist Go-Live

- [ ] Base URL KetantechPay di WebVPN benar.
- [ ] Webhook secret sama persis di dua sisi.
- [ ] Target webhook status **enabled**.
- [ ] Event `success` aktif.
- [ ] Test 1 transaksi sampai status sukses.

---

## 5) Troubleshooting Cepat

### Webhook tidak masuk WebVPN
- Cek URL target benar (`/api/webhooks/ketantechpay`).
- Cek domain WebVPN bisa diakses publik.

### Signature invalid
- Secret di KetantechPay dan WebVPN tidak sama.

### Sudah bayar tapi status user belum update
- Cek log delivery webhook di KetantechPay.
- Cek log route webhook WebVPN.

