# PHP Integration Example

Contoh aplikasi PHP murni (vanilla, tanpa framework) yang call ke Payment Gateway. Mudah di-port ke Laravel — lihat section Laravel di bawah.

## Prasyarat

- PHP 8.0+
- Extension: `curl`, `json` (sudah default di sebagian besar instalasi)
- **Gateway** harus jalan di `http://localhost:3000`

## Jalankan

```bash
cd examples/php
php -S localhost:4001 server.php
```

App jalan di `http://localhost:4001`.

## Test Flow

```bash
# Checkout
curl -X POST http://localhost:4001/checkout ^
  -H "Content-Type: application/json" ^
  -d "{\"productId\":\"P001\",\"customerName\":\"Sari\",\"customerEmail\":\"sari@example.com\"}"

# Cek status (ganti <transactionId> dengan id dari response checkout)
curl http://localhost:4001/orders/<transactionId>
```

Lihat di dashboard `http://localhost:3001/transactions` — transaksi dari PHP app ini akan muncul.

## File Penting

- **`PaymentGatewayClient.php`** — class wrapper. Drop-in ke project PHP/Laravel Anda.
- **`server.php`** — sample app (router sederhana). Untuk Laravel/Symfony, pindahkan logic-nya ke Controller.

## Cara Pakai di Laravel

### 1. Copy `PaymentGatewayClient.php` ke `app/Services/`

```bash
cp PaymentGatewayClient.php /path/to/laravel/app/Services/
```

Tambahkan namespace di atas file:
```php
namespace App\Services;
```

### 2. Tambahkan ke `.env`

```
GATEWAY_URL=http://localhost:3000
```

### 3. Register di `app/Providers/AppServiceProvider.php`

```php
use App\Services\PaymentGatewayClient;

public function register(): void
{
    $this->app->singleton(PaymentGatewayClient::class, function () {
        return new PaymentGatewayClient(config('services.gateway.url'));
    });
}
```

### 4. Tambahkan ke `config/services.php`

```php
'gateway' => [
    'url' => env('GATEWAY_URL', 'http://localhost:3000'),
],
```

### 5. Pakai di Controller

```php
use App\Services\PaymentGatewayClient;
use App\Services\PaymentGatewayException;

class CheckoutController extends Controller
{
    public function __construct(private PaymentGatewayClient $gateway) {}

    public function store(Request $request)
    {
        $validated = $request->validate([
            'product_id' => 'required|string',
            'customer_name' => 'required|string',
            'customer_email' => 'required|email',
        ]);

        $product = Product::findOrFail($validated['product_id']);
        $orderId = 'ORD-' . now()->timestamp . '-' . Str::upper(Str::random(4));

        try {
            $tx = $this->gateway->charge([
                'orderId' => $orderId,
                'amount' => $product->price,
                'currency' => 'IDR',
                'method' => 'qris',
                'customer' => [
                    'name' => $validated['customer_name'],
                    'email' => $validated['customer_email'],
                ],
                'description' => "Pembelian {$product->name}",
            ]);

            Order::create([
                'order_id' => $orderId,
                'product_id' => $product->id,
                'gateway_tx_id' => $tx['id'],
                'amount' => $tx['amount'],
                'status' => $tx['status'],
            ]);

            return response()->json([
                'order_id' => $orderId,
                'payment_url' => $tx['paymentUrl'],
            ], 201);
        } catch (PaymentGatewayException $e) {
            if ($e->code === 'ALL_PROVIDERS_FAILED') {
                return response()->json(['error' => 'Pembayaran tidak tersedia'], 503);
            }
            throw $e;
        }
    }
}
```

## Yang Penting di Code

- **Idempotency key** auto-generate per request (bisa override dengan `charge($req, $key)`).
- **Retry** 3x pada 5xx & network error, exponential backoff dengan jitter.
- **Timeout** 10 detik.
- **Error mapping** — code error gateway dikonversi ke message yang user-friendly.
- Tidak butuh Composer dependency — hanya pakai cURL & json built-in PHP.
