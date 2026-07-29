import { afterEach, describe, expect, it, vi } from "vitest";

import { createCoordinatorApp } from "../app.js";
import { assertRemoteDashboardConfiguration } from "./routes.js";
import type { DashboardService } from "./service.js";

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
  task: vi.fn(() => Promise.resolve(null)),
  tasks: vi.fn(() => Promise.resolve([])),
} as unknown as DashboardService;

const apps: ReturnType<typeof createCoordinatorApp>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("read-only dashboard", () => {
  it("requires a high-entropy token before remote access can be enabled", () => {
    expect(() => {
      assertRemoteDashboardConfiguration(true, undefined);
    }).toThrow("DASHBOARD_TOKEN must contain at least 32 characters for remote access");
    expect(() => {
      assertRemoteDashboardConfiguration(true, "too-short");
    }).toThrow("DASHBOARD_TOKEN must contain at least 32 characters for remote access");
    expect(() => {
      assertRemoteDashboardConfiguration(true, "a".repeat(32));
    }).not.toThrow();
    expect(() => {
      assertRemoteDashboardConfiguration(false, undefined);
    }).not.toThrow();
  });

  it("serves a loopback shell and protects all data with a token", async () => {
    const app = createCoordinatorApp({
      dashboardService: dashboard,
      dashboardToken: "local-dashboard-token",
      logger: false,
    });
    apps.push(app);

    const page = await app.inject({ method: "GET", url: "/dashboard" });
    const denied = await app.inject({ method: "GET", url: "/dashboard/api/mission-control" });
    const accepted = await app.inject({
      method: "GET",
      url: "/dashboard/api/overview",
      headers: { authorization: "Bearer local-dashboard-token" },
    });

    expect(page.statusCode).toBe(200);
    expect(page.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(page.body).toContain("somente leitura");
    expect(denied.statusCode).toBe(401);
    expect(accepted.statusCode).toBe(200);
    expect(accepted.body).toContain('"capUsd":75');
    expect(accepted.body).toContain('"capUsd":25');
    const deliveries = await app.inject({
      method: "GET",
      url: "/dashboard/api/deliveries",
      headers: { authorization: "Bearer local-dashboard-token" },
    });
    const missionControl = await app.inject({
      method: "GET",
      url: "/dashboard/api/mission-control",
      headers: { authorization: "Bearer local-dashboard-token" },
    });
    expect(deliveries.statusCode).toBe(200);
    expect(missionControl.statusCode).toBe(200);
    expect(deliveriesMock).toHaveBeenCalledWith(undefined);
    expect(missionControlMock).toHaveBeenCalledWith(undefined);
    expect(missionControl.body).toContain('"generatedBy":"deterministic_rules"');
    expect(page.headers["referrer-policy"]).toBe("no-referrer");
    expect(page.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("serves a token-protected demand workspace and a stable 404", async () => {
    const existingTaskId = "10000000-0000-4000-8000-000000000001";
    demandWorkspaceMock.mockResolvedValueOnce({
      header: { taskId: existingTaskId },
    } as never);
    const app = createCoordinatorApp({
      dashboardService: dashboard,
      dashboardToken: "local-dashboard-token",
      logger: false,
    });
    apps.push(app);

    const accepted = await app.inject({
      method: "GET",
      url: `/dashboard/api/demand/${existingTaskId}`,
      headers: { authorization: "Bearer local-dashboard-token" },
    });
    const missing = await app.inject({
      method: "GET",
      url: "/dashboard/api/demand/20000000-0000-4000-8000-000000000002",
      headers: { authorization: "Bearer local-dashboard-token" },
    });

    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toEqual({ header: { taskId: existingTaskId } });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ code: "DEMAND_NOT_FOUND" });
  });

  it("does not expose write methods under /dashboard", async () => {
    const app = createCoordinatorApp({
      dashboardService: dashboard,
      dashboardToken: "local-dashboard-token",
      logger: false,
    });
    apps.push(app);

    for (const path of [
      "/dashboard/api/deliveries",
      "/dashboard/api/demand/10000000-0000-4000-8000-000000000001",
      "/dashboard/api/mission-control",
    ]) {
      for (const method of ["POST", "PUT", "PATCH", "DELETE"] as const) {
        const response = await app.inject({
          method,
          url: path,
          headers: { authorization: "Bearer local-dashboard-token" },
        });
        expect(response.statusCode).toBe(404);
      }
    }
  });

  it("rejects the dashboard shell and data outside loopback", async () => {
    const app = createCoordinatorApp({
      dashboardService: dashboard,
      dashboardToken: "local-dashboard-token",
      logger: false,
    });
    apps.push(app);

    const page = await app.inject({
      method: "GET",
      url: "/dashboard",
      remoteAddress: "192.0.2.10",
    });
    const data = await app.inject({
      method: "GET",
      url: "/dashboard/api/mission-control",
      headers: { authorization: "Bearer local-dashboard-token" },
      remoteAddress: "192.0.2.10",
    });

    expect(page.statusCode).toBe(403);
    expect(data.statusCode).toBe(403);
  });

  it("allows the read-only dashboard remotely only when explicitly enabled", async () => {
    const app = createCoordinatorApp({
      dashboardRemoteAccessEnabled: true,
      dashboardService: dashboard,
      dashboardToken: "local-dashboard-token",
      logger: false,
    });
    apps.push(app);

    const page = await app.inject({
      method: "GET",
      url: "/dashboard",
      remoteAddress: "192.0.2.10",
    });
    const denied = await app.inject({
      method: "GET",
      url: "/dashboard/api/mission-control",
      remoteAddress: "192.0.2.10",
    });
    const accepted = await app.inject({
      method: "GET",
      url: "/dashboard/api/mission-control",
      headers: { authorization: "Bearer local-dashboard-token" },
      remoteAddress: "192.0.2.10",
    });

    expect(page.statusCode).toBe(200);
    expect(denied.statusCode).toBe(401);
    expect(accepted.statusCode).toBe(200);
  });
});
