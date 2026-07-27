import { describe, expect, it } from "vitest";

import { DashboardService } from "./service.js";

describe("DashboardService", () => {
  it("serializes BigInt fencing tokens in read-only Task detail", async () => {
    const prisma = {
      task: {
        findUnique: () =>
          Promise.resolve({
            approvals: [],
            executions: [{ fencingToken: 9n, id: "execution-1" }],
            id: "task-1",
            specifications: [],
          }),
      },
    };
    const service = new DashboardService(prisma as never);

    await expect(service.task("task-1")).resolves.toMatchObject({
      executions: [{ fencingToken: "9" }],
    });
  });

  it("exposes delivery health without message text or destination identifiers", async () => {
    let query: unknown;
    const prisma = {
      resultDeliveryOutbox: {
        findMany: (input: unknown) => {
          query = input;
          return Promise.resolve([
            {
              attempts: 1,
              createdAt: new Date("2026-07-28T00:00:00.000Z"),
              deliveredAt: null,
              id: "delivery-1",
              lastError: null,
              nextAttemptAt: new Date("2026-07-28T00:00:01.000Z"),
              projectId: "atlas",
              status: "PENDING",
              taskId: "10000000-0000-4000-8000-000000000001",
              taskVersion: 4,
              updatedAt: new Date("2026-07-28T00:00:00.000Z"),
            },
          ]);
        },
      },
    };
    const service = new DashboardService(prisma as never, {
      deliverySlaMs: 60_000,
      now: () => new Date("2026-07-28T00:02:00.000Z"),
    });

    await expect(service.deliveries("atlas")).resolves.toMatchObject([
      {
        health: "SLA_EXCEEDED",
        projectId: "atlas",
        status: "PENDING",
      },
    ]);
    expect(query).toMatchObject({
      select: {
        attempts: true,
        lastError: true,
        projectId: true,
        taskId: true,
      },
      where: { projectId: "atlas" },
    });
    expect(JSON.stringify(query)).not.toContain("messageText");
    expect(JSON.stringify(query)).not.toContain("destinationChatId");
    expect(JSON.stringify(query)).not.toContain("destinationUserId");
  });
});
