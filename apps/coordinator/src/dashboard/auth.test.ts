import { describe, expect, it } from "vitest";

import {
  DASHBOARD_SESSION_COOKIE,
  DashboardAuthenticator,
  parseDashboardSessionTtlSeconds,
} from "./auth.js";

const credential = "synthetic-owner-credential-for-tests";

function cookie(token: string): string {
  return `${DASHBOARD_SESSION_COOKIE}=${token}`;
}

describe("dashboard authentication and RBAC", () => {
  it("issues an expiring signed session without embedding the owner credential", () => {
    const auth = new DashboardAuthenticator({
      credential,
      now: () => 1_000,
      randomNonce: () => "a".repeat(32),
      sessionTtlSeconds: 60,
    });

    expect(auth.authenticateCredential(credential)).toBe(true);
    expect(auth.authenticateCredential("wrong-owner-credential".padEnd(32, "x"))).toBe(false);
    const session = auth.issueSession();

    expect(session.expiresAt).toBe(61_000);
    expect(session.token).not.toContain(credential);
    expect(auth.authenticate(cookie(session.token))).toEqual({
      principal: { expiresAt: 61_000, role: "owner" },
      status: "authenticated",
    });
  });

  it("fails closed for expired, malformed and tampered sessions", () => {
    let now = 1_000;
    const auth = new DashboardAuthenticator({
      credential,
      now: () => now,
      randomNonce: () => "b".repeat(32),
      sessionTtlSeconds: 1,
    });
    const session = auth.issueSession();

    expect(auth.authenticate(undefined)).toEqual({ status: "invalid" });
    expect(auth.authenticate(cookie(`${session.token}tampered`))).toEqual({ status: "invalid" });
    now = 2_000;
    expect(auth.authenticate(cookie(session.token))).toEqual({ status: "expired" });
  });

  it("denies missing permissions and undeclared route permissions by default", () => {
    const auth = new DashboardAuthenticator({
      credential,
      permissionsByRole: { owner: new Set(["dashboard:session:read"]) },
      randomNonce: () => "c".repeat(32),
    });
    const session = auth.issueSession();
    const sessionCookie = cookie(session.token);

    expect(auth.authorize(sessionCookie, "dashboard:session:read").status).toBe("allowed");
    expect(auth.authorize(sessionCookie, "dashboard:overview:read")).toEqual({
      status: "forbidden",
    });
    expect(auth.authorize(sessionCookie, undefined)).toEqual({ status: "forbidden" });
  });

  it("validates credential strength and bounded session TTL configuration", () => {
    expect(() => new DashboardAuthenticator({ credential: "too-short" })).toThrow(
      "dashboard owner credential must contain at least 32 characters",
    );
    expect(parseDashboardSessionTtlSeconds(undefined)).toBe(900);
    expect(parseDashboardSessionTtlSeconds("60")).toBe(60);
    for (const invalid of ["0", "-1", "1.5", "86401", "not-a-number"]) {
      expect(() => parseDashboardSessionTtlSeconds(invalid)).toThrow(
        "DASHBOARD_SESSION_TTL_SECONDS",
      );
    }
  });

  it("sets a hardened HttpOnly cookie and only enables Secure for remote HTTPS", () => {
    const auth = new DashboardAuthenticator({
      credential,
      now: () => 1_000,
      randomNonce: () => "d".repeat(32),
      sessionTtlSeconds: 60,
    });
    const session = auth.issueSession();

    const localCookie = auth.sessionCookie(session, false);
    expect(localCookie).toContain("HttpOnly");
    expect(localCookie).toContain("SameSite=Strict");
    expect(localCookie).toContain("Path=/dashboard");
    expect(localCookie).not.toContain("Secure");
    expect(auth.sessionCookie(session, true)).toContain("Secure");
  });

  it("binds CSRF evidence to the authenticated session and rejects absent or foreign tokens", () => {
    const auth = new DashboardAuthenticator({
      credential,
      randomNonce: () => "e".repeat(32),
    });
    const first = cookie(auth.issueSession().token);
    const secondAuth = new DashboardAuthenticator({
      credential,
      randomNonce: () => "f".repeat(32),
    });
    const second = cookie(secondAuth.issueSession().token);
    const token = auth.csrfToken(first);

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(auth.verifyCsrf(first, token)).toBe(true);
    expect(auth.verifyCsrf(first, undefined)).toBe(false);
    expect(auth.verifyCsrf(second, token)).toBe(false);
  });
});
