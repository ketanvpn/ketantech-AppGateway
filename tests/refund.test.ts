import request from "supertest";
import { createApp } from "../src/app";
import { resetDbForTests } from "../src/store/db";
import { settingsStore } from "../src/store/settingsStore";

const app = createApp();
const ADMIN_KEY = "dev-admin-key-change-me";

const validBody = {
  orderId: "ORDER-REFUND-001",
  amount: 100000,
  currency: "IDR",
  method: "qris",
  customer: { name: "Joko", email: "joko@example.com" },
};

beforeEach(() => {
  resetDbForTests();
  settingsStore._resetForTests();
});

async function chargeOnce(idempotencyKey: string) {
  const res = await request(app)
    .post("/api/v1/payments/charge")
    .set("Idempotency-Key", idempotencyKey)
    .send(validBody);
  return res.body.data;
}

async function refund(txId: string, key = ADMIN_KEY) {
  return request(app)
    .post(`/api/v1/admin/transactions/${txId}/refund`)
    .set("X-Admin-Key", key)
    .send();
}

async function setStatus(txId: string, status: string) {
  return request(app)
    .post(`/api/v1/admin/transactions/${txId}/simulate-status`)
    .set("X-Admin-Key", ADMIN_KEY)
    .send({ status });
}

describe("POST /api/v1/admin/transactions/:id/refund", () => {
  it("rejects refund without admin key", async () => {
    const res = await request(app)
      .post("/api/v1/admin/transactions/some-id/refund")
      .send();
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("UNAUTHORIZED");
  });

  it("returns 404 for unknown transaction", async () => {
    const res = await refund("unknown-id");
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("TRANSACTION_NOT_FOUND");
  });

  it("rejects refund on pending transaction (not yet success)", async () => {
    const tx = await chargeOnce("refund-pending");
    expect(tx.status).toBe("pending");

    const res = await refund(tx.id);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("REFUND_NOT_ALLOWED");
  });

  it("refunds successful transaction", async () => {
    const tx = await chargeOnce("refund-ok");
    await setStatus(tx.id, "success");

    const res = await refund(tx.id);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("refunded");
  });

  it("is idempotent — refund twice returns same data", async () => {
    const tx = await chargeOnce("refund-idem");
    await setStatus(tx.id, "success");

    const first = await refund(tx.id);
    const second = await refund(tx.id);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.data.status).toBe("refunded");
    expect(second.body.data.id).toBe(first.body.data.id);
  });

  it("rejects refund on failed transaction", async () => {
    const tx = await chargeOnce("refund-failed");
    await setStatus(tx.id, "failed");

    const res = await refund(tx.id);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("REFUND_NOT_ALLOWED");
  });
});


