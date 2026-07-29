import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { z } from "zod";

export const DASHBOARD_SESSION_COOKIE = "atlas_dashboard_session";

export const dashboardPermissions = [
  "dashboard:approval:decide",
  "dashboard:audit:read",
  "dashboard:deliveries:read",
  "dashboard:demand:read",
  "dashboard:demand:create",
  "dashboard:memory:read",
  "dashboard:mission-control:read",
  "dashboard:overview:read",
  "dashboard:projects:read",
  "dashboard:session:read",
  "dashboard:shell:read",
  "dashboard:tasks:read",
  "dashboard:task:cancel",
] as const;

export type DashboardPermission = (typeof dashboardPermissions)[number];
export type DashboardRole = "owner";

const sessionPayloadSchema = z
  .object({
    expiresAt: z.number().int().positive(),
    issuedAt: z.number().int().nonnegative(),
    nonce: z.string().regex(/^[a-f0-9]{32}$/),
    role: z.literal("owner"),
    version: z.literal(1),
  })
  .strict();

type DashboardSessionPayload = z.infer<typeof sessionPayloadSchema>;

export interface DashboardPrincipal {
  readonly expiresAt: number;
  readonly role: DashboardRole;
}

export type DashboardAuthenticationResult =
  | { readonly status: "authenticated"; readonly principal: DashboardPrincipal }
  | { readonly status: "expired" }
  | { readonly status: "invalid" };

export type DashboardAuthorizationResult =
  | { readonly status: "allowed"; readonly principal: DashboardPrincipal }
  | { readonly status: "expired" }
  | { readonly status: "forbidden" }
  | { readonly status: "unauthenticated" };

export interface DashboardIssuedSession {
  readonly expiresAt: number;
  readonly token: string;
}

export interface DashboardAuthenticatorOptions {
  readonly credential: string;
  readonly now?: (() => number) | undefined;
  readonly permissionsByRole?:
    Readonly<Record<DashboardRole, ReadonlySet<DashboardPermission>>> | undefined;
  readonly randomNonce?: (() => string) | undefined;
  readonly sessionTtlSeconds?: number | undefined;
}

const DEFAULT_SESSION_TTL_SECONDS = 15 * 60;
const MAX_SESSION_TTL_SECONDS = 24 * 60 * 60;
const MINIMUM_CREDENTIAL_LENGTH = 32;

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function constantTimeEqual(left: string, right: string): boolean {
  return timingSafeEqual(digest(left), digest(right));
}

function parseCookie(cookieHeader: string | undefined, name: string): string | undefined {
  if (cookieHeader === undefined) return undefined;
  for (const part of cookieHeader.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName === name) return rawValue.join("=") || undefined;
  }
  return undefined;
}

function safeDecode(value: string): string | undefined {
  try {
    return Buffer.from(value, "base64url").toString("utf8");
  } catch {
    return undefined;
  }
}

export function parseDashboardSessionTtlSeconds(value: string | undefined): number {
  if (value === undefined) return DEFAULT_SESSION_TTL_SECONDS;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > MAX_SESSION_TTL_SECONDS) {
    throw new Error(
      "DASHBOARD_SESSION_TTL_SECONDS must be a positive integer no greater than 86400",
    );
  }
  return parsed;
}

export class DashboardAuthenticator {
  private readonly credential: string;
  private readonly now: () => number;
  private readonly permissionsByRole: Readonly<
    Record<DashboardRole, ReadonlySet<DashboardPermission>>
  >;
  private readonly randomNonce: () => string;
  private readonly sessionTtlSeconds: number;

