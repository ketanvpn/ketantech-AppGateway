# Examples — Cara Integrasi ke Aplikasi Anda

Tiga contoh runnable yang menunjukkan cara aplikasi internal Anda memanggil Payment Gateway. Pilih sesuai stack yang Anda pakai:

| Folder | Stack | Cara Run |
|--------|-------|----------|
| [`nodejs-express/`](./nodejs-express) | Node.js 18+ + Express | `npm install && npm start` |
| [`php/`](./php) | PHP 8+ (vanilla, mudah port ke Laravel) | `php -S localhost:4001 server.php` |
| [`python-fastapi/`](./python-fastapi) | Python 3.10+ + FastAPI | `pip install -r requirements.txt && uvicorn main:app --port 4002` |

## Prasyarat

Sebelum jalankan contoh, **gateway harus sudah jalan** di `http://localhost:3000`:

```bash
# Di root project
npm run dev
```

Setiap contoh app akan jalan di port berbeda supaya bisa berdampingan:
- Node: `http://localhost:4000`
- PHP:  `http://localhost:4001`
- Python: `http://localhost:4002`
- Gateway: `http://localhost:3000`
- Dashboard: `http://localhost:3001` (opsional)

## Pola yang Dipakai (sama di ketiga bahasa)

1. **Client wrapper** — kelas yang membungkus call HTTP ke gateway, generate idempotency key otomatis, handle retry pada 5xx.
2. **Endpoint checkout** — terima order dari user → call `gateway.charge()` → return payment URL.
3. **Polling status** — endpoint untuk cek status terkini (gateway adalah source of truth).
4. **Idempotency key** — selalu generate UUID baru per request (atau pakai order ID + timestamp). Saat client retry, gateway tidak akan double-charge.

## Best Practice yang Diterapkan

- **Timeout** ke gateway (10 detik) — jangan biarkan request menggantung
- **Retry hanya pada 5xx & network error** — jangan retry pada 400 (bad request) atau 401 (auth)
- **Logging** request/response untuk debugging
- **Error handling terpisah** untuk error gateway vs error business logic

## Alur Test

1. Pastikan gateway jalan: `curl http://localhost:3000/health` → `{"status":"ok"}`
2. Jalankan salah satu example (misal Node)
3. Coba checkout: `curl -X POST http://localhost:4000/checkout -H "Content-Type: application/json" -d '{"productId":"P001","amount":50000}'`
4. Lihat response — ada `paymentUrl` & `transactionId`
5. Cek status: `curl http://localhost:4000/orders/<transactionId>`
6. Buka dashboard di `http://localhost:3001` untuk lihat transaksi yang baru masuk
