import request from "supertest";
import { createHash } from "crypto";
import { createApp } from "../src/app";
import { transactionStore } from "../src/store/transactionStore";
import { idempotencyStore } from "../src/store/idempotencyStore";
import { settingsStore } from "../src/store/settingsStore";
import { config } from "../src/config";

const app = createApp();

const validBody = {
  orderId: "ORDER-WH-001",
  amount: 75000,
  currency: "IDR",
  method: "qris",
  customer: { name: "Sari", email: "sari@example.com" },
};

beforeEach(() => {
  transactionStore.clear();
  idempotencyStore.clear();
  settingsStore.setMidtransForceDown(false);
  settingsStore.setXenditForceDown(false);
  settingsStore.setProviderOrder(["midtrans", "xendit"]);
  config.midtrans.serverKey = "";
  config.xendit.callbackToken = "";
});

async function chargeOnce(idempotencyKey: string) {
  const res = await request(app)
    .post("/api/v1/payments/charge")
    .set("Idempotency-Key", idempotencyKey)
    .send(validBody);
  return res.body.data;
}

describe("POST /api/v1/webhooks/:provider — unknown provider", () => {
  it("returns 404 for unknown provider", async () => {
    const res = await request(app)
      .post("/api/v1/webhooks/unknownco")
      .set("Content-Type", "application/json")
      .send({ foo: "bar" });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("UNKNOWN_PROVIDER");
  });

  it("returns 400 for empty body", async () => {
    const res = await request(app)
      .post("/api/v1/webhooks/midtrans")
      .set("Content-Type", "application/json")
      .send();
    expect(res.status).toBe(400);
  });
});

describe("Midtrans webhook", () => {
  it("updates transaction to success on valid signature (settlement)", async () => {
    config.midtrans.serverKey = "test-server-key";
    const tx = await chargeOnce("wh-mtrn-1");
    expect(tx.status).toBe("pending");

    const orderId = tx.orderId;
    const grossAmount = "75000.00";
    const statusCode = "200";
    const signatureKey = createHash("sha512")
      .update(orderId + statusCode + grossAmount + config.midtrans.serverKey)
      .digest("hex");

    const payload = {
      order_id: orderId,
      transaction_id: tx.providerTransactionId,
      gross_amount: grossAmount,
      status_code: statusCode,
      transaction_status: "settlement",
      fraud_status: "accept",
      signature_key: signatureKey,
    };

    const res = await request(app)
      .post("/api/v1/webhooks/midtrans")
      .set("Content-Type", "application/json")
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body.action).toBe("applied");
    expect(res.body.transaction.status).toBe("success");

    const stored = transactionStore.findById(tx.id);
    expect(stored?.status).toBe("success");
  });

  it("rejects webhook with invalid signature", async () => {
    config.midtrans.serverKey = "test-server-key";
    const tx = await chargeOnce("wh-mtrn-2");

    const payload = {
      order_id: tx.orderId,
      transaction_id: tx.providerTransactionId,
      gross_amount: "75000.00",
      status_code: "200",
      transaction_status: "settlement",
      fraud_status: "accept",
      signature_key: "WRONG-SIGNATURE",
    };

    const res = await request(app)
      .post("/api/v1/webhooks/midtrans")
      .set("Content-Type", "application/json")
      .send(payload);

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("INVALID_SIGNATURE");

    // Status tidak boleh berubah
    const stored = transactionStore.findById(tx.id);
    expect(stored?.status).toBe("pending");
  });

  it("returns 404 when transaction not found", async () => {
    config.midtrans.serverKey = "test-server-key";
    const orderId = "GHOST-ORDER";
    const grossAmount = "10000.00";
    const statusCode = "200";
    const signatureKey = createHash("sha512")
      .update(orderId + statusCode + grossAmount + config.midtrans.serverKey)
      .digest("hex");

    const res = await request(app)
      .post("/api/v1/webhooks/midtrans")
      .set("Content-Type", "application/json")
      .send({
        order_id: orderId,
        transaction_id: "MTRN-ghost",
        gross_amount: grossAmount,
        status_code: statusCode,
        transaction_status: "settlement",
        fraud_status: "accept",
        signature_key: signatureKey,
      });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("TRANSACTION_NOT_FOUND");
  });

  it("is idempotent: same webhook twice → second is duplicate", async () => {
    config.midtrans.serverKey = "test-server-key";
    const tx = await chargeOnce("wh-mtrn-3");

    const grossAmount = "75000.00";
    const statusCode = "200";
    const signatureKey = createHash("sha512")
      .update(tx.orderId + statusCode + grossAmount + config.midtrans.serverKey)
      .digest("hex");

    const payload = {
      order_id: tx.orderId,
      transaction_id: tx.providerTransactionId,
      gross_amount: grossAmount,
      status_code: statusCode,
      transaction_status: "settlement",
      fraud_status: "accept",
      signature_key: signatureKey,
    };

    const first = await request(app)
      .post("/api/v1/webhooks/midtrans")
      .set("Content-Type", "application/json")
      .send(payload);
    const second = await request(app)
      .post("/api/v1/webhooks/midtrans")
      .set("Content-Type", "application/json")
      .send(payload);

    expect(first.body.action).toBe("applied");
    expect(second.body.action).toBe("duplicate");
  });

  it("ignores webhook to terminal status (e.g. pending after success)", async () => {
    config.midtrans.serverKey = "test-server-key";
    const tx = await chargeOnce("wh-mtrn-4");

    // Pertama: jadikan success
    const successPayload = {
      order_id: tx.orderId,
      transaction_id: tx.providerTransactionId,
      gross_amount: "75000.00",
      status_code: "200",
      transaction_status: "settlement",
      fraud_status: "accept",
      signature_key: createHash("sha512")
        .update(
          tx.orderId + "200" + "75000.00" + config.midtrans.serverKey,
        )
        .digest("hex"),
    };
    await request(app)
      .post("/api/v1/webhooks/midtrans")
      .set("Content-Type", "application/json")
      .send(successPayload);

    // Sekarang datang webhook "pending" yang nyangkut → harus diabaikan
    const lateStatusCode = "201";
    const latePayload = {
      order_id: tx.orderId,
      transaction_id: tx.providerTransactionId,
      gross_amount: "75000.00",
      status_code: lateStatusCode,
      transaction_status: "pending",
      fraud_status: "accept",
      signature_key: createHash("sha512")
        .update(
          tx.orderId + lateStatusCode + "75000.00" + config.midtrans.serverKey,
        )
        .digest("hex"),
    };
    const res = await request(app)
      .post("/api/v1/webhooks/midtrans")
      .set("Content-Type", "application/json")
      .send(latePayload);

    expect(res.status).toBe(200);
    expect(res.body.action).toBe("ignored");

    const stored = transactionStore.findById(tx.id);
    expect(stored?.status).toBe("success");
  });

  it("skips signature verification when serverKey is empty (dev mode)", async () => {
    // serverKey = "" by default
    const tx = await chargeOnce("wh-mtrn-5");

    const res = await request(app)
      .post("/api/v1/webhooks/midtrans")
      .set("Content-Type", "application/json")
      .send({
        order_id: tx.orderId,
        transaction_id: tx.providerTransactionId,
        gross_amount: "75000.00",
        status_code: "200",
        transaction_status: "settlement",
        fraud_status: "accept",
        signature_key: "doesnt-matter",
      });

    expect(res.status).toBe(200);
    expect(res.body.transaction.status).toBe("success");
  });
});

