import { describe, expect, it } from "vitest";

import { DashboardService } from "../../../apps/coordinator/src/dashboard/service.js";
import { demandWorkspaceResponseSchema } from "../src/index.js";

const taskId = "10000000-0000-4000-8000-000000000001";

const prisma = {
  task: {
    findUnique: () =>
      Promise.resolve({
        approvals: [],
        auditEvents: [],
        codexUsages: [],
        createdAt: new Date("2026-07-29T09:00:00.000Z"),
        executions: [],
        id: taskId,
        llmCalls: [],
        memoryItems: [],
        normalizedDemand: null,
        origin: "telegram:42:-100500",
        project: {
          autonomyLevel: 2,
          id: "atlas",
          name: "ATLAS",
          risk: "moderate",
        },
        specifications: [],
        state: "NEW",
        updatedAt: new Date("2026-07-29T09:01:00.000Z"),
      }),
  },
};

describe("demandWorkspaceResponseSchema", () => {
  it("accepts the serialized response produced by the real DashboardService", async () => {
    const service = new DashboardService(prisma as never, {
      now: () => new Date("2026-07-29T12:00:00.000Z"),
    });
    const wireResponse = JSON.parse(
      JSON.stringify(await service.demandWorkspace(taskId)),
    ) as unknown;

    expect(demandWorkspaceResponseSchema.parse(wireResponse)).toEqual(wireResponse);
  });

  it("rejects unexpected fields at the workspace boundary", async () => {
    const service = new DashboardService(prisma as never, {
      now: () => new Date("2026-07-29T12:00:00.000Z"),
    });
    const wireResponse = demandWorkspaceResponseSchema.parse(
      JSON.parse(JSON.stringify(await service.demandWorkspace(taskId))) as unknown,
    );

    expect(() =>
      demandWorkspaceResponseSchema.parse({
        ...wireResponse,
        messageText: "must-not-cross-the-contract",
      }),
    ).toThrow();
  });
});
