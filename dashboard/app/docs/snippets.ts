/**
 * Code snippets untuk halaman docs.
 * Disimpan di string literals supaya bisa di-copy persis ke project user.
 */

export const NODEJS_CLIENT = `// PaymentGatewayClient.js — drop ke project Express/Fastify/Koa Anda.
// Pakai built-in fetch (Node 18+).

const crypto = require("crypto");

class PaymentGatewayError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = "PaymentGatewayError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

class PaymentGatewayClient {
  constructor({ baseUrl, timeoutMs = 10_000 }) {
    if (!baseUrl) throw new Error("baseUrl is required");
    this.baseUrl = baseUrl.replace(/\\/$/, "");
    this.timeoutMs = timeoutMs;
  }

  async charge(req, idempotencyKey) {
    const key = idempotencyKey || \`\${req.orderId}-\${crypto.randomUUID()}\`;
    return this._fetch("POST", "/api/v1/payments/charge", req, {
      "Idempotency-Key": key,
    });
  }

  async getById(transactionId) {
    return this._fetch("GET", \`/api/v1/payments/\${encodeURIComponent(transactionId)}\`);
  }

  async _fetch(method, path, body, extraHeaders = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(\`\${this.baseUrl}\${path}\`, {
        method,
        headers: { "Content-Type": "application/json", ...extraHeaders },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      if (!res.ok) {
        throw new PaymentGatewayError(
          res.status, data.error || "REQUEST_FAILED",
          data.message || res.statusText, data.details,
        );
      }
      return data.data;
    } finally {
      clearTimeout(timer);
    }
  }
}

module.exports = { PaymentGatewayClient, PaymentGatewayError };
`;

export const NODEJS_USAGE = `// Pakai di route handler Express
const express = require("express");
const { PaymentGatewayClient, PaymentGatewayError } = require("./PaymentGatewayClient");

const app = express();
app.use(express.json());

const gateway = new PaymentGatewayClient({
  baseUrl: process.env.GATEWAY_URL || "http://localhost:3000",
});

app.post("/checkout", async (req, res) => {
  try {
    const tx = await gateway.charge({
      orderId: \`ORD-\${Date.now()}\`,
      amount: 50000,
      currency: "IDR",
      method: "qris",
      customer: { name: req.body.name, email: req.body.email },
    });
    // tx.paymentUrl → redirect user ke sini
    res.json({
      transactionId: tx.id,
      paymentUrl: tx.paymentUrl,
      status: tx.status,
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

// Polling status
app.get("/orders/:txId/status", async (req, res) => {
  const tx = await gateway.getById(req.params.txId);
  res.json({ status: tx.status, paidAt: tx.updatedAt });
});

app.listen(4000);
`;

export const PHP_CLIENT = `<?php
// PaymentGatewayClient.php — drop ke project PHP / Laravel Anda.
// Pakai cURL built-in, tidak butuh dependency tambahan.

class PaymentGatewayException extends \\RuntimeException {
    public int $statusCode;
    public string $code;
    public function __construct(int $statusCode, string $code, string $message) {
        parent::__construct($message);
        $this->statusCode = $statusCode;
        $this->code = $code;
    }
}

class PaymentGatewayClient {
    public function __construct(
        private string $baseUrl,
        private int $timeoutSec = 10,
    ) {
        $this->baseUrl = rtrim($baseUrl, '/');
    }

    public function charge(array $req, ?string $idempotencyKey = null): array {
        $key = $idempotencyKey ?? ($req['orderId'] . '-' . self::uuid());
        return $this->request('POST', '/api/v1/payments/charge', $req, [
            'Idempotency-Key: ' . $key,
        ]);
    }

    public function getById(string $transactionId): array {
        return $this->request('GET', '/api/v1/payments/' . rawurlencode($transactionId));
    }

    private function request(string $method, string $path, ?array $body = null, array $extraHeaders = []): array {
        $ch = curl_init($this->baseUrl . $path);
        curl_setopt_array($ch, [
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_HTTPHEADER => array_merge(['Content-Type: application/json'], $extraHeaders),
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => $this->timeoutSec,
        ]);
        if ($body) curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));

        $raw = curl_exec($ch);
        $statusCode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        $data = json_decode($raw ?: '[]', true) ?: [];
        if ($statusCode < 200 || $statusCode >= 300) {
            throw new PaymentGatewayException(
                $statusCode,
                $data['error'] ?? 'REQUEST_FAILED',
                $data['message'] ?? "HTTP $statusCode",
            );
        }
        return $data['data'] ?? [];
    }

    private static function uuid(): string {
        $b = random_bytes(16);
        $b[6] = chr((ord($b[6]) & 0x0f) | 0x40);
        $b[8] = chr((ord($b[8]) & 0x3f) | 0x80);
        return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($b), 4));
    }
}
`;