describe("Xendit webhook", () => {
  it("updates transaction to success on valid x-callback-token", async () => {
    config.xendit.callbackToken = "secret-token";
    settingsStore.setProviderOrder(["xendit"]);

    const tx = await chargeOnce("wh-xnd-1");
    expect(tx.providerName).toBe("xendit");

    const res = await request(app)
      .post("/api/v1/webhooks/xendit")
      .set("Content-Type", "application/json")
      .set("x-callback-token", "secret-token")
      .send({
        id: tx.providerTransactionId,
        external_id: tx.orderId,
        status: "PAID",
        amount: 75000,
      });

    expect(res.status).toBe(200);
    expect(res.body.transaction.status).toBe("success");
  });

  it("rejects webhook with wrong token", async () => {
    config.xendit.callbackToken = "secret-token";
    settingsStore.setProviderOrder(["xendit"]);

    const tx = await chargeOnce("wh-xnd-2");

    const res = await request(app)
      .post("/api/v1/webhooks/xendit")
      .set("Content-Type", "application/json")
      .set("x-callback-token", "wrong-token")
      .send({
        id: tx.providerTransactionId,
        external_id: tx.orderId,
        status: "PAID",
        amount: 75000,
      });

    expect(res.status).toBe(401);
  });

  it("rejects webhook with missing token header", async () => {
    config.xendit.callbackToken = "secret-token";
    settingsStore.setProviderOrder(["xendit"]);

    const tx = await chargeOnce("wh-xnd-3");

    const res = await request(app)
      .post("/api/v1/webhooks/xendit")
      .set("Content-Type", "application/json")
      .send({
        id: tx.providerTransactionId,
        external_id: tx.orderId,
        status: "PAID",
      });

    expect(res.status).toBe(401);
  });
});
