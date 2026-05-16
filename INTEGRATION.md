# Panduan Integrasi — Pasang ke Aplikasi Internal Anda

Dokumen ini menjelaskan cara aplikasi internal (e-commerce, billing, POS, dll) memanggil **Payment Gateway** ini untuk mengeksekusi pembayaran. Setelah ini, aplikasi Anda tidak perlu tahu Midtrans/Xendit/DOKU/Tripay — cukup bicara dengan satu endpoint.

---

## 1. Diagram Alur

```
┌─────────────┐     1. POST /charge      ┌──────────────┐    pilih provider    ┌──────────┐
│ Aplikasi    │ ───────────────────────► │   Payment    │ ───────────────────► │ Midtrans │
│ Internal    │                          │   Gateway    │   (fallback otomatis)│  Xendit  │
│ (App Anda)  │ ◄─────────────────────── │              │ ◄─────────────────── │   DOKU   │
└─────┬───────┘     2. response          └──────┬───────┘                      │  Tripay  │
      │             paymentUrl + status         │                              └────┬─────┘
      │                                         │                                   │
      │                                         │     5. webhook callback           │
      │                                         │ ◄─────────────────────────────────┘
      │                                         │     POST /api/v1/webhooks/<provider>
      │                                         │
      │  3. user buka paymentUrl, bayar         │
      │  4. gateway update status               │
      │                                         │
      │     6. (optional) Anda polling          │
      │  ◄──────────────────────────────────────│
      │   GET /api/v1/payments/:id              │
```

**Flow ringkas:**
1. App Anda kirim `POST /api/v1/payments/charge` ke gateway.
2. Gateway memilih provider, return `paymentUrl` + `transactionId` (status: `pending`).
3. App tampilkan `paymentUrl` ke user (redirect / QR / tombol).
4. User bayar di provider. Provider callback ke gateway → status berubah ke `success`/`failed`/`expired`.
5. App polling status atau (lebih baik) menerima notifikasi dari Anda sendiri saat status terminal.

---

## 2. Prasyarat

Sebelum integrasi, gateway harus sudah berjalan dan reachable dari app Anda:

```bash
# Cek liveness
curl http://gateway-host:3000/health
# {"status":"ok","uptime":...}

# Cek provider tersedia
curl http://gateway-host:3000/health/providers
# {"status":"ok","providers":[{"name":"midtrans","healthy":true}, ...]}
```

Kalau gateway di-deploy terpisah, ganti `localhost:3000` di semua contoh dengan host & port asli.

---

## 3. Aturan Wajib (Penting!)

Apa pun bahasa/framework yang Anda pakai:

| Aturan | Kenapa |
|--------|--------|
| **Header `Idempotency-Key` wajib** di setiap `POST /charge` | Cegah double-charge saat client retry / network glitch |
| Idempotency key harus **unik per attempt logical** (mis. `<orderId>-<uuid>`) | Kalau key sama dipakai dua kali, gateway return response yang sama, tidak charge lagi |
| **Timeout** dari sisi app: 10 detik | Jangan biarkan request menggantung |
| **Retry hanya pada 5xx & network error** | Jangan retry pada 400 (bad request) atau 401 (auth) |
| Jangan simpan paymentUrl ke DB selamanya | URL bisa expired; selalu cek status via gateway |
| **Source of truth = gateway**, bukan local DB Anda | Status real ada di gateway (yang sync dengan provider via webhook) |

---

## 4. Quick Start per Bahasa

Drop satu file client wrapper ke project Anda, lalu pakai. Semua wrapper sudah handle: timeout, retry exponential backoff, idempotency key auto-generate, error mapping.

### 4.1 Node.js / Express (file: `examples/nodejs-express/client.js`)

**Install:** tidak ada (pakai `fetch` built-in Node 18+).

