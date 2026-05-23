import { AutogopayProvider } from "../src/providers/autogopayProvider";
import { settingsStore } from "../src/store/settingsStore";
import { resetDbForTests } from "../src/store/db";
import { createHmac } from "crypto";

describe("AutogopayProvider", () => {
  let provider: AutogopayProvider;
  let originalApiKey: string | undefined;

  beforeEach(() => {
    resetDbForTests();
    // Save and clear env var to ensure clean test environment
    originalApiKey = process.env.AUTOGOPAY_API_KEY;
    delete process.env.AUTOGOPAY_API_KEY;
    provider = new AutogopayProvider();
  });

  afterEach(() => {
    // Restore env var
    if (originalApiKey !== undefined) {
      process.env.AUTOGOPAY_API_KEY = originalApiKey;
    }
  });

  describe("charge()", () => {
    it("should reject non-QRIS methods", async () => {
      settingsStore.setCredential("autogopay", "apiKey", "test-key");

      await expect(
        provider.charge({
          orderId: "TEST-001",
          amount: 50000,
          currency: "IDR",
          method: "credit_card",
          customer: { name: "Test", email: "test@example.com" },
        }),
      ).rejects.toThrow("hanya support method 'qris'");
    });

    it("should reject if API key not configured", async () => {
      await expect(
        provider.charge({
          orderId: "TEST-001",
          amount: 50000,
          currency: "IDR",
          method: "qris",
          customer: { name: "Test", email: "test@example.com" },
        }),
      ).rejects.toThrow(); // Will throw either validation error or HTTP 401
    });

    it("should reject amount outside valid range", async () => {
      settingsStore.setCredential("autogopay", "apiKey", "test-key");

      // Amount too low
      await expect(
        provider.charge({
          orderId: "TEST-001",
          amount: 0,
          currency: "IDR",
          method: "qris",
          customer: { name: "Test", email: "test@example.com" },
        }),
      ).rejects.toThrow("amount harus antara 1 - 10.000.000");

      // Amount too high
      await expect(
        provider.charge({
          orderId: "TEST-002",
          amount: 10_000_001,
          currency: "IDR",
          method: "qris",
          customer: { name: "Test", email: "test@example.com" },
        }),
      ).rejects.toThrow("amount harus antara 1 - 10.000.000");
    });

    it("should reject when force down", async () => {
      settingsStore.setCredential("autogopay", "apiKey", "test-key");
      settingsStore.setForceDown("autogopay", true);

      await expect(
        provider.charge({
          orderId: "TEST-001",
          amount: 50000,
          currency: "IDR",
          method: "qris",
          customer: { name: "Test", email: "test@example.com" },
        }),
      ).rejects.toThrow("currently down (forced)");

      settingsStore.setForceDown("autogopay", false);
    });
  });

  describe("getStatus()", () => {
    it("should reject if API key not configured", async () => {
      await expect(provider.getStatus("test-tx-id")).rejects.toThrow(); // Will throw either validation error or HTTP 401
    });
  });

  describe("verifyWebhook()", () => {
    const testApiKey = "test-api-key-12345";
    const testPayload = JSON.stringify({
      event: "transaction.received",
      transaction: { id: "TX-001", status: "settlement" },
    });

    it("should reject webhook without X-Signature header", () => {
      settingsStore.setCredential("autogopay", "apiKey", testApiKey);

      const result = provider.verifyWebhook(Buffer.from(testPayload), {});

      expect(result).toBe(false);
    });

    it("should accept webhook with valid signature", () => {
      settingsStore.setCredential("autogopay", "apiKey", testApiKey);

      const rawBody = Buffer.from(testPayload);
      const signature = createHmac("sha256", testApiKey)
        .update(rawBody)
        .digest("hex");

      const result = provider.verifyWebhook(rawBody, {
        "x-signature": signature,
      });

      expect(result).toBe(true);
    });

    it("should reject webhook with invalid signature", () => {
      settingsStore.setCredential("autogopay", "apiKey", testApiKey);

      const rawBody = Buffer.from(testPayload);
      const wrongSignature = "0".repeat(64); // Invalid signature

      const result = provider.verifyWebhook(rawBody, {
        "x-signature": wrongSignature,
      });

      expect(result).toBe(false);
    });

    it("should reject webhook with tampered payload", () => {
      settingsStore.setCredential("autogopay", "apiKey", testApiKey);

      const rawBody = Buffer.from(testPayload);
      const signature = createHmac("sha256", testApiKey)
        .update(rawBody)
        .digest("hex");

      // Tamper the body
      const tamperedBody = Buffer.from(
        testPayload.replace("settlement", "pending"),
      );

      const result = provider.verifyWebhook(tamperedBody, {
        "x-signature": signature,
      });

      expect(result).toBe(false);
    });

    it("should reject webhook in production without API key", () => {
      // Don't set API key
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";

      const result = provider.verifyWebhook(Buffer.from(testPayload), {
        "x-signature": "dummy",
      });

      expect(result).toBe(false);

      process.env.NODE_ENV = originalEnv;
    });
  });

  describe("parseWebhook()", () => {
    it("should parse valid webhook payload", () => {
      const payload = {
        event: "transaction.received",
        timestamp: "2024-03-29 14:30:45",
        transaction: {
          id: "TRX-001",
          time: "2024-03-29 14:30:40",
          amount: 50000,
          currency: "IDR",
          payment_type: "qris",
          status: "settlement",
          issuer: "gopay",
        },
      };

      const event = provider.parseWebhook(payload);

      expect(event.providerTransactionId).toBe("TRX-001");
      expect(event.status).toBe("success"); // settlement → success
      expect(event.rawPayload).toEqual(payload);
    });

    it("should throw if transaction data missing", () => {
      const payload = {
        event: "transaction.received",
        timestamp: "2024-03-29 14:30:45",
      };

      expect(() => provider.parseWebhook(payload)).toThrow(
        "missing transaction data",
      );
    });

    it("should map all status values correctly", () => {
      const testCases = [
        { input: "settlement", expected: "success" },
        { input: "pending", expected: "pending" },
        { input: "expire", expected: "expired" },
        { input: "cancel", expected: "failed" },
      ];

      for (const { input, expected } of testCases) {
        const payload = {
          event: "transaction.received",
          transaction: {
            id: "TRX-001",
            status: input,
          },
        };

        const event = provider.parseWebhook(payload);
        expect(event.status).toBe(expected);
      }
    });
  });

  describe("isHealthy()", () => {
    it("should return false if force down", async () => {
      settingsStore.setCredential("autogopay", "apiKey", "test-key");
      settingsStore.setForceDown("autogopay", true);

      const healthy = await provider.isHealthy();

      expect(healthy).toBe(false);

      settingsStore.setForceDown("autogopay", false);
    });

    it("should return false if API key not configured", async () => {
      const healthy = await provider.isHealthy();

      expect(healthy).toBe(false);
    });
  });

  describe("status mapping", () => {
    it("should handle unknown status gracefully", () => {
      const payload = {
        event: "transaction.received",
        transaction: {
          id: "TRX-001",
          status: "unknown_status",
        },
      };

      const event = provider.parseWebhook(payload);

      // Unknown status should default to pending
      expect(event.status).toBe("pending");
    });
  });
});
