"use strict";

/**
 * Sample Express app — simulasi e-commerce sederhana yang call gateway untuk charge.
 *
 * Endpoint:
 *   POST /checkout         → buat order & charge ke gateway
 *   GET  /orders/:txId     → lihat status order via gateway
 */

const express = require("express");
const { PaymentGatewayClient, PaymentGatewayError } = require("./client");

const app = express();
app.use(express.json());

const gateway = new PaymentGatewayClient({
  baseUrl: process.env.GATEWAY_URL || "http://localhost:3000",
});

// In-memory order store (untuk demo). Di produksi pakai DB.
const orders = new Map();

const PRODUCTS = {
  P001: { name: "Kopi Susu Premium", price: 25000 },
  P002: { name: "Roti Bakar", price: 15000 },
  P003: { name: "Paket Hemat", price: 50000 },
};

app.get("/", (_req, res) => {
  res.json({
    message: "Sample Node.js Express app integrated with Payment Gateway",
    endpoints: {
      "POST /checkout": "buat order baru",
      "GET /orders/:txId": "cek status order",
      "GET /products": "list produk",
    },
  });
});

app.get("/products", (_req, res) => {
  res.json({ data: PRODUCTS });
});

/**
 * Body: { productId: "P001", customerName: "Budi", customerEmail: "budi@example.com" }
 */
app.post("/checkout", async (req, res) => {
  const { productId, customerName, customerEmail } = req.body || {};
  const product = PRODUCTS[productId];
  if (!product) {
    return res.status(400).json({ error: "Product not found" });
  }
  if (!customerName || !customerEmail) {
    return res
      .status(400)
      .json({ error: "customerName and customerEmail required" });
  }

  const orderId = `ORD-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

  try {
    const tx = await gateway.charge({
      orderId,
      amount: product.price,
      currency: "IDR",
      method: "qris",
      customer: { name: customerName, email: customerEmail },
      description: `Pembelian ${product.name}`,
    });

    orders.set(tx.id, {
      orderId,
      productId,
      product,
      customer: { name: customerName, email: customerEmail },
      gatewayTxId: tx.id,
      createdAt: new Date().toISOString(),
    });

    res.status(201).json({
      orderId,
      transactionId: tx.id,
      amount: tx.amount,
      status: tx.status,
      paymentUrl: tx.paymentUrl,
      providerUsed: tx.providerName,
    });
  } catch (err) {
    if (err instanceof PaymentGatewayError) {
      console.error("[gateway error]", err.code, err.message);
      // Map ke error code business
      if (err.code === "ALL_PROVIDERS_FAILED") {
        return res.status(503).json({
          error: "PAYMENT_UNAVAILABLE",
          message:
            "Sistem pembayaran sedang tidak tersedia. Silakan coba lagi nanti.",
        });
      }
      return res.status(err.status).json({
        error: err.code,
        message: err.message,
      });
    }
    console.error("[unexpected]", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: String(err) });
  }
});

/** Polling status. Source of truth = gateway. */
app.get("/orders/:txId", async (req, res) => {
  const local = orders.get(req.params.txId);
  if (!local) return res.status(404).json({ error: "Order not found" });

  try {
    const tx = await gateway.getById(req.params.txId);
    res.json({
      order: local,
      payment: {
        status: tx.status,
        provider: tx.providerName,
        attempts: tx.attempts,
        updatedAt: tx.updatedAt,
      },
    });
  } catch (err) {
    res.status(502).json({
      error: "GATEWAY_UNAVAILABLE",
      message: "Tidak bisa cek status saat ini",
    });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Sample app running on http://localhost:${PORT}`);
  console.log(`Gateway URL: ${gateway.baseUrl}`);
});
