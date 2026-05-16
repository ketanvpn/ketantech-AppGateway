import request from "supertest";
import { createApp } from "../src/app";
import { transactionStore } from "../src/store/transactionStore";
import { idempotencyStore } from "../src/store/idempotencyStore";
import { settingsStore } from "../src/store/settingsStore";

const app = createApp();

const validBody = {
  orderId: "ORDER-001",
  amount: 50000,
  currency: "IDR",
  method: "qris",
  customer: { name: "Budi", email: "budi@example.com" },
};

beforeEach(() => {
  transactionStore.clear();
  idempotencyStore.clear();
  settingsStore.setMidtransForceDown(false);
  settingsStore.setXenditForceDown(false);
  settingsStore.setProviderOrder(["midtrans", "xendit"]);
});

describe("Health endpoints", () => {
  it("GET /health returns ok", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });

  it("GET /health/providers reports provider statuses", async () => {
    const res = await request(app).get("/health/providers");
    expect(res.status).toBe(200);
    expect(res.body.providers).toHaveLength(2);
    expect(res.body.providers.every((p: any) => p.healthy)).toBe(true);
  });

  it("returns 503 when all providers down", async () => {
    settingsStore.setMidtransForceDown(true);
    settingsStore.setXenditForceDown(true);
    const res = await request(app).get("/health/providers");
    expect(res.status).toBe(503);
    expect(res.body.status).toBe("all_down");
  });
});

describe("POST /api/v1/payments/charge", () => {
  it("rejects request without Idempotency-Key", async () => {
    const res = await request(app)
      .post("/api/v1/payments/charge")
      .send(validBody);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("IDEMPOTENCY_KEY_REQUIRED");
  });

  it("rejects invalid body", async () => {
    const res = await request(app)
      .post("/api/v1/payments/charge")
      .set("Idempotency-Key", "key-1")
      .send({ ...validBody, amount: -1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("VALIDATION_ERROR");
  });

  it("charges successfully via primary provider", async () => {
    const res = await request(app)
      .post("/api/v1/payments/charge")
      .set("Idempotency-Key", "key-success")
      .send(validBody);

    expect(res.status).toBe(201);
    expect(res.body.data.providerName).toBe("midtrans");
    expect(res.body.data.status).toBe("pending");
    expect(res.body.data.attempts).toHaveLength(1);
    expect(res.body.data.attempts[0].success).toBe(true);
  });

  it("falls back to secondary provider when primary is down", async () => {
    settingsStore.setMidtransForceDown(true);

    const res = await request(app)
      .post("/api/v1/payments/charge")
      .set("Idempotency-Key", "key-fallback")
      .send(validBody);

    expect(res.status).toBe(201);
    expect(res.body.data.providerName).toBe("xendit");
    expect(res.body.data.attempts.length).toBeGreaterThanOrEqual(2);
    // Attempt pertama harus midtrans yang gagal
    expect(res.body.data.attempts[0].providerName).toBe("midtrans");
    expect(res.body.data.attempts[0].success).toBe(false);
  });

  it("returns 503 when ALL providers are down", async () => {
    settingsStore.setMidtransForceDown(true);
    settingsStore.setXenditForceDown(true);

    const res = await request(app)
      .post("/api/v1/payments/charge")
      .set("Idempotency-Key", "key-all-down")
      .send(validBody);

    expect(res.status).toBe(503);
    expect(res.body.error).toBe("ALL_PROVIDERS_FAILED");
  });

  it("returns same response for duplicate Idempotency-Key (no double charge)", async () => {
    const key = "key-idem";
    const first = await request(app)
      .post("/api/v1/payments/charge")
      .set("Idempotency-Key", key)
      .send(validBody);

    const second = await request(app)
      .post("/api/v1/payments/charge")
      .set("Idempotency-Key", key)
      .send(validBody);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.data.id).toBe(first.body.data.id);
    expect(second.body.data.providerTransactionId).toBe(
      first.body.data.providerTransactionId,
    );

    // Pastikan hanya 1 transaksi tersimpan
    expect(transactionStore.list()).toHaveLength(1);
  });
});

describe("GET /api/v1/payments", () => {
  it("retrieves transaction by id", async () => {
    const charge = await request(app)
      .post("/api/v1/payments/charge")
      .set("Idempotency-Key", "key-get-1")
      .send(validBody);

    const id = charge.body.data.id;
    const res = await request(app).get(`/api/v1/payments/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(id);
  });

  it("retrieves transaction by orderId", async () => {
    await request(app)
      .post("/api/v1/payments/charge")
      .set("Idempotency-Key", "key-get-2")
      .send(validBody);

    const res = await request(app)
      .get("/api/v1/payments")
      .query({ orderId: validBody.orderId });
    expect(res.status).toBe(200);
    expect(res.body.data.orderId).toBe(validBody.orderId);
  });

  it("returns 404 for unknown id", async () => {
    const res = await request(app).get("/api/v1/payments/unknown-id");
    expect(res.status).toBe(404);
  });
});
