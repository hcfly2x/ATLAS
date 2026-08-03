import { afterEach, describe, expect, it, vi } from "vitest";

import { createCoordinatorApp } from "../app.js";
import {
  DASHBOARD_SESSION_COOKIE,
  DashboardAuthenticator,
  type DashboardPermission,
} from "./auth.js";
import { assertRemoteDashboardConfiguration, type DashboardAuthAuditEvent } from "./routes.js";
import type { DashboardService } from "./service.js";
import type { DashboardTaskCommandService } from "./task-command-service.js";

const ownerCredential = "synthetic-dashboard-owner-credential-123456";
const deliveriesMock = vi.fn(() => Promise.resolve([]));
const demandWorkspaceMock = vi.fn(() => Promise.resolve(null));
const missionControlMock = vi.fn(() =>
  Promise.resolve({
    blocked: { count: 0, items: [], status: "available" },
    generatedAt: "2026-07-29T12:00:00.000Z",
    inProgress: { count: 0, items: [], status: "available" },
    intelligence: {
      facts: [],
      generatedBy: "deterministic_rules",
      headline: "Nenhuma prioridade derivada dos sinais disponíveis",
      status: "available",
    },
    methodology: {
      cost: "declared_task_cost_limit",
      eta: "indeterminado",
      pendingQuestions: "indeterminado",
      progress: "task_state",
      recentWindowDays: 7,
    },
    needsAttention: { count: 0, items: [], status: "available" },
    priorityNow: { item: null, status: "available" },
    projectId: null,
    recentlyCompleted: { count: 0, items: [], status: "available" },
    risks: { count: 0, items: [], status: "available" },
    unavailableSignals: [],
  }),
);
const dashboard = {
  audit: vi.fn(() => Promise.resolve([])),
  demandWorkspace: demandWorkspaceMock,
  deliveries: deliveriesMock,
  memory: vi.fn(() => Promise.resolve([])),
  missionControl: missionControlMock,
  overview: vi.fn(() =>
    Promise.resolve({
      costs: {
        codex: { capUsd: 75, spentUsd: 0 },
        llm: { capUsd: 25, spentUsd: 0 },
        periodDays: 30,
      },
      delivery: {
        delivered: 1,
        deliveryFailed: 0,
        missingOutbox: 0,
        pending: 0,
        pendingOverdue: 0,
        slaMs: 300_000,
      },
      projects: [{ id: "atlas", name: "ATLAS" }],
      states: [{ count: 1, state: "NEW" }],
    }),
  ),
  projects: vi.fn(() => Promise.resolve({ projects: [{ id: "atlas", name: "ATLAS" }] })),
  task: vi.fn(() => Promise.resolve(null)),
  tasks: vi.fn(() => Promise.resolve([])),
} as unknown as DashboardService;

function createAuth(
  options: {
    now?: () => number;
    permissions?: ReadonlySet<DashboardPermission>;
  } = {},
): DashboardAuthenticator {
  return new DashboardAuthenticator({
    credential: ownerCredential,
    now: options.now,
    permissionsByRole:
      options.permissions === undefined ? undefined : { owner: options.permissions },
    randomNonce: () => "a".repeat(32),
    sessionTtlSeconds: 60,
  });
}

function sessionCookie(auth: DashboardAuthenticator): string {
  return `${DASHBOARD_SESSION_COOKIE}=${auth.issueSession().token}`;
}

const apps: ReturnType<typeof createCoordinatorApp>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  vi.clearAllMocks();
});

