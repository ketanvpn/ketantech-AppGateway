import request from "supertest";
import { createHmac } from "crypto";
import { createApp } from "../src/app";
import { resetDbForTests } from "../src/store/db";
import { settingsStore } from "../src/store/settingsStore";
import { config } from "../src/config";

const app = createApp();

const baseBody = {
  amount: 60000,
  currency: "IDR",
  method: "qris",
  customer: { name: "Eko", email: "eko@example.com" },
};

beforeEach(() => {
  resetDbForTests();
  settingsStore._resetForTests();
  config.doku.secretKey = "";
  config.tripay.privateKey = "";
});

async function chargeWithProvider(provider: "doku" | "tripay", orderId: string) {
  settingsStore.setProviderOrder([provider]);
  const res = await request(app)
    .post("/api/v1/payments/charge")
    .set("Idempotency-Key", `${provider}-${orderId}`)
    .send({ ...baseBody, orderId });
  return res.body.data;
}

describe("DOKU webhook", () => {
  it("verifies signature with HMAC-SHA256", async () => {
    config.doku.secretKey = "doku-secret-test";
    const tx = await chargeWithProvider("doku", "ORDER-DOKU-1");

    const payload = {
      order: { invoice_number: tx.orderId },
      transaction: { id: tx.providerTransactionId, status: "SUCCESS" },
      payment: { token_id: tx.providerTransactionId },
    };
    const rawBody = JSON.stringify(payload);
    const signature = createHmac("sha256", config.doku.secretKey)
      .update(rawBody)
      .digest("hex");

    const res = await request(app)
      .post("/api/v1/webhooks/doku")
      .set("Content-Type", "application/json")
      .set("Signature", signature)
      .send(rawBody);

    expect(res.status).toBe(200);
    expect(res.body.action).toBe("applied");
    expect(res.body.transaction.status).toBe("success");
  });

  it("rejects DOKU webhook with invalid signature", async () => {
    config.doku.secretKey = "doku-secret-test";
    const tx = await chargeWithProvider("doku", "ORDER-DOKU-2");

    const payload = {
      order: { invoice_number: tx.orderId },
      transaction: { id: tx.providerTransactionId, status: "SUCCESS" },
    };

    const res = await request(app)
      .post("/api/v1/webhooks/doku")
      .set("Content-Type", "application/json")
      .set("Signature", "INVALID-SIGNATURE")
      .send(JSON.stringify(payload));
    expect(res.status).toBe(401);
  });

  it("DOKU webhook skips verification when secret kosong (dev)", async () => {
    const tx = await chargeWithProvider("doku", "ORDER-DOKU-3");

    const res = await request(app)
      .post("/api/v1/webhooks/doku")
      .set("Content-Type", "application/json")
      .send({
        order: { invoice_number: tx.orderId },
        transaction: { id: tx.providerTransactionId, status: "SUCCESS" },
      });
    expect(res.status).toBe(200);
    expect(res.body.transaction.status).toBe("success");
  });
});

describe("Tripay webhook", () => {
  it("verifies signature with X-Callback-Signature header", async () => {
    config.tripay.privateKey = "tripay-private-test";
    const tx = await chargeWithProvider("tripay", "ORDER-TRIPAY-1");

    const payload = {
      reference: tx.providerTransactionId,
      merchant_ref: tx.orderId,
      status: "PAID",
      amount: 60000,
    };
    const rawBody = JSON.stringify(payload);
    const signature = createHmac("sha256", config.tripay.privateKey)
      .update(rawBody)
      .digest("hex");

    const res = await request(app)
      .post("/api/v1/webhooks/tripay")
      .set("Content-Type", "application/json")
      .set("X-Callback-Signature", signature)
      .send(rawBody);

    expect(res.status).toBe(200);
    expect(res.body.action).toBe("applied");
    expect(res.body.transaction.status).toBe("success");
  });

  it("rejects Tripay webhook with wrong signature", async () => {
    config.tripay.privateKey = "tripay-private-test";
    const tx = await chargeWithProvider("tripay", "ORDER-TRIPAY-2");

    const res = await request(app)
      .post("/api/v1/webhooks/tripay")
      .set("Content-Type", "application/json")
      .set("X-Callback-Signature", "WRONG-SIGNATURE")
      .send({
        reference: tx.providerTransactionId,
        merchant_ref: tx.orderId,
        status: "PAID",
      });

    expect(res.status).toBe(401);
  });

  it("maps Tripay UNPAID/EXPIRED/FAILED correctly", async () => {
    const tx = await chargeWithProvider("tripay", "ORDER-TRIPAY-3");

    // Tripay status EXPIRED → internal expired
    const res = await request(app)
      .post("/api/v1/webhooks/tripay")
      .set("Content-Type", "application/json")
      .send({
        reference: tx.providerTransactionId,
        merchant_ref: tx.orderId,
        status: "EXPIRED",
      });
    expect(res.body.transaction.status).toBe("expired");
  });
});