**Pakai:**
```js
const { PaymentGatewayClient, PaymentGatewayError } =
  require("./PaymentGatewayClient");

const gateway = new PaymentGatewayClient({
  baseUrl: process.env.GATEWAY_URL || "http://localhost:3000",
  timeoutMs: 10_000,
});

// Di route handler checkout:
app.post("/checkout", async (req, res) => {
  try {
    const tx = await gateway.charge({
      orderId: `ORD-${Date.now()}`,
      amount: 50000,
      currency: "IDR",
      method: "qris",                     // qris|ewallet|bank_transfer|credit_card
      customer: { name: "Budi", email: "budi@example.com" },
      description: "Pembelian item A",
    });
    // tx = { id, orderId, status, paymentUrl, providerName, ... }
    res.json({
      transactionId: tx.id,
      paymentUrl: tx.paymentUrl,        // user redirect ke sini
      status: tx.status,                // "pending"
    });
  } catch (err) {
    if (err instanceof PaymentGatewayError) {
      if (err.code === "ALL_PROVIDERS_FAILED") {
        return res.status(503).json({ message: "Pembayaran sedang tidak tersedia" });
      }
      return res.status(err.status).json({ error: err.code, message: err.message });
    }
    res.status(500).json({ error: "INTERNAL_ERROR" });
  }
});
```

### 4.2 PHP / Laravel (file: `examples/php/PaymentGatewayClient.php`)

**Install:** tidak ada (pakai cURL built-in).

**Pakai (Laravel Controller):**
```php
use App\Services\PaymentGatewayClient;
use App\Services\PaymentGatewayException;

class CheckoutController extends Controller
{
    public function store(Request $req)
    {
        $client = new PaymentGatewayClient(env('GATEWAY_URL', 'http://localhost:3000'));
        try {
            $tx = $client->charge([
                'orderId'  => 'ORD-' . now()->timestamp,
                'amount'   => 50000,
                'currency' => 'IDR',
                'method'   => 'qris',
                'customer' => [
                    'name'  => $req->customer_name,
                    'email' => $req->customer_email,
                ],
                'description' => 'Pembelian item A',
            ]);
            return response()->json([
                'transactionId' => $tx['id'],
                'paymentUrl'    => $tx['paymentUrl'],
                'status'        => $tx['status'],
            ], 201);
        } catch (PaymentGatewayException $e) {
            if ($e->code === 'ALL_PROVIDERS_FAILED') {
                return response()->json(['message' => 'Pembayaran sedang tidak tersedia'], 503);
            }
            return response()->json(['error' => $e->code, 'message' => $e->getMessage()], $e->statusCode);
        }
    }
}
```

### 4.3 Python / FastAPI / Django (file: `examples/python-fastapi/client.py`)

**Install:**
```bash
pip install httpx
```

**Pakai (FastAPI):**
```python
from client import PaymentGatewayClient, PaymentGatewayError

gateway = PaymentGatewayClient(base_url="http://localhost:3000", timeout_sec=10)

@app.post("/checkout")
async def checkout(req: CheckoutRequest):
    try:
        tx = await gateway.charge(
            order_id=f"ORD-{int(time.time())}",
            amount=50000,
            currency="IDR",
            method="qris",
            customer={"name": req.customer_name, "email": req.customer_email},
            description="Pembelian item A",
        )
    except PaymentGatewayError as e:
        if e.code == "ALL_PROVIDERS_FAILED":
            raise HTTPException(503, "Pembayaran sedang tidak tersedia")
        raise HTTPException(e.status_code, {"error": e.code, "message": e.message})

    return {
        "transactionId": tx["id"],
        "paymentUrl": tx["paymentUrl"],
        "status": tx["status"],
    }
```

### 4.4 Bahasa Lain (Go, Java, Ruby, .NET)

Belum ada wrapper resmi, tapi prinsipnya sama. Cukup HTTP call ke `POST /api/v1/payments/charge` dengan:
- Header `Content-Type: application/json`
- Header `Idempotency-Key: <unique-string>`
- Body JSON sesuai schema (lihat README atau section 6 di bawah)

Implementasikan: timeout 10 detik, retry 2x pada 5xx/network error dengan exponential backoff.

---

## 5. Polling Status / Cek Update

Setelah charge, status awal = `pending`. App Anda perlu tahu kapan jadi `success`.

### 5.1 Cara Mudah: Polling

