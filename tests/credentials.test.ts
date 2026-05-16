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
  // Pastikan env Midtrans kosong di awal supaya source = empty
  config.midtrans.serverKey = "";
});

describe("Admin credentials endpoints", () => {
  it("rejects without admin key", async () => {
    const res = await request(app).get("/api/v1/admin/credentials");
    expect(res.status).toBe(401);
  });

  it("returns snapshot with all providers, secrets masked", async () => {
    const res = await request(app)
      .get("/api/v1/admin/credentials")
      .set("X-Admin-Key", ADMIN_KEY);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty("midtrans");
    expect(res.body.data).toHaveProperty("xendit");
    expect(res.body.data).toHaveProperty("doku");
    expect(res.body.data).toHaveProperty("tripay");
    expect(res.body.data.midtrans.serverKey.source).toBe("empty");
  });

  it("PUT updates credential and is reflected via getCredential()", async () => {
    const res = await request(app)
      .put("/api/v1/admin/credentials")
      .set("X-Admin-Key", ADMIN_KEY)
      .send({
        provider: "midtrans",
        field: "serverKey",
        value: "SB-Mid-server-secret-12345",
      });
    expect(res.status).toBe(200);
    expect(res.body.data.midtrans.serverKey.source).toBe("db");
    // Masked, bukan plain
    expect(res.body.data.midtrans.serverKey.value).not.toContain("secret");

    // Resolved value via store harus full
    const resolved = settingsStore.getCredential("midtrans", "serverKey");
    expect(resolved).toBe("SB-Mid-server-secret-12345");
  });

  it("PUT with empty value clears DB override", async () => {
    config.midtrans.serverKey = "from-env-key";

    // Set di DB
    await request(app)
      .put("/api/v1/admin/credentials")
      .set("X-Admin-Key", ADMIN_KEY)
      .send({
        provider: "midtrans",
        field: "serverKey",
        value: "db-override",
      });
    expect(settingsStore.getCredential("midtrans", "serverKey")).toBe(
      "db-override",
    );

    // Hapus override → kembali ke env
    const res = await request(app)
      .put("/api/v1/admin/credentials")
      .set("X-Admin-Key", ADMIN_KEY)
      .send({ provider: "midtrans", field: "serverKey", value: "" });
    expect(res.status).toBe(200);
    expect(res.body.data.midtrans.serverKey.source).toBe("env");
    expect(settingsStore.getCredential("midtrans", "serverKey")).toBe(
      "from-env-key",
    );
  });

  it("rejects invalid field for provider", async () => {
    const res = await request(app)
      .put("/api/v1/admin/credentials")
      .set("X-Admin-Key", ADMIN_KEY)
      .send({
        // serverKey bukan field Tripay
        provider: "tripay",
        field: "serverKey",
        value: "x",
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("INVALID_FIELD");
  });

  it("survives 'restart' — credential di DB tetap ada setelah _resetForTests()", async () => {
    await request(app)
      .put("/api/v1/admin/credentials")
      .set("X-Admin-Key", ADMIN_KEY)
      .send({
        provider: "xendit",
        field: "callbackToken",
        value: "persistent-token",
      });

    settingsStore._resetForTests();
    expect(settingsStore.getCredential("xendit", "callbackToken")).toBe(
      "persistent-token",
    );
  });
});
