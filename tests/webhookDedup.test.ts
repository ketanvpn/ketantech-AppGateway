import request from "supertest";
import { createHash } from "crypto";
import { createApp } from "../src/app";
import { resetDbForTests } from "../src/store/db";
import { settingsStore } from "../src/store/settingsStore";
import { config } from "../src/config";

const app = createApp();

const validBody = {
  orderId: "ORDER-DEDUP-001",
  amount: 50000,
  currency: "IDR",
  method: "qris",
  customer: { name: "Andi", email: "andi@example.com" },
};

beforeEach(() => {
  resetDbForTests();
  settingsStore._resetForTests();
  config.midtrans.serverKey = "";
});

async function chargeOnce(idempotencyKey: string) {
  const res = await request(app)
    .post("/api/v1/payments/charge")
    .set("Idempotency-Key", idempotencyKey)
    .send(validBody);
  return res.body.data;
}

function midtransSignature(
  orderId: string,
  statusCode: string,
  grossAmount: string,
  serverKey: string,
) {
  return createHash("sha512")
    .update(orderId + statusCode + grossAmount + serverKey)
    .digest("hex");
}

describe("Strict webhook deduplication via payload hash", () => {
  it("dedups webhook with byte-identical payload (skips re-processing)", async () => {
    config.midtrans.serverKey = "test-key";
    const tx = await chargeOnce("dedup-1");

    const grossAmount = "50000.00";
    const statusCode = "200";
    const payload = {
      order_id: tx.orderId,
      transaction_id: tx.providerTransactionId,
      gross_amount: grossAmount,
      status_code: statusCode,
      transaction_status: "settlement",
      fraud_status: "accept",
      signature_key: midtransSignature(
        tx.orderId,
        statusCode,
        grossAmount,
        config.midtrans.serverKey,
      ),
    };

    // Kirim sekali — diproses (status berubah)
    const first = await request(app)
      .post("/api/v1/webhooks/midtrans")
      .set("Content-Type", "application/json")
      .send(payload);
    expect(first.body.action).toBe("applied");

    // Kirim ulang body persis sama — strict dedup harus skip
    const second = await request(app)
      .post("/api/v1/webhooks/midtrans")
      .set("Content-Type", "application/json")
      .send(payload);
    expect(second.status).toBe(200);
    expect(second.body.action).toBe("duplicate");
    expect(second.body.reason).toMatch(/sudah pernah diproses/i);
  });
});

describe("Webhook amount cross-check", () => {
  it("rejects webhook with amount yang berbeda dari transaksi", async () => {
    const tx = await chargeOnce("amount-mismatch");

    // gross_amount sengaja diubah jauh lebih besar — simulasi tampering
    const res = await request(app)
      .post("/api/v1/webhooks/midtrans")
      .set("Content-Type", "application/json")
      .send({
        order_id: tx.orderId,
        transaction_id: tx.providerTransactionId,
        gross_amount: "999000.00",
        status_code: "200",
        transaction_status: "settlement",
        fraud_status: "accept",
        signature_key: "irrelevant-in-dev",
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("AMOUNT_MISMATCH");
  });
});

describe("Health readiness endpoint", () => {
  it("GET /health/ready returns 200 when DB is up", async () => {
    const res = await request(app).get("/health/ready");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ready");
    expect(res.body.checks.database).toBe(true);
  });
});
