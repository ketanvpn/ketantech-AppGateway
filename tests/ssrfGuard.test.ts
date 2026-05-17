import { assertSafeUrl, validateProviderBaseUrl } from "../src/utils/ssrfGuard";

describe("SSRF Guard", () => {
  const ORIGINAL_ENV = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = ORIGINAL_ENV;
  });

  describe("development mode", () => {
    beforeEach(() => {
      process.env.NODE_ENV = "development";
    });

    it("allows public HTTPS URLs", () => {
      expect(() => assertSafeUrl("https://api.midtrans.com")).not.toThrow();
      expect(() => assertSafeUrl("https://api.xendit.co/v2/charge")).not.toThrow();
    });

    it("allows localhost in dev (for testing)", () => {
      expect(() => assertSafeUrl("http://localhost:3000")).not.toThrow();
      expect(() => assertSafeUrl("http://127.0.0.1:8080")).not.toThrow();
    });

    it("rejects file:// schema", () => {
      expect(() => assertSafeUrl("file:///etc/passwd")).toThrow(/Schema/);
    });

    it("rejects gopher:// schema", () => {
      expect(() => assertSafeUrl("gopher://internal.svc")).toThrow();
    });
  });

  describe("production mode", () => {
    beforeEach(() => {
      process.env.NODE_ENV = "production";
    });

    it("rejects HTTP (require HTTPS)", () => {
      expect(() => assertSafeUrl("http://api.midtrans.com")).toThrow(/HTTPS/);
    });

    it("rejects localhost", () => {
      expect(() => assertSafeUrl("https://localhost")).toThrow();
      expect(() => assertSafeUrl("https://127.0.0.1")).toThrow(/private/);
    });

    it("rejects RFC 1918 private IPs", () => {
      expect(() => assertSafeUrl("https://10.0.0.1")).toThrow(/private/);
      expect(() => assertSafeUrl("https://172.16.5.5")).toThrow(/private/);
      expect(() => assertSafeUrl("https://192.168.1.1")).toThrow(/private/);
    });

    it("rejects AWS/GCP metadata endpoint (link-local 169.254.169.254)", () => {
      expect(() => assertSafeUrl("https://169.254.169.254/latest/meta-data/")).toThrow(
        /private|link-local/,
      );
    });

    it("rejects 0.0.0.0 (current network)", () => {
      expect(() => assertSafeUrl("https://0.0.0.0:443")).toThrow();
    });

    it("rejects IPv6 loopback ::1", () => {
      expect(() => assertSafeUrl("https://[::1]:8080")).toThrow();
    });

    it("rejects IPv6 unique local fc00::/7", () => {
      expect(() => assertSafeUrl("https://[fc00::1]")).toThrow();
      expect(() => assertSafeUrl("https://[fd12:3456:789a::1]")).toThrow();
    });

    it("rejects IPv6 link-local fe80::/10", () => {
      expect(() => assertSafeUrl("https://[fe80::1]")).toThrow();
    });

    it("allows public HTTPS URLs", () => {
      expect(() => assertSafeUrl("https://api.midtrans.com")).not.toThrow();
      expect(() => assertSafeUrl("https://api.xendit.co")).not.toThrow();
    });
  });

  describe("validateProviderBaseUrl", () => {
    beforeEach(() => {
      process.env.NODE_ENV = "production";
    });

    it("strips trailing slash", () => {
      expect(validateProviderBaseUrl("https://api.midtrans.com/")).toBe(
        "https://api.midtrans.com",
      );
    });

    it("rejects malformed URL", () => {
      expect(() => validateProviderBaseUrl("not a url")).toThrow();
      expect(() => validateProviderBaseUrl("")).toThrow();
    });
  });
});
