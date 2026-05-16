# Node.js + Express Integration Example

Contoh aplikasi Express yang call ke Payment Gateway.

## Setup

```bash
cd examples/nodejs-express
npm install
```

## Jalankan

Pastikan **gateway sudah jalan** di port 3000 (`npm run dev` di root project).

```bash
npm start
```

App jalan di `http://localhost:4000`.

## Test Flow

```bash
# 1. List produk
curl http://localhost:4000/products

# 2. Checkout
curl -X POST http://localhost:4000/checkout ^
  -H "Content-Type: application/json" ^
  -d "{\"productId\":\"P001\",\"customerName\":\"Budi\",\"customerEmail\":\"budi@example.com\"}"

# Response berisi transactionId & paymentUrl. Catat transactionId-nya.

# 3. Cek status
curl http://localhost:4000/orders/<transactionId>
```

Buka dashboard `http://localhost:3001/transactions` untuk lihat transaksi yang masuk dari aplikasi ini.

## Yang Penting di Code

- **`client.js`** — wrapper class `PaymentGatewayClient`. Drop-in ke project Express Anda. Tinggal `new PaymentGatewayClient({ baseUrl: ... })`.
- **Idempotency key** — auto-generate per request. Saat retry karena timeout, gateway tidak akan double-charge.
- **Retry** — 3x attempts dengan exponential backoff. Hanya retry pada 5xx & network error, **tidak** pada 4xx (validation error).
- **Timeout** — 10 detik per request, biar tidak menggantung.
- **Error mapping** — kode error gateway dimap ke kode business app (lihat handler `/checkout`).

## Untuk Production

- Ganti in-memory `orders` Map dengan database (PostgreSQL, MySQL).
- Pakai `process.env.GATEWAY_URL` untuk konfigurasi (sudah disiapkan).
- Tambahkan auth (JWT, session) untuk endpoint `/checkout`.
- Pakai logger structured (Pino/Winston) bukan `console.log`.
