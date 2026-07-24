import { afterEach, describe, expect, it } from "vitest";

import { createCoordinatorApp } from "./app.js";

const apps: ReturnType<typeof createCoordinatorApp>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

describe("coordinator foundation", () => {
  it("reports health with a correlation id", async () => {
    const app = createCoordinatorApp();
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/health",
      headers: { "x-correlation-id": "phase-1-test" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      service: "coordinator",
      status: "ok",
      log: {
        context: {
          correlationId: "phase-1-test",
          service: "coordinator",
        },
      },
    });
  });
});