Polling tiap 2-5 detik di halaman thank-you sampai status terminal (`success`/`failed`/`expired`/`refunded`):

```js
// Node.js
const tx = await gateway.getById(transactionId);
// tx.status: "pending" | "success" | "failed" | "expired" | "refunded"
```

```php
// PHP
$tx = $client->getById($transactionId);
```

```python
# Python
tx = await gateway.get_by_id(transaction_id)
```

Atau by orderId (jika Anda sudah punya):
```bash
curl http://gateway-host:3000/api/v1/payments?orderId=ORD-123
```

### 5.2 Cara Lebih Baik: Webhook ke App Anda

Polling boros bandwidth. Lebih baik gateway notify app Anda saat status berubah. **Saat ini gateway belum forward webhook ke aplikasi internal otomatis.** Sebagai workaround:

- Implementasikan polling latar belakang (background job tiap 5 detik), atau
- Tambah forwarding di `src/services/webhookService.ts` (kirim HTTP POST ke app Anda setelah `applied`).

Roadmap fitur ini sudah masuk daftar.

---

## 6. Schema Request & Response

### `POST /api/v1/payments/charge`

**Headers:**
```
Content-Type: application/json
Idempotency-Key: <unique-string>     ← wajib
```

**Body:**
```json
{
  "orderId": "ORD-001",
  "amount": 50000,
  "currency": "IDR",
  "method": "qris",
  "customer": {
    "name": "Budi",
    "email": "budi@example.com",
    "phone": "+628123456789"
  },
  "description": "Pembelian item A"
}
```

| Field | Type | Catatan |
|-------|------|---------|
| `orderId` | string (1-64) | ID order di sisi App Anda. Unik per order logikal. |
| `amount` | integer positif | Dalam satuan terkecil (rupiah, bukan ribuan rupiah) |
| `currency` | string (3 char) | "IDR" |
| `method` | enum | `credit_card` \| `bank_transfer` \| `ewallet` \| `qris` |
| `customer.name` | string | Wajib |
| `customer.email` | email | Wajib |
| `customer.phone` | string | Opsional |
| `description` | string (≤255) | Opsional |