  constructor(options: DashboardAuthenticatorOptions) {
    if (options.credential.trim().length < MINIMUM_CREDENTIAL_LENGTH) {
      throw new Error("dashboard owner credential must contain at least 32 characters");
    }
    const sessionTtlSeconds = options.sessionTtlSeconds ?? DEFAULT_SESSION_TTL_SECONDS;
    if (
      !Number.isSafeInteger(sessionTtlSeconds) ||
      sessionTtlSeconds <= 0 ||
      sessionTtlSeconds > MAX_SESSION_TTL_SECONDS
    ) {
      throw new Error("dashboard session TTL must be a positive integer no greater than 86400");
    }
    this.credential = options.credential;
    this.now = options.now ?? Date.now;
    this.permissionsByRole = options.permissionsByRole ?? {
      owner: new Set(dashboardPermissions),
    };
    this.randomNonce = options.randomNonce ?? (() => randomBytes(16).toString("hex"));
    this.sessionTtlSeconds = sessionTtlSeconds;
  }

  authenticateCredential(candidate: string): boolean {
    return constantTimeEqual(candidate, this.credential);
  }

  issueSession(): DashboardIssuedSession {
    const issuedAt = this.now();
    const payload: DashboardSessionPayload = {
      expiresAt: issuedAt + this.sessionTtlSeconds * 1000,
      issuedAt,
      nonce: this.randomNonce(),
      role: "owner",
      version: 1,
    };
    const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    const signature = this.sign(encodedPayload);
    return {
      expiresAt: payload.expiresAt,
      token: `${encodedPayload}.${signature}`,
    };
  }

  authenticate(cookieHeader: string | undefined): DashboardAuthenticationResult {
    const token = parseCookie(cookieHeader, DASHBOARD_SESSION_COOKIE);
    if (token === undefined) return { status: "invalid" };
    const [encodedPayload, signature, ...remainder] = token.split(".");
    if (
      encodedPayload === undefined ||
      signature === undefined ||
      remainder.length > 0 ||
      !constantTimeEqual(signature, this.sign(encodedPayload))
    ) {
      return { status: "invalid" };
    }
    const decoded = safeDecode(encodedPayload);
    if (decoded === undefined) return { status: "invalid" };
    let payload: DashboardSessionPayload;
    try {
      payload = sessionPayloadSchema.parse(JSON.parse(decoded) as unknown);
    } catch {
      return { status: "invalid" };
    }
    if (this.now() >= payload.expiresAt) return { status: "expired" };
    return {
      principal: {
        expiresAt: payload.expiresAt,
        role: payload.role,
      },
      status: "authenticated",
    };
  }

  authorize(
    cookieHeader: string | undefined,
    permission: DashboardPermission | undefined,
  ): DashboardAuthorizationResult {
    const authentication = this.authenticate(cookieHeader);
    if (authentication.status === "expired") return authentication;
    if (authentication.status !== "authenticated") return { status: "unauthenticated" };
    if (
      permission === undefined ||
      !this.permissionsByRole[authentication.principal.role].has(permission)
    ) {
      return { status: "forbidden" };
    }
    return {
      principal: authentication.principal,
      status: "allowed",
    };
  }

  csrfToken(cookieHeader: string | undefined): string | undefined {
    const token = parseCookie(cookieHeader, DASHBOARD_SESSION_COOKIE);
    if (token === undefined || this.authenticate(cookieHeader).status !== "authenticated") {
      return undefined;
    }
    return createHmac("sha256", this.credential)
      .update(`dashboard-csrf:v1:${token}`, "utf8")
      .digest("base64url");
  }

  verifyCsrf(cookieHeader: string | undefined, candidate: string | undefined): boolean {
    const expected = this.csrfToken(cookieHeader);
    return (
      expected !== undefined && candidate !== undefined && constantTimeEqual(expected, candidate)
    );
  }

  sessionCookie(session: DashboardIssuedSession, secure: boolean): string {
    const maxAgeSeconds = Math.max(0, Math.floor((session.expiresAt - this.now()) / 1000));
    return [
      `${DASHBOARD_SESSION_COOKIE}=${session.token}`,
      "Path=/dashboard",
      "HttpOnly",
      "SameSite=Strict",
      `Max-Age=${String(maxAgeSeconds)}`,
      `Expires=${new Date(session.expiresAt).toUTCString()}`,
      ...(secure ? ["Secure"] : []),
    ].join("; ");
  }

  private sign(payload: string): string {
    return createHmac("sha256", this.credential).update(payload, "utf8").digest("base64url");
  }
}
