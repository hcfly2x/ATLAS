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
});
