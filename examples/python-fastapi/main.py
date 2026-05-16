"""
Sample FastAPI app yang call ke Payment Gateway.

Jalankan:
    pip install -r requirements.txt
    uvicorn main:app --port 4002 --reload
"""
from __future__ import annotations

import logging
import os
import secrets
import time
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, EmailStr

from client import PaymentGatewayClient, PaymentGatewayError

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("example-fastapi")

GATEWAY_URL = os.getenv("GATEWAY_URL", "http://localhost:3000")
gateway = PaymentGatewayClient(base_url=GATEWAY_URL)

app = FastAPI(title="Sample Python app integrated with Payment Gateway")

# In-memory order store (untuk demo). Di produksi pakai DB.
orders: dict[str, dict[str, Any]] = {}

PRODUCTS = {
    "P001": {"name": "Kopi Susu Premium", "price": 25000},
    "P002": {"name": "Roti Bakar", "price": 15000},
    "P003": {"name": "Paket Hemat", "price": 50000},
}


class CheckoutRequest(BaseModel):
    productId: str
    customerName: str
    customerEmail: EmailStr


@app.get("/")
async def root() -> dict[str, Any]:
    return {
        "message": "Sample Python app integrated with Payment Gateway",
        "endpoints": {
            "POST /checkout": "buat order baru",
            "GET /orders/{txId}": "cek status order",
            "GET /products": "list produk",
        },
    }


@app.get("/products")
async def products() -> dict[str, Any]:
    return {"data": PRODUCTS}


@app.post("/checkout", status_code=201)
async def checkout(req: CheckoutRequest) -> dict[str, Any]:
    product = PRODUCTS.get(req.productId)
    if not product:
        raise HTTPException(400, "Product not found")

    order_id = f"ORD-{int(time.time())}-{secrets.token_hex(2).upper()}"

    try:
        tx = await gateway.charge(
            order_id=order_id,
            amount=product["price"],
            currency="IDR",
            method="qris",
            customer={"name": req.customerName, "email": req.customerEmail},
            description=f"Pembelian {product['name']}",
        )
    except PaymentGatewayError as e:
        log.error("[gateway error] %s: %s", e.code, e.message)
        if e.code == "ALL_PROVIDERS_FAILED":
            raise HTTPException(
                503,
                {
                    "error": "PAYMENT_UNAVAILABLE",
                    "message": "Sistem pembayaran sedang tidak tersedia. Silakan coba lagi nanti.",
                },
            )
        raise HTTPException(e.status_code, {"error": e.code, "message": e.message})

    orders[tx["id"]] = {
        "orderId": order_id,
        "productId": req.productId,
        "product": product,
        "customer": {"name": req.customerName, "email": req.customerEmail},
        "gatewayTxId": tx["id"],
        "createdAt": time.time(),
    }

    return {
        "orderId": order_id,
        "transactionId": tx["id"],
        "amount": tx["amount"],
        "status": tx["status"],
        "paymentUrl": tx.get("paymentUrl"),
        "providerUsed": tx["providerName"],
    }


@app.get("/orders/{tx_id}")
async def get_order(tx_id: str) -> dict[str, Any]:
    local = orders.get(tx_id)
    if not local:
        raise HTTPException(404, "Order not found")

    try:
        tx = await gateway.get_by_id(tx_id)
    except Exception as e:
        log.error("[gateway error] %s", e)
        raise HTTPException(
            502,
            {"error": "GATEWAY_UNAVAILABLE", "message": "Tidak bisa cek status saat ini"},
        )

    return {
        "order": local,
        "payment": {
            "status": tx["status"],
            "provider": tx["providerName"],
            "attempts": tx.get("attempts", []),
            "updatedAt": tx["updatedAt"],
        },
    }