export const PHP_USAGE = `<?php
// Laravel Controller
namespace App\\Http\\Controllers;

use App\\Services\\PaymentGatewayClient;
use App\\Services\\PaymentGatewayException;
use Illuminate\\Http\\Request;

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
                return response()->json(
                    ['message' => 'Pembayaran sedang tidak tersedia'],
                    503,
                );
            }
            return response()->json(
                ['error' => $e->code, 'message' => $e->getMessage()],
                $e->statusCode,
            );
        }
    }
}
`;

export const PYTHON_CLIENT = `# client.py — drop ke project FastAPI / Django / Flask Anda.
# Install: pip install httpx

import uuid
from typing import Any
import httpx

class PaymentGatewayError(Exception):
    def __init__(self, status_code: int, code: str, message: str):
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message

class PaymentGatewayClient:
    def __init__(self, base_url: str, timeout_sec: float = 10.0):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout_sec

    async def charge(self, *, order_id: str, amount: int, currency: str,
                     method: str, customer: dict, description: str | None = None,
                     idempotency_key: str | None = None) -> dict[str, Any]:
        body = {
            "orderId": order_id, "amount": amount, "currency": currency,
            "method": method, "customer": customer,
        }
        if description:
            body["description"] = description
        key = idempotency_key or f"{order_id}-{uuid.uuid4()}"
        return await self._request("POST", "/api/v1/payments/charge", body,
                                    extra_headers={"Idempotency-Key": key})

    async def get_by_id(self, transaction_id: str) -> dict[str, Any]:
        return await self._request("GET", f"/api/v1/payments/{transaction_id}")

    async def _request(self, method: str, path: str,
                       body: dict | None = None,
                       extra_headers: dict | None = None) -> dict[str, Any]:
        headers = {"Content-Type": "application/json", **(extra_headers or {})}
        async with httpx.AsyncClient(timeout=self.timeout) as c:
            res = await c.request(method, f"{self.base_url}{path}",
                                  json=body, headers=headers)
            try:
                data = res.json()
            except Exception:
                data = {}
            if not res.is_success:
                raise PaymentGatewayError(
                    res.status_code,
                    data.get("error", "REQUEST_FAILED"),
                    data.get("message", res.reason_phrase),
                )
            return data.get("data", {})
`;

export const PYTHON_USAGE = `# main.py — FastAPI
import time
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, EmailStr
from client import PaymentGatewayClient, PaymentGatewayError

app = FastAPI()
gateway = PaymentGatewayClient(base_url="http://localhost:3000")

class CheckoutRequest(BaseModel):
    customer_name: str
    customer_email: EmailStr
    amount: int

@app.post("/checkout", status_code=201)
async def checkout(req: CheckoutRequest):
    order_id = f"ORD-{int(time.time())}"

    try:
        tx = await gateway.charge(
            order_id=order_id,
            amount=req.amount,
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

@app.get("/orders/{tx_id}/status")
async def get_status(tx_id: str):
    tx = await gateway.get_by_id(tx_id)
    return {"status": tx["status"], "paidAt": tx["updatedAt"]}
`;

export const CURL_CHARGE = `curl -X POST http://localhost:3000/api/v1/payments/charge \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: order-001-attempt-1" \\
  -d '{
    "orderId": "ORDER-001",
    "amount": 50000,
    "currency": "IDR",
    "method": "qris",
    "customer": {
      "name": "Budi",
      "email": "budi@example.com"
    },
    "description": "Pembelian item A"
  }'`;

export const CURL_GET = `# By transaction ID (UUID dari response charge)
curl http://localhost:3000/api/v1/payments/<transactionId>

# By orderId
curl "http://localhost:3000/api/v1/payments?orderId=ORDER-001"`;

export const RESPONSE_201 = `{
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "orderId": "ORDER-001",
    "amount": 50000,
    "currency": "IDR",
    "method": "qris",
    "status": "pending",
    "providerName": "midtrans",
    "providerTransactionId": "MTRN-abc123",
    "paymentUrl": "https://app.sandbox.midtrans.com/snap/...",
    "attempts": [
      { "providerName": "midtrans", "success": true, "at": "2026-05-16T..." }
    ],
    "createdAt": "2026-05-16T07:00:00.000Z",
    "updatedAt": "2026-05-16T07:00:00.000Z"
  }
}`;

export const RESPONSE_503 = `{
  "error": "ALL_PROVIDERS_FAILED",
  "message": "All payment providers are unavailable",
  "details": {
    "attempts": [
      { "providerName": "midtrans", "success": false, "error": "unhealthy", "at": "..." },
      { "providerName": "xendit", "success": false, "error": "unhealthy", "at": "..." }
    ]
  }
}`;
