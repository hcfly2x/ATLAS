import { describe, expect, it } from "vitest";

import { DashboardService } from "../../../apps/coordinator/src/dashboard/service.js";
import { missionControlResponseSchema } from "../src/index.js";

const emptyPrisma = {
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

describe("missionControlResponseSchema", () => {
  it("accepts the serialized response produced by the real DashboardService", async () => {
    const service = new DashboardService(emptyPrisma as never, {
      now: () => new Date("2026-07-29T12:00:00.000Z"),
    });
    const wireResponse = JSON.parse(
      JSON.stringify(await service.missionControl("atlas")),
    ) as unknown;

    expect(missionControlResponseSchema.parse(wireResponse)).toEqual(wireResponse);
  });

  it("rejects an unexpected sensitive field", async () => {
    const service = new DashboardService(emptyPrisma as never, {
      now: () => new Date("2026-07-29T12:00:00.000Z"),
    });
    const wireResponse = missionControlResponseSchema.parse(
      JSON.parse(JSON.stringify(await service.missionControl("atlas"))) as unknown,
    );

    expect(() =>
      missionControlResponseSchema.parse({
        ...wireResponse,
        messageText: "must-not-cross-the-contract",
      }),
    ).toThrow();
  });
});
