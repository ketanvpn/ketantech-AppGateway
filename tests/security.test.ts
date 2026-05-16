import request from "supertest";
import { createApp } from "../src/app";
import { resetDbForTests } from "../src/store/db";
import { settingsStore } from "../src/store/settingsStore";
import { auditLogStore } from "../src/store/auditLogStore";
import { config } from "../src/config";

const app = createApp();
const ADMIN_KEY = "dev-admin-key-change-me";

const validBody = {
  orderId: "ORDER-SEC-001",
  amount: 50000,
  currency: "IDR",
  method: "qris",
  customer: { name: "Doni", email: "doni@example.com" },
};

beforeEach(() => {
  resetDbForTests();
  settingsStore._resetForTests();
  // Reset clientApiKeys ke kosong (mode terbuka) di awal tiap test
  config.clientApiKeys.length = 0;
});

describe("Security: Idempotency body-hash check", () => {
  it("rejects retry dengan key sama tapi body berbeda (cegah replay/abuse)", async () => {
    const key = "test-mismatch";
    const r1 = await request(app)
      .post("/api/v1/payments/charge")
      .set("Idempotency-Key", key)
      .send({ ...validBody, amount: 50000 });
    expect(r1.status).toBe(201);

    // Body diubah amount-nya — harus 422
    const r2 = await request(app)
      .post("/api/v1/payments/charge")
      .set("Idempotency-Key", key)
      .send({ ...validBody, amount: 999000 });
    expect(r2.status).toBe(422);
    expect(r2.body.error).toBe("IDEMPOTENCY_KEY_MISMATCH");
  });

  it("accepts retry dengan key & body sama (idempotent)", async () => {
    const key = "test-idem";
    const r1 = await request(app)
      .post("/api/v1/payments/charge")
      .set("Idempotency-Key", key)
      .send(validBody);
    const r2 = await request(app)
      .post("/api/v1/payments/charge")
      .set("Idempotency-Key", key)
      .send(validBody);
    expect(r1.body.data.id).toBe(r2.body.data.id);
  });

  it("rejects Idempotency-Key yang terlalu panjang (>255 char)", async () => {
    const longKey = "x".repeat(300);
    const res = await request(app)
      .post("/api/v1/payments/charge")
      .set("Idempotency-Key", longKey)
      .send(validBody);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("IDEMPOTENCY_KEY_TOO_LONG");
  });
});

describe("Security: Client API key (X-Client-Key)", () => {
  it("default mode (CLIENT_API_KEYS kosong) — endpoint payments terbuka", async () => {
    const res = await request(app)
      .post("/api/v1/payments/charge")
      .set("Idempotency-Key", "open-1")
      .send(validBody);
    expect(res.status).toBe(201);
  });

  it("kalau CLIENT_API_KEYS di-set, request tanpa header ditolak", async () => {
    config.clientApiKeys.push("client-secret-1");
    const res = await request(app)
      .post("/api/v1/payments/charge")
      .set("Idempotency-Key", "blocked-1")
      .send(validBody);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("UNAUTHORIZED");
  });

  it("kalau key benar, request lewat", async () => {
    config.clientApiKeys.push("client-secret-2");
    const res = await request(app)
      .post("/api/v1/payments/charge")
      .set("Idempotency-Key", "ok-1")
      .set("X-Client-Key", "client-secret-2")
      .send(validBody);
    expect(res.status).toBe(201);
  });

  it("multi-tenant: app A & app B punya key beda, dua-duanya bisa charge", async () => {
    config.clientApiKeys.push("app-a-key", "app-b-key");
    const a = await request(app)
      .post("/api/v1/payments/charge")
      .set("Idempotency-Key", "app-a-1")
      .set("X-Client-Key", "app-a-key")
      .send({ ...validBody, orderId: "A-001" });
    const b = await request(app)
      .post("/api/v1/payments/charge")
      .set("Idempotency-Key", "app-b-1")
      .set("X-Client-Key", "app-b-key")
      .send({ ...validBody, orderId: "B-001" });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
  });

  it("GET /payments?orderId tanpa key juga ditolak kalau CLIENT_API_KEYS di-set", async () => {
    config.clientApiKeys.push("only-key");
    // Charge dulu pakai key yang valid
    await request(app)
      .post("/api/v1/payments/charge")
      .set("Idempotency-Key", "set-key")
      .set("X-Client-Key", "only-key")
      .send(validBody);

    // GET tanpa header → 401
    const res = await request(app)
      .get(`/api/v1/payments?orderId=${validBody.orderId}`);
    expect(res.status).toBe(401);
  });

  it("GET /payments tanpa orderId — return 400 (bukan list semua)", async () => {
    const res = await request(app).get("/api/v1/payments");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("BAD_REQUEST");
  });
});

describe("Security: Audit log untuk operasi sensitif", () => {
  it("refund tercatat di audit log dengan IP & details", async () => {
    // Charge & success
    const tx = (
      await request(app)
        .post("/api/v1/payments/charge")
        .set("Idempotency-Key", "audit-1")
        .send(validBody)
    ).body.data;
    await request(app)
      .post(`/api/v1/admin/transactions/${tx.id}/simulate-status`)
      .set("X-Admin-Key", ADMIN_KEY)
      .send({ status: "success" });

    await request(app)
      .post(`/api/v1/admin/transactions/${tx.id}/refund`)
      .set("X-Admin-Key", ADMIN_KEY);

    const refundLogs = auditLogStore.list({ action: "admin.refund" });
    expect(refundLogs.length).toBe(1);
    expect(refundLogs[0].targetId).toBe(tx.id);
    expect(refundLogs[0].details).toMatchObject({
      amount: 50000,
      orderId: validBody.orderId,
    });
  });

  it("settings update tercatat (before & after)", async () => {
    await request(app)
      .patch("/api/v1/admin/settings")
      .set("X-Admin-Key", ADMIN_KEY)
      .send({ providerOrder: ["xendit", "midtrans"] });

    const logs = auditLogStore.list({ action: "admin.settings.update" });
    expect(logs.length).toBe(1);
    expect((logs[0].details as any).after.providerOrder).toEqual([
      "xendit",
      "midtrans",
    ]);
  });

  it("credentials update tercatat TANPA value-nya (rahasia)", async () => {
    await request(app)
      .put("/api/v1/admin/credentials")
      .set("X-Admin-Key", ADMIN_KEY)
      .send({ provider: "midtrans", field: "serverKey", value: "rahasia-banget" });

    const logs = auditLogStore.list({ action: "admin.credentials.update" });
    expect(logs.length).toBe(1);
    expect(logs[0].targetId).toBe("midtrans.serverKey");
    // PASTIKAN value asli TIDAK ada di audit log
    expect(JSON.stringify(logs[0])).not.toContain("rahasia-banget");
  });

  it("GET /admin/audit return list", async () => {
    await request(app)
      .patch("/api/v1/admin/settings")
      .set("X-Admin-Key", ADMIN_KEY)
      .send({ forceDown: { midtrans: true } });

    const res = await request(app)
      .get("/api/v1/admin/audit")
      .set("X-Admin-Key", ADMIN_KEY);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
  });
});

describe("Security headers", () => {
  it("removes X-Powered-By", async () => {
    const res = await request(app).get("/health");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  it("sets Cache-Control: no-store on responses", async () => {
    const res = await request(app).get("/health");
    expect(res.headers["cache-control"]).toContain("no-store");
  });

  it("sets helmet security headers", async () => {
    const res = await request(app).get("/health");
    // Helmet defaults
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBeDefined();
  });
});
