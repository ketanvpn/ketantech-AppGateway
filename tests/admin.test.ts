import request from "supertest";
import { createApp } from "../src/app";
import { resetDbForTests } from "../src/store/db";
import { settingsStore } from "../src/store/settingsStore";
import { config } from "../src/config";

const app = createApp();
const ADMIN_KEY = config.adminApiKey;

const validBody = {
  orderId: "ORDER-ADMIN-001",
  amount: 25000,
  currency: "IDR",
  method: "qris",
  customer: { name: "Tini", email: "tini@example.com" },
};

beforeEach(() => {
  resetDbForTests();
  settingsStore._resetForTests();
});

async function charge(orderId: string) {
  const res = await request(app)
    .post("/api/v1/payments/charge")
    .set("Idempotency-Key", `key-${orderId}`)
    .send({ ...validBody, orderId });
  return res.body.data;
}

describe("Admin auth", () => {
  it("rejects requests without X-Admin-Key", async () => {
    const res = await request(app).get("/api/v1/admin/stats");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("UNAUTHORIZED");
  });

  it("rejects requests with wrong key", async () => {
    const res = await request(app)
      .get("/api/v1/admin/stats")
      .set("X-Admin-Key", "wrong-key");
    expect(res.status).toBe(401);
  });

  it("accepts requests with correct key", async () => {
    const res = await request(app)
      .get("/api/v1/admin/stats")
      .set("X-Admin-Key", ADMIN_KEY);
    expect(res.status).toBe(200);
  });
});

describe("GET /api/v1/admin/stats", () => {
  it("returns zero counts when no transactions", async () => {
    const res = await request(app)
      .get("/api/v1/admin/stats")
      .set("X-Admin-Key", ADMIN_KEY);
    expect(res.status).toBe(200);
    expect(res.body.data.totalTransactions).toBe(0);
    expect(res.body.data.successRate).toBe(0);
  });

  it("aggregates stats correctly", async () => {
    const tx1 = await charge("ORD-001");
    const tx2 = await charge("ORD-002");
    // Simulate one success
    await request(app)
      .post(`/api/v1/admin/transactions/${tx1.id}/simulate-status`)
      .set("X-Admin-Key", ADMIN_KEY)
      .send({ status: "success" });

    const res = await request(app)
      .get("/api/v1/admin/stats")
      .set("X-Admin-Key", ADMIN_KEY);
    expect(res.body.data.totalTransactions).toBe(2);
    expect(res.body.data.byStatus.success).toBe(1);
    expect(res.body.data.byStatus.pending).toBe(1);
    expect(res.body.data.totalAmountSuccess).toBe(25000);
    expect(res.body.data.successRate).toBe(50);
    void tx2;
  });
});

describe("GET /api/v1/admin/transactions (with pagination & filter)", () => {
  beforeEach(async () => {
    for (let i = 1; i <= 5; i++) {
      await charge(`ORD-${i.toString().padStart(3, "0")}`);
    }
  });

  it("paginates results", async () => {
    const res = await request(app)
      .get("/api/v1/admin/transactions?page=1&pageSize=2")
      .set("X-Admin-Key", ADMIN_KEY);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.pagination).toMatchObject({
      page: 1,
      pageSize: 2,
      total: 5,
      totalPages: 3,
    });
  });

  it("filters by orderId substring", async () => {
    const res = await request(app)
      .get("/api/v1/admin/transactions?orderId=003")
      .set("X-Admin-Key", ADMIN_KEY);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].orderId).toBe("ORD-003");
  });

  it("filters by status", async () => {
    const res = await request(app)
      .get("/api/v1/admin/transactions?status=pending")
      .set("X-Admin-Key", ADMIN_KEY);
    expect(res.body.data.length).toBe(5);
  });
});

describe("Admin settings", () => {
  it("GET /admin/settings returns current settings", async () => {
    const res = await request(app)
      .get("/api/v1/admin/settings")
      .set("X-Admin-Key", ADMIN_KEY);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.providerOrder)).toBe(true);
    expect(res.body.data.forceDown).toMatchObject({
      midtrans: false,
      xendit: false,
      doku: false,
      tripay: false,
    });
  });

  it("PATCH /admin/settings updates provider order", async () => {
    const res = await request(app)
      .patch("/api/v1/admin/settings")
      .set("X-Admin-Key", ADMIN_KEY)
      .send({ providerOrder: ["xendit", "midtrans"] });
    expect(res.status).toBe(200);
    expect(res.body.data.providerOrder).toEqual(["xendit", "midtrans"]);
  });

  it("PATCH /admin/settings updates forceDown via map", async () => {
    const res = await request(app)
      .patch("/api/v1/admin/settings")
      .set("X-Admin-Key", ADMIN_KEY)
      .send({ forceDown: { midtrans: true, doku: true } });
    expect(res.body.data.forceDown.midtrans).toBe(true);
    expect(res.body.data.forceDown.doku).toBe(true);
    expect(res.body.data.forceDown.xendit).toBe(false);
  });

  it("PATCH rejects empty body", async () => {
    const res = await request(app)
      .patch("/api/v1/admin/settings")
      .set("X-Admin-Key", ADMIN_KEY)
      .send({});
    expect(res.status).toBe(400);
  });

  it("PATCH rejects unknown provider in providerOrder", async () => {
    const res = await request(app)
      .patch("/api/v1/admin/settings")
      .set("X-Admin-Key", ADMIN_KEY)
      .send({ providerOrder: ["unknownco"] });
    expect(res.status).toBe(400);
  });
});

describe("Settings persistence (SQLite)", () => {
  it("provider order changes persist across settingsStore reload", async () => {
    await request(app)
      .patch("/api/v1/admin/settings")
      .set("X-Admin-Key", ADMIN_KEY)
      .send({ providerOrder: ["tripay", "doku"] });

    // Simulasi restart: reset cached state, ensureInit() akan baca dari DB
    settingsStore._resetForTests();

    const res = await request(app)
      .get("/api/v1/admin/settings")
      .set("X-Admin-Key", ADMIN_KEY);
    expect(res.body.data.providerOrder).toEqual(["tripay", "doku"]);
  });
});
