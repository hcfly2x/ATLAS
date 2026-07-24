import { afterEach, describe, expect, it, vi } from "vitest";

import { createCoordinatorApp } from "../app.js";
import type { DashboardService } from "./service.js";

const dashboard = {
  audit: vi.fn(() => Promise.resolve([])),
  memory: vi.fn(() => Promise.resolve([])),
  overview: vi.fn(() =>
    Promise.resolve({
      costs: {
        codex: { capUsd: 75, spentUsd: 0 },
        llm: { capUsd: 25, spentUsd: 0 },
        periodDays: 30,
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
  it("serves a loopback shell and protects all data with a token", async () => {
    const app = createCoordinatorApp({
      dashboardService: dashboard,
      dashboardToken: "local-dashboard-token",
      logger: false,
    });
    apps.push(app);

    const page = await app.inject({ method: "GET", url: "/dashboard" });
    const denied = await app.inject({ method: "GET", url: "/dashboard/api/overview" });
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
    expect(accepted.json().costs).toMatchObject({
      codex: { capUsd: 75 },
      llm: { capUsd: 25 },
    });
  });

  it("does not expose write methods under /dashboard", async () => {
    const app = createCoordinatorApp({
      dashboardService: dashboard,
      dashboardToken: "local-dashboard-token",
      logger: false,
    });
    apps.push(app);

    for (const method of ["POST", "PUT", "PATCH", "DELETE"] as const) {
      const response = await app.inject({
        method,
        url: "/dashboard/api/tasks",
        headers: { authorization: "Bearer local-dashboard-token" },
      });
      expect(response.statusCode).toBe(404);
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
      url: "/dashboard/api/overview",
      headers: { authorization: "Bearer local-dashboard-token" },
      remoteAddress: "192.0.2.10",
    });

    expect(page.statusCode).toBe(403);
    expect(data.statusCode).toBe(403);
  });
});
