import { demandWorkspaceResponseSchema, missionControlResponseSchema } from "@atlas/contracts";
import { describe, expect, it } from "vitest";

import { DashboardService } from "./service.js";

const taskId = "10000000-0000-4000-8000-000000000001";

const missionControlPrisma = {
  approval: { findMany: () => Promise.resolve([]) },
  codexUsage: { groupBy: () => Promise.resolve([]) },
  llmCall: { groupBy: () => Promise.resolve([]) },
  postExecutionReview: { findMany: () => Promise.resolve([]) },
  project: { findMany: () => Promise.resolve([]) },
  resultDeliveryOutbox: {
    count: () => Promise.resolve(0),
    findMany: () => Promise.resolve([]),
    groupBy: () => Promise.resolve([]),
  },
  task: { findMany: () => Promise.resolve([]) },
};

const demandWorkspacePrisma = {
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

describe("DashboardService public contracts", () => {
  it("serializes Mission Control in the shared contract", async () => {
    const service = new DashboardService(missionControlPrisma as never, {
      now: () => new Date("2026-07-29T12:00:00.000Z"),
    });
    const wireResponse = JSON.parse(
      JSON.stringify(await service.missionControl("atlas")),
    ) as unknown;

    expect(missionControlResponseSchema.parse(wireResponse)).toEqual(wireResponse);
  });

  it("serializes a demand Workspace in the shared contract", async () => {
    const service = new DashboardService(demandWorkspacePrisma as never, {
      now: () => new Date("2026-07-29T12:00:00.000Z"),
    });
    const wireResponse = JSON.parse(
      JSON.stringify(await service.demandWorkspace(taskId)),
    ) as unknown;

    expect(demandWorkspaceResponseSchema.parse(wireResponse)).toEqual(wireResponse);
  });
});