**Response 201 (sukses):**
```json
{
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "orderId": "ORD-001",
    "amount": 50000,
    "currency": "IDR",
    "method": "qris",
    "status": "pending",
    "providerName": "midtrans",
    "providerTransactionId": "MTRN-...",
    "paymentUrl": "https://app.sandbox.midtrans.com/snap/...",
    "attempts": [
      { "providerName": "midtrans", "success": true, "at": "2026-05-16T..." }
    ],
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

**Response Error:**

| Status | `error` code | Artinya | Action App Anda |
|--------|--------------|---------|-----------------|
| 400 | `IDEMPOTENCY_KEY_REQUIRED` | Lupa kirim header | Fix code, jangan retry |
| 400 | `VALIDATION_ERROR` | Body tidak valid | Tampilkan error ke user, jangan retry |
| 409 | `IDEMPOTENCY_IN_PROGRESS` | Request dengan key sama sedang diproses | Tunggu & polling status |
| 429 | `RATE_LIMIT_EXCEEDED` | Terlalu banyak request | Backoff, retry kemudian |
| 503 | `ALL_PROVIDERS_FAILED` | Semua provider down | Tampilkan "coba lagi nanti" |
| 5xx | (lainnya) | Server error | Auto-retry (sudah di wrapper) |

---

## 7. Best Practice

1. **Generate `orderId` di sisi App Anda**, bukan di gateway. Pakai format yang Anda kontrol (mis. `ORD-{timestamp}-{shortUuid}`).
2. **Simpan `transactionId` (UUID gateway) di tabel order** Anda — pakai itu untuk polling.
3. **Idempotency key** = `${orderId}-${attempt}`. Saat retry, generate ulang attempt counter, jangan reuse key lama.
4. **Validasi amount di server**, jangan trust input dari frontend.
5. **Logging:** log `transactionId` + `providerName` + `status` setiap event. Memudahkan debug saat ada selisih dengan provider.
6. **Reconciliation:** scheduled job harian yang ambil `GET /api/v1/payments?orderId=...` untuk semua order yang masih `pending` >24 jam → mark `expired`.
7. **Jangan tampilkan `paymentUrl` ke email** — bisa kadaluarsa. Tampilkan langsung di halaman setelah checkout.
8. **Network policy:** App internal Anda hanya perlu konek ke gateway. Tidak perlu konek langsung ke Midtrans/Xendit/dll.

---

## 8. Testing dari App Anda

Sebelum live, uji dari app Anda dengan kondisi:

| Skenario | Cara Trigger | Expected |
|----------|--------------|----------|
| Charge sukses | Request normal | Status 201, `status: pending`, `paymentUrl` ada |
| Provider primary down → fallback | Set `MIDTRANS_FORCE_DOWN=true` di gateway, atau toggle di Dashboard /settings | `providerName` = secondary, `attempts` ada 2 entry |
| Semua provider down | Set semua `*_FORCE_DOWN=true` | Status 503 `ALL_PROVIDERS_FAILED` |
| Double-click checkout | Kirim 2 request dengan `Idempotency-Key` sama | Response identik, hanya 1 charge tercatat |
| Status berubah ke success | Buka Dashboard → Transactions → klik transaksi → tombol "Mark as Success" | Polling app Anda dapat status `success` |
| Refund | Dashboard → tombol "Refund" pada transaksi success | Status berubah ke `refunded` |

---

## 9. Production Deployment Checklist

Sebelum go-live:

- [ ] Gateway di-deploy dengan `NODE_ENV=production`
- [ ] `ADMIN_API_KEY` diganti ke nilai random (32+ char, generate via `crypto.randomBytes`)
- [ ] Credentials provider sudah diisi (lewat `.env` yang di-inject secrets manager, **atau** lewat dashboard `/credentials`)
- [ ] HTTPS aktif (TLS termination di LB / reverse proxy)
- [ ] `TRUST_PROXY=true` jika di belakang LB
- [ ] `CORS_ORIGIN` di-set ke domain dashboard production (bukan `*`)
- [ ] Rate limit dinaikkan sesuai expected TPS
- [ ] Webhook URL provider sudah diarahkan ke `https://gateway.yourdomain.com/api/v1/webhooks/<provider>`
- [ ] Monitoring/alerting (Prometheus, Datadog, Sentry, dll) sudah pasang ke endpoint `/health/ready`
- [ ] Reconciliation job sudah berjalan
- [ ] App internal Anda sudah update `GATEWAY_URL` ke production host

---

## 10. Troubleshooting

| Gejala | Kemungkinan Penyebab | Cara Cek |
|--------|----------------------|----------|
| Selalu 401 dari gateway | Header `Idempotency-Key` lupa, atau bukan endpoint yang butuh admin key | Cek error code: `IDEMPOTENCY_KEY_REQUIRED` |
| Status selamanya `pending` | Webhook dari provider ke gateway gagal (auth/network/URL salah) | Cek log gateway, cek webhook history di sandbox provider |
| Amount mismatch error di webhook | Decimal/integer mismatch (50000 vs 50000.00) | Sudah di-handle gateway, cek `gross_amount` field |
| `ALL_PROVIDERS_FAILED` padahal hanya satu down | Salah konfigurasi di Dashboard /settings | Buka /settings, pastikan provider lain tidak force-down |
| Dashboard credentials tidak terbaca | Field di SQLite kosong, fallback ke env yang juga kosong | Buka /credentials, cek badge "Belum diset" |

---

## 11. File Contoh Lengkap

Lihat folder `examples/` di repo ini:
- `examples/nodejs-express/` — Express app + client wrapper, sudah runnable
- `examples/php/` — PHP vanilla + client wrapper
- `examples/python-fastapi/` — FastAPI + client wrapper

Setiap folder berisi `README.md` cara menjalankan.

---

## 12. Bantuan

- Bug / saran fitur: buka issue di repo ini
- Pertanyaan integrasi: cek section di README.md utama → "Mengganti mock dengan provider asli"
