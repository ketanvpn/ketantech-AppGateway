# Python + FastAPI Integration Example

Contoh aplikasi FastAPI (async) yang call ke Payment Gateway.

## Prasyarat

- Python 3.10+
- pip
- **Gateway** harus jalan di `http://localhost:3000`

## Setup

```bash
cd examples/python-fastapi
python -m venv .venv

# Windows
.venv\Scripts\activate
# Linux/Mac
source .venv/bin/activate

pip install -r requirements.txt
```

## Jalankan

```bash
uvicorn main:app --port 4002 --reload
```

App jalan di `http://localhost:4002`. Buka http://localhost:4002/docs untuk Swagger UI interaktif.

## Test Flow

```bash
# Checkout
curl -X POST http://localhost:4002/checkout ^
  -H "Content-Type: application/json" ^
  -d "{\"productId\":\"P001\",\"customerName\":\"Andi\",\"customerEmail\":\"andi@example.com\"}"

# Cek status (ganti <transactionId> dengan id dari response checkout)
curl http://localhost:4002/orders/<transactionId>
```

## File Penting

- **`client.py`** — class wrapper `PaymentGatewayClient` (async). Drop-in ke project FastAPI/Starlette Anda.
- **`main.py`** — sample app dengan endpoint `/checkout` & `/orders/{id}`.

## Cara Pakai di Django (Sync)

`httpx` mendukung sync client juga. Buat versi sync `client.py`:

```python
import httpx, uuid, time, random

class PaymentGatewaySyncClient:
    def __init__(self, base_url, timeout=10):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def charge(self, *, order_id, amount, currency, method, customer, description=None):
        body = {
            "orderId": order_id, "amount": amount, "currency": currency,
            "method": method, "customer": customer,
        }
        if description:
            body["description"] = description
        key = f"{order_id}-{uuid.uuid4()}"
        for attempt in range(3):
            try:
                with httpx.Client(timeout=self.timeout) as c:
                    res = c.post(
                        f"{self.base_url}/api/v1/payments/charge",
                        json=body,
                        headers={"Idempotency-Key": key},
                    )
                if res.status_code < 300:
                    return res.json()["data"]
                if res.status_code < 500 or attempt == 2:
                    res.raise_for_status()
            except httpx.HTTPError:
                if attempt == 2:
                    raise
            time.sleep(0.2 * (2**attempt) + random.uniform(0, 0.1))
```

Pakai di Django view:

```python
from django.http import JsonResponse
from .gateway import PaymentGatewaySyncClient

gateway = PaymentGatewaySyncClient(settings.GATEWAY_URL)

def checkout(request):
    # ... validasi ...
    tx = gateway.charge(
        order_id=order_id,
        amount=product.price,
        currency="IDR",
        method="qris",
        customer={"name": name, "email": email},
    )
    return JsonResponse({"transactionId": tx["id"], "paymentUrl": tx.get("paymentUrl")})
```

## Yang Penting di Code

- **Async client** — pakai `httpx.AsyncClient`, cocok untuk FastAPI yang async by default.
- **Idempotency key** auto-generated.
- **Retry exponential backoff** dengan jitter, hanya pada 5xx & network error.
- **Timeout** 10 detik.
- **Type-safe** dengan dataclass `PaymentGatewayError` yang bisa dimatch di `try/except`.