describe("dashboard session authentication and RBAC", () => {
  it("requires a high-entropy owner credential before remote access can be enabled", () => {
    expect(() => {
      assertRemoteDashboardConfiguration(true, undefined);
    }).toThrow("DASHBOARD_OWNER_CREDENTIAL must contain at least 32 characters for remote access");
    expect(() => {
      assertRemoteDashboardConfiguration(true, "too-short");
    }).toThrow("DASHBOARD_OWNER_CREDENTIAL must contain at least 32 characters for remote access");
    expect(() => {
      assertRemoteDashboardConfiguration(true, "a".repeat(32));
    }).not.toThrow();
    expect(() => {
      assertRemoteDashboardConfiguration(false, undefined);
    }).not.toThrow();
  });

  it("issues an HttpOnly session without returning credentials or session material in the body", async () => {
    const auditEvents: DashboardAuthAuditEvent[] = [];
    const auth = createAuth();
    const app = createCoordinatorApp({
      dashboardAuth: auth,
      dashboardAuthAudit: (event) => auditEvents.push(event),
      dashboardService: dashboard,
      logger: false,
    });
    apps.push(app);

    const loginPage = await app.inject({ method: "GET", url: "/dashboard/login" });
    const rejected = await app.inject({
      method: "POST",
      url: "/dashboard/auth/session",
      payload: { credential: "wrong-synthetic-credential" },
    });
    const malformed = await app.inject({
      method: "POST",
      url: "/dashboard/auth/session",
      payload: { credential: ownerCredential, injected: "SECRET_PAYLOAD" },
    });
    const accepted = await app.inject({
      method: "POST",
      url: "/dashboard/auth/session",
      payload: { credential: ownerCredential },
    });

    expect(loginPage.statusCode).toBe(200);
    expect(loginPage.body).toContain("Credencial do dono");
    expect(rejected.statusCode).toBe(401);
    expect(rejected.json()).toEqual({ code: "DASHBOARD_UNAUTHORIZED" });
    expect(malformed.statusCode).toBe(401);
    expect(malformed.json()).toEqual({ code: "DASHBOARD_UNAUTHORIZED" });
    expect(accepted.statusCode).toBe(204);
    expect(accepted.body).toBe("");
    expect(accepted.headers["set-cookie"]).toContain(`${DASHBOARD_SESSION_COOKIE}=`);
    expect(accepted.headers["set-cookie"]).toContain("HttpOnly");
    expect(accepted.headers["set-cookie"]).toContain("SameSite=Strict");
    const serialized = JSON.stringify({
      auditEvents,
      body: accepted.body,
      rejected: rejected.body,
    });
    expect(serialized).not.toContain(ownerCredential);
    expect(serialized).not.toContain(DASHBOARD_SESSION_COOKIE);
  });

  it("protects the shell and every existing read route with an expiring owner session", async () => {
    const auth = createAuth();
    const cookie = sessionCookie(auth);
    const app = createCoordinatorApp({
      dashboardAuth: auth,
      dashboardService: dashboard,
      logger: false,
    });
    apps.push(app);

    const routes = [
      "/dashboard",
      "/dashboard/auth/session",
      "/dashboard/api/overview",
      "/dashboard/api/mission-control",
      "/dashboard/api/projects",
      "/dashboard/api/tasks",
      "/dashboard/api/deliveries",
      "/dashboard/api/demand/20000000-0000-4000-8000-000000000002",
      "/dashboard/api/tasks/20000000-0000-4000-8000-000000000002",
      "/dashboard/api/audit?projectId=atlas",
      "/dashboard/api/memory?projectId=atlas",
    ];
    for (const url of routes) {
      const denied = await app.inject({ method: "GET", url });
      expect(denied.statusCode, url).toBe(401);
    }

    const page = await app.inject({
      method: "GET",
      url: "/dashboard",
      headers: { cookie },
    });
    const overview = await app.inject({
      method: "GET",
      url: "/dashboard/api/overview",
      headers: { cookie },
    });
    const deliveries = await app.inject({
      method: "GET",
      url: "/dashboard/api/deliveries",
      headers: { cookie },
    });
    const missionControl = await app.inject({
      method: "GET",
      url: "/dashboard/api/mission-control",
      headers: { cookie },
    });
    const session = await app.inject({
      method: "GET",
      url: "/dashboard/auth/session",
      headers: { cookie },
    });

    expect(page.statusCode).toBe(200);
    expect(page.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(page.headers["referrer-policy"]).toBe("no-referrer");
    expect(page.headers["x-content-type-options"]).toBe("nosniff");
    expect(page.body).not.toContain("Authorization");
    expect(page.body).not.toContain("#token=");
    expect(overview.statusCode).toBe(200);
    expect(overview.body).toContain('"capUsd":75');
    expect(deliveries.statusCode).toBe(200);
    expect(missionControl.statusCode).toBe(200);
    expect(session.statusCode).toBe(200);
    expect(session.json()).toMatchObject({ role: "owner" });
    expect(JSON.stringify(session.json())).not.toContain(cookie);
    expect(deliveriesMock).toHaveBeenCalledWith(undefined);
    expect(missionControlMock).toHaveBeenCalledWith(undefined);
  });

  it("serves the existing demand read-model and stable 404 only after authorization", async () => {
    const existingTaskId = "10000000-0000-4000-8000-000000000001";
    demandWorkspaceMock.mockResolvedValueOnce({
      header: { taskId: existingTaskId },
    } as never);
    const auth = createAuth();
    const cookie = sessionCookie(auth);
    const app = createCoordinatorApp({
      dashboardAuth: auth,
      dashboardService: dashboard,
      logger: false,
    });
    apps.push(app);

    const accepted = await app.inject({
      method: "GET",
      url: `/dashboard/api/demand/${existingTaskId}`,
      headers: { cookie },
    });
    const missing = await app.inject({
      method: "GET",
      url: "/dashboard/api/demand/20000000-0000-4000-8000-000000000002",
      headers: { cookie },
    });

    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toEqual({ header: { taskId: existingTaskId } });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ code: "DEMAND_NOT_FOUND" });
  });

  it("denies expired sessions and records only a sanitized authentication outcome", async () => {
    let now = 1_000;
    const auditEvents: DashboardAuthAuditEvent[] = [];
    const auth = createAuth({ now: () => now });
    const cookie = sessionCookie(auth);
    const app = createCoordinatorApp({
      dashboardAuth: auth,
      dashboardAuthAudit: (event) => auditEvents.push(event),
      dashboardService: dashboard,
      logger: false,
    });
    apps.push(app);
    now = 61_001;

    const response = await app.inject({
      method: "GET",
      url: "/dashboard",
      headers: { cookie },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ code: "DASHBOARD_SESSION_EXPIRED" });
    expect(auditEvents).toHaveLength(1);
    expect(auditEvents[0]).toMatchObject({
      action: "dashboard.auth.session_expired",
      outcome: "denied",
      reason: "expired",
    });
    expect(typeof auditEvents[0]?.correlationId).toBe("string");
    expect(JSON.stringify(auditEvents)).not.toContain(cookie);
    expect(JSON.stringify(auditEvents)).not.toContain(ownerCredential);
  });

  it("keeps authentication fail-closed when the sanitized audit sink fails", async () => {
    const auth = createAuth();
    const app = createCoordinatorApp({
      dashboardAuth: auth,
      dashboardAuthAudit: () => {
        throw new Error("SECRET_AUDIT_SINK_FAILURE");
      },
      dashboardService: dashboard,
      logger: false,
    });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/dashboard/auth/session",
      payload: { credential: "wrong-synthetic-credential" },
    });

    expect(response.statusCode).toBe(401);
    expect(response.body).not.toContain("SECRET_AUDIT_SINK_FAILURE");
  });

  it("denies a missing permission and every undeclared dashboard route by default", async () => {
    const auth = createAuth({ permissions: new Set(["dashboard:session:read"]) });
    const cookie = sessionCookie(auth);
    const app = createCoordinatorApp({
      dashboardAuth: auth,
      dashboardService: dashboard,
      logger: false,
    });
    app.get("/dashboard/api/undeclared", () => ({ unsafe: true }));
    apps.push(app);

    const missingPermission = await app.inject({
      method: "GET",
      url: "/dashboard/api/mission-control",
      headers: { cookie },
    });
    const undeclared = await app.inject({
      method: "GET",
      url: "/dashboard/api/undeclared",
      headers: { cookie },
    });

    expect(missingPermission.statusCode).toBe(403);
    expect(undeclared.statusCode).toBe(403);
    expect(undeclared.body).not.toContain("unsafe");
  });

  it("requires the decision permission and session-bound CSRF evidence before approval writes", async () => {
    const auth = createAuth();
    const cookie = sessionCookie(auth);
    const app = createCoordinatorApp({
      dashboardAuth: auth,
      dashboardService: dashboard,
      logger: false,
    });
    apps.push(app);
    const url = "/dashboard/api/approvals/11111111-1111-4111-8111-111111111111/decision";
    const payload = {
      decision: "approve",
      idempotencyKey: "22222222-2222-4222-8222-222222222222",
      targetVersion: 1,
      taskVersion: 2,
    };

    const unauthenticated = await app.inject({ method: "POST", payload, url });
    const missing = await app.inject({ headers: { cookie }, method: "POST", payload, url });
    const invalid = await app.inject({
      headers: { cookie, "x-atlas-csrf-token": "invalid" },
      method: "POST",
      payload,
      url,
    });
    const valid = await app.inject({
      headers: { cookie, "x-atlas-csrf-token": auth.csrfToken(cookie) ?? "" },
      method: "POST",
      payload,
      url,
    });

    expect(unauthenticated.statusCode).toBe(401);
    expect(missing.statusCode).toBe(403);
    expect(invalid.statusCode).toBe(403);
    expect(valid.statusCode).toBe(503);
    expect(
      (
        await app.inject({
          headers: { cookie },
          method: "GET",
          url,
        })
      ).statusCode,
    ).toBe(404);

    const readOnlyAuth = createAuth({
      permissions: new Set(["dashboard:session:read"]),
    });
    const readOnlyCookie = sessionCookie(readOnlyAuth);
    const readOnlyApp = createCoordinatorApp({
      dashboardAuth: readOnlyAuth,
      dashboardService: dashboard,
      logger: false,
    });
    apps.push(readOnlyApp);
    const forbidden = await readOnlyApp.inject({
      headers: {
        cookie: readOnlyCookie,
        "x-atlas-csrf-token": readOnlyAuth.csrfToken(readOnlyCookie) ?? "",
      },
      method: "POST",
      payload,
      url,
    });
    expect(forbidden.statusCode).toBe(403);
  });

  it("protects create and cancel with permission, CSRF and strict payloads", async () => {
    const createDemand = vi.fn().mockResolvedValue({
      idempotentReplay: false,
      task: {
        id: "10000000-0000-4000-8000-000000000001",
        projectId: "atlas",
        state: "NEW",
        version: 0,
      },
    });
    const cancelTask = vi.fn().mockResolvedValue({
      idempotentReplay: false,
      mode: "cooperative",
      task: {
        id: "10000000-0000-4000-8000-000000000001",
        projectId: "atlas",
        state: "CANCEL_REQUESTED",
        version: 8,
      },
    });
    const auth = createAuth();
    const cookie = sessionCookie(auth);
    const app = createCoordinatorApp({
      dashboardAuth: auth,
      dashboardService: dashboard,
      dashboardTaskCommandService: {
        cancelTask,
        createDemand,
      } as unknown as DashboardTaskCommandService,
      logger: false,
    });
    apps.push(app);
    const csrf = auth.csrfToken(cookie) ?? "";
    const createPayload = {
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
      objective: "Criar uma demanda",
      projectId: "atlas",
    };

    expect(
      (
        await app.inject({
          method: "POST",
          payload: createPayload,
          url: "/dashboard/api/demands",
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          headers: { cookie },
          method: "POST",
          payload: createPayload,
          url: "/dashboard/api/demands",
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          headers: { cookie, "x-atlas-csrf-token": csrf },
          method: "POST",
          payload: { ...createPayload, payload: "SECRET_PAYLOAD" },
          url: "/dashboard/api/demands",
        })
      ).statusCode,
    ).toBe(400);
    const created = await app.inject({
      headers: { cookie, "x-atlas-csrf-token": csrf },
      method: "POST",
      payload: createPayload,
      url: "/dashboard/api/demands",
    });
    expect(created.statusCode).toBe(201);
    expect(createDemand).toHaveBeenCalledOnce();

    const cancelled = await app.inject({
      headers: { cookie, "x-atlas-csrf-token": csrf },
      method: "POST",
      payload: {
        idempotencyKey: "22222222-2222-4222-8222-222222222222",
        taskVersion: 7,
      },
      url: "/dashboard/api/tasks/10000000-0000-4000-8000-000000000001/cancel",
    });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelTask).toHaveBeenCalledOnce();
    expect(`${created.body}${cancelled.body}`).not.toContain("SECRET_PAYLOAD");
  });

  it("does not expose domain write methods under /dashboard", async () => {
    const auth = createAuth();
    const cookie = sessionCookie(auth);
    const app = createCoordinatorApp({
      dashboardAuth: auth,
      dashboardService: dashboard,
      logger: false,
    });
    apps.push(app);

    for (const path of [
      "/dashboard/api/deliveries",
      "/dashboard/api/demand/10000000-0000-4000-8000-000000000001",
      "/dashboard/api/mission-control",
    ]) {
      for (const method of ["POST", "PUT", "PATCH", "DELETE"] as const) {
        const response = await app.inject({ method, url: path, headers: { cookie } });
        expect(response.statusCode).toBe(403);
      }
    }
  });

  it("serves the authenticated React shell, immutable assets and client deep-links", async () => {
    const auth = createAuth();
    const cookie = sessionCookie(auth);
    const app = createCoordinatorApp({
      dashboardAuth: auth,
      dashboardService: dashboard,
      logger: false,
    });
    apps.push(app);

    const shell = await app.inject({
      headers: { cookie },
      method: "GET",
      url: "/dashboard",
    });
    const assetPath = /\/dashboard\/assets\/[^"']+\.js/u.exec(shell.body)?.[0];

    expect(shell.statusCode).toBe(200);
    expect(shell.headers["cache-control"]).toBe("no-store");
    expect(shell.headers["content-security-policy"]).toContain("script-src 'self'");
    expect(shell.headers["content-security-policy"]).not.toContain("script-src 'unsafe-inline'");
    expect(shell.body).toContain('<div id="root"></div>');
    expect(shell.body).not.toContain("Coordinator · somente leitura");
    expect(assetPath).toBeDefined();

    const deepLink = await app.inject({
      headers: { cookie },
      method: "GET",
      url: "/dashboard/demand/10000000-0000-4000-8000-000000000001",
    });
    const deniedDeepLink = await app.inject({
      method: "GET",
      url: "/dashboard/demand/10000000-0000-4000-8000-000000000001",
    });
    const missingApi = await app.inject({
      headers: { cookie },
      method: "GET",
      url: "/dashboard/api/not-a-route",
    });

    expect(deepLink.statusCode).toBe(200);
    expect(deepLink.body).toBe(shell.body);
    expect(deniedDeepLink.statusCode).toBe(401);
    expect(missingApi.statusCode).toBe(404);
    expect(missingApi.json()).toEqual({ code: "DASHBOARD_NOT_FOUND" });

    const asset = await app.inject({
      headers: { cookie },
      method: "GET",
      url: assetPath ?? "/dashboard/assets/missing.js",
    });
    const deniedAsset = await app.inject({
      method: "GET",
      url: assetPath ?? "/dashboard/assets/missing.js",
    });
    const missingAsset = await app.inject({
      headers: { cookie },
      method: "GET",
      url: "/dashboard/assets/not-a-real-asset.js",
    });

    expect(asset.statusCode).toBe(200);
    expect(asset.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect(asset.headers["x-content-type-options"]).toBe("nosniff");
    expect(deniedAsset.statusCode).toBe(401);
    expect(missingAsset.statusCode).toBe(404);
    expect(`${shell.body}${asset.body}`).not.toContain(ownerCredential);
    expect(`${shell.body}${asset.body}`).not.toContain("DATABASE_URL");
    expect(`${shell.body}${asset.body}`).not.toContain("SECRET_PAYLOAD");
  });

  it("keeps loopback default and marks a remotely enabled session Secure", async () => {
    const localAuth = createAuth();
    const localApp = createCoordinatorApp({
      dashboardAuth: localAuth,
      dashboardService: dashboard,
      logger: false,
    });
    apps.push(localApp);
    const localDenied = await localApp.inject({
      method: "GET",
      url: "/dashboard/login",
      remoteAddress: "192.0.2.10",
    });
    expect(localDenied.statusCode).toBe(403);

    const remoteAuth = createAuth();
    const remoteApp = createCoordinatorApp({
      dashboardAuth: remoteAuth,
      dashboardRemoteAccessEnabled: true,
      dashboardService: dashboard,
      logger: false,
    });
    apps.push(remoteApp);
    const remoteLogin = await remoteApp.inject({
      method: "POST",
      url: "/dashboard/auth/session",
      payload: { credential: ownerCredential },
      remoteAddress: "192.0.2.10",
    });
    expect(remoteLogin.statusCode).toBe(204);
    expect(remoteLogin.headers["set-cookie"]).toContain("Secure");
  });
});
