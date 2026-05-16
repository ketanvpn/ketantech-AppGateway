import request from "supertest";
import { createApp } from "../src/app";
import { resetDbForTests } from "../src/store/db";
import { settingsStore } from "../src/store/settingsStore";
import { config } from "../src/config";

const app = createApp();
const ADMIN_KEY = "dev-admin-key-change-me";

beforeEach(() => {
  resetDbForTests();
  settingsStore._resetForTests();
  config.clientApiKeys.length = 0;
});

describe("Admin system settings endpoints", () => {
  it("rejects without admin key", async () => {
    const res = await request(app).get("/api/v1/admin/system");
    expect(res.status).toBe(401);
  });

  it("GET returns snapshot with all fields, source = env by default", async () => {
    const res = await request(app)
      .get("/api/v1/admin/system")
      .set("X-Admin-Key", ADMIN_KEY);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty("clientApiKeys");
    expect(res.body.data).toHaveProperty("rateLimit");
    expect(res.body.data).toHaveProperty("retry");
    expect(res.body.data).toHaveProperty("corsOrigins");
    expect(res.body.data).toHaveProperty("trustProxy");
    expect(res.body.data.rateLimit.source).toBe("env");
  });

  it("PATCH client API keys di-save dan langsung berlaku tanpa restart", async () => {
    const newKey = "test-secret-key-32characters-xxx";
    const patch = await request(app)
      .patch("/api/v1/admin/system")
      .set("X-Admin-Key", ADMIN_KEY)
      .send({ clientApiKeys: [newKey] });
    expect(patch.status).toBe(200);
    expect(patch.body.data.clientApiKeys.count).toBe(1);
    expect(patch.body.data.clientApiKeys.source).toBe("db");

    // Pastikan masked, bukan plain
    expect(patch.body.data.clientApiKeys.previews[0]).not.toBe(newKey);
    expect(patch.body.data.clientApiKeys.previews[0]).toContain("xxx");

    // Tanpa header → 401
    const block = await request(app)
      .post("/api/v1/payments/charge")
      .set("Idempotency-Key", "system-1")
      .send({
        orderId: "ORD-SYS-1",
        amount: 50000,
        currency: "IDR",
        method: "qris",
        customer: { name: "Test", email: "test@example.com" },
      });
    expect(block.status).toBe(401);

    // Dengan header → 201
    const ok = await request(app)
      .post("/api/v1/payments/charge")
      .set("Idempotency-Key", "system-2")
      .set("X-Client-Key", newKey)
      .send({
        orderId: "ORD-SYS-2",
        amount: 50000,
        currency: "IDR",
        method: "qris",
        customer: { name: "Test", email: "test@example.com" },
      });
    expect(ok.status).toBe(201);
  });

  it("PATCH dengan null hapus override, kembali ke env", async () => {
    // Set
    await request(app)
      .patch("/api/v1/admin/system")
      .set("X-Admin-Key", ADMIN_KEY)
      .send({ rateLimit: { windowMs: 30000, max: 50 } });
    let snap = (await request(app)
      .get("/api/v1/admin/system")
      .set("X-Admin-Key", ADMIN_KEY)).body.data;
    expect(snap.rateLimit.source).toBe("db");
    expect(snap.rateLimit.value.max).toBe(50);

    // Hapus
    await request(app)
      .patch("/api/v1/admin/system")
      .set("X-Admin-Key", ADMIN_KEY)
      .send({ rateLimit: null });
    snap = (await request(app)
      .get("/api/v1/admin/system")
      .set("X-Admin-Key", ADMIN_KEY)).body.data;
    expect(snap.rateLimit.source).toBe("env");
  });

  it("rejects rateLimit dengan nilai out of range", async () => {
    const res = await request(app)
      .patch("/api/v1/admin/system")
      .set("X-Admin-Key", ADMIN_KEY)
      .send({ rateLimit: { windowMs: 100, max: 50 } }); // <1000ms
    expect(res.status).toBe(400);
  });

  it("rejects empty body", async () => {
    const res = await request(app)
      .patch("/api/v1/admin/system")
      .set("X-Admin-Key", ADMIN_KEY)
      .send({});
    expect(res.status).toBe(400);
  });

  it("audit log mencatat system update tanpa nilai key mentah", async () => {
    await request(app)
      .patch("/api/v1/admin/system")
      .set("X-Admin-Key", ADMIN_KEY)
      .send({ clientApiKeys: ["super-rahasia-key-32chars-xx"] });

    const audit = await request(app)
      .get("/api/v1/admin/audit?action=admin.system.update")
      .set("X-Admin-Key", ADMIN_KEY);
    expect(audit.status).toBe(200);
    expect(audit.body.data.length).toBe(1);
    // Pastikan value asli tidak masuk audit log
    expect(JSON.stringify(audit.body.data[0])).not.toContain("super-rahasia-key");
  });

  it("survives restart — system override di DB tetap setelah _resetForTests()", async () => {
    await request(app)
      .patch("/api/v1/admin/system")
      .set("X-Admin-Key", ADMIN_KEY)
      .send({ retry: { maxAttempts: 5, baseDelayMs: 500 } });

    settingsStore._resetForTests();
    const sys = settingsStore.getSystem();
    expect(sys.retry.maxAttempts).toBe(5);
    expect(sys.retry.baseDelayMs).toBe(500);
  });
});
