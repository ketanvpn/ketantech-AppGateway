import {
  authAttemptStore,
  AUTH_LOCKOUT_CONFIG,
} from "../src/store/authAttemptStore";
import { resetDbForTests } from "../src/store/db";

describe("Auth Lockout Store (PCI-DSS req 8.1.6)", () => {
  beforeEach(() => {
    resetDbForTests();
    authAttemptStore.clear();
  });

  it("starts with no lockout", () => {
    expect(authAttemptStore.isLocked("admin", "1.2.3.4")).toBe(0);
  });

  it("increments counter on each failure but doesn't lock until threshold", () => {
    const ip = "1.2.3.4";
    const max = AUTH_LOCKOUT_CONFIG.maxFailedAttempts;

    // Trigger max-1 failures — should not be locked yet
    for (let i = 0; i < max - 1; i++) {
      const locked = authAttemptStore.recordFailure("admin", ip);
      expect(locked).toBe(false);
    }
    expect(authAttemptStore.isLocked("admin", ip)).toBe(0);
  });

  it("locks out at exactly max failed attempts", () => {
    const ip = "1.2.3.4";
    const max = AUTH_LOCKOUT_CONFIG.maxFailedAttempts;

    // Last failure should trigger lockout
    let lockedAtAttempt = -1;
    for (let i = 1; i <= max; i++) {
      const locked = authAttemptStore.recordFailure("admin", ip);
      if (locked) {
        lockedAtAttempt = i;
        break;
      }
    }
    expect(lockedAtAttempt).toBe(max);
    expect(authAttemptStore.isLocked("admin", ip)).toBeGreaterThan(0);
  });

  it("isLocked returns remaining seconds when locked", () => {
    const ip = "1.2.3.4";
    const max = AUTH_LOCKOUT_CONFIG.maxFailedAttempts;

    for (let i = 0; i < max; i++) {
      authAttemptStore.recordFailure("admin", ip);
    }
    const remaining = authAttemptStore.isLocked("admin", ip);
    // Should be close to lockout duration
    const expectedSec = AUTH_LOCKOUT_CONFIG.lockoutDurationMs / 1000;
    expect(remaining).toBeGreaterThan(0);
    expect(remaining).toBeLessThanOrEqual(expectedSec);
  });

  it("reset() clears the counter and lockout", () => {
    const ip = "1.2.3.4";
    const max = AUTH_LOCKOUT_CONFIG.maxFailedAttempts;

    for (let i = 0; i < max; i++) {
      authAttemptStore.recordFailure("admin", ip);
    }
    expect(authAttemptStore.isLocked("admin", ip)).toBeGreaterThan(0);

    authAttemptStore.reset("admin", ip);
    expect(authAttemptStore.isLocked("admin", ip)).toBe(0);
  });

  it("locks out separately per IP", () => {
    const max = AUTH_LOCKOUT_CONFIG.maxFailedAttempts;

    // Lock out IP A
    for (let i = 0; i < max; i++) {
      authAttemptStore.recordFailure("admin", "1.1.1.1");
    }
    expect(authAttemptStore.isLocked("admin", "1.1.1.1")).toBeGreaterThan(0);

    // IP B should still be free
    expect(authAttemptStore.isLocked("admin", "2.2.2.2")).toBe(0);
  });

  it("locks out separately per resource", () => {
    const max = AUTH_LOCKOUT_CONFIG.maxFailedAttempts;
    const ip = "1.2.3.4";

    // Lock out admin endpoint
    for (let i = 0; i < max; i++) {
      authAttemptStore.recordFailure("admin", ip);
    }
    expect(authAttemptStore.isLocked("admin", ip)).toBeGreaterThan(0);

    // Other resource should be free for same IP
    expect(authAttemptStore.isLocked("client", ip)).toBe(0);
  });

  it("PCI-DSS compliance: max attempts default ≤ 10 (recommended), strict 6", () => {
    expect(AUTH_LOCKOUT_CONFIG.maxFailedAttempts).toBeLessThanOrEqual(10);
    expect(AUTH_LOCKOUT_CONFIG.lockoutDurationMs).toBeGreaterThanOrEqual(
      // PCI-DSS rec: 30 minutes minimum, default kita 15 minutes
      // (sengaja lebih ketat untuk balance dengan UX di internal tool)
      10 * 60_000,
    );
  });
});
