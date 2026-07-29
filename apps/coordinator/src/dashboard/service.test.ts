import { describe, expect, it, vi } from "vitest";

import { DashboardService } from "./service.js";

const now = new Date("2026-07-29T12:00:00.000Z");
const taskId = "10000000-0000-4000-8000-000000000001";

function workTask(state: string, updatedAt = new Date("2026-07-29T10:00:00.000Z")) {
  return {
    complexity: "MODERATE",
    id: taskId,
    projectId: "atlas",
    state,
    updatedAt,
    version: 4,
  };
}

function missionPrisma(options: { readonly failApprovals?: boolean } = {}) {
  const write = vi.fn(() => {
    throw new Error("read-only projection attempted a write");
  });
  return {
    approval: {
      create: write,
      findMany: () =>
        options.failApprovals
          ? Promise.reject(new Error("approval signal unavailable"))
          : Promise.resolve([
              {
                expiresAt: new Date("2026-07-29T11:00:00.000Z"),
                id: "approval-1",
                presentedPayload: "SECRET_APPROVAL_PAYLOAD",
                requestedAt: new Date("2026-07-29T09:00:00.000Z"),
                task: { id: taskId, projectId: "atlas" },
              },
            ]),
      update: write,
    },
    codexUsage: {
      groupBy: () =>
        Promise.resolve([
          {
            _max: { createdAt: new Date("2026-07-29T09:30:00.000Z") },
            _sum: { estimatedCostUsd: 0.5 },
            projectId: "atlas",
            taskId,
          },
        ]),
    },
    llmCall: {
      groupBy: () =>
        Promise.resolve([
          {
            _max: { createdAt: new Date("2026-07-29T09:00:00.000Z") },
            _sum: { estimatedCostUsd: 3 },
            projectId: "atlas",
            taskId,
          },
        ]),
    },
    postExecutionReview: {
      findMany: () =>
        Promise.resolve([
          {
            id: "review-1",
            payload: "SECRET_REVIEW_PAYLOAD",
            reviewedAt: new Date("2026-07-29T08:00:00.000Z"),
            status: "REJECTED",
            task: { id: taskId, projectId: "atlas" },
            updatedAt: new Date("2026-07-29T08:00:00.000Z"),
          },
          {
            id: "review-2",
            reviewedAt: new Date("2026-07-29T08:30:00.000Z"),
            status: "FAILED",
            task: {
              id: "20000000-0000-4000-8000-000000000002",
              projectId: "atlas",
            },
            updatedAt: new Date("2026-07-29T08:30:00.000Z"),
          },
        ]),
    },
    project: {
      findMany: () => Promise.resolve([{ id: "atlas", taskCostLimitUsd: 2 }]),
    },
    resultDeliveryOutbox: {
      findMany: () =>
        Promise.resolve([
          {
            createdAt: new Date("2026-07-29T07:00:00.000Z"),
            destinationChatId: "SECRET_CHAT",
            id: "delivery-1",
            messageText: "SECRET_MESSAGE",
            projectId: "atlas",
            status: "DELIVERY_FAILED",
            taskId,
          },
        ]),
      update: write,
    },
    task: {
      findMany: (input: {
        readonly where: {
          readonly origin?: unknown;
          readonly state: { readonly in: readonly string[] };
        };
      }) => {
        if (input.where.origin !== undefined) return Promise.resolve([]);
        if (input.where.state.in.includes("NORMALIZING")) {
          return Promise.resolve([workTask("RUNNING")]);
        }
        if (input.where.state.in.includes("WAITING_APPROVAL")) {
          return Promise.resolve([workTask("WAITING_APPROVAL")]);
        }
        if (input.where.state.in.length === 1 && input.where.state.in.includes("COMPLETED")) {
          return Promise.resolve([workTask("COMPLETED")]);
        }
        return Promise.resolve([]);
      },
      update: write,
    },
    write,
  };
}

describe("DashboardService", () => {
  it("serializes BigInt fencing tokens in safe read-only Task detail", async () => {
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

  it("derives Mission Control, priority, proactive risks and indeterminate ETA from existing signals", async () => {
    const prisma = missionPrisma();
    const service = new DashboardService(prisma as never, { now: () => now });

    const result = await service.missionControl("atlas");

    expect(result.intelligence).toMatchObject({
      generatedBy: "deterministic_rules",
      headline: "Entrega terminal falhou",
      status: "available",
    });
    expect(result.needsAttention).toMatchObject({
      count: 1,
      items: [{ kind: "approval_expired", taskId }],
      status: "available",
    });
    expect(result.inProgress).toMatchObject({
      items: [
        {
          eta: "indeterminado",
          progress: { methodology: "task_state", stage: "RUNNING" },
        },
      ],
    });
    expect(result.recentlyCompleted).toMatchObject({
      count: 1,
      items: [{ state: "COMPLETED", taskId }],
    });
    expect(result.risks.items.map((item) => item.kind)).toEqual([
      "delivery_failed",
      "review_unavailable",
      "approval_expired",
      "task_cost_limit_exceeded",
      "rework_required",
      "task_blocked",
    ]);
    expect(result.methodology).toEqual({
      cost: "declared_task_cost_limit",
      eta: "indeterminado",
      pendingQuestions: "indeterminado",
      progress: "task_state",
      recentWindowDays: 7,
    });
    expect(prisma.write).not.toHaveBeenCalled();
    const serialized = JSON.stringify(result);
    for (const forbidden of [
      "SECRET_APPROVAL_PAYLOAD",
      "SECRET_REVIEW_PAYLOAD",
      "SECRET_CHAT",
      "SECRET_MESSAGE",
      "messageText",
      "destinationChatId",
      "destinationUserId",
      "originalMessage",
      "presentedPayload",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("marks one unavailable signal indeterminate without taking down the other Home blocks", async () => {
    const service = new DashboardService(missionPrisma({ failApprovals: true }) as never, {
      now: () => now,
    });

    const result = await service.missionControl("atlas");

    expect(result.needsAttention).toEqual({
      count: "indeterminado",
      items: [],
      reason: "signal_unavailable",
      status: "indeterminate",
    });
    expect(result.inProgress.status).toBe("available");
    expect(result.blocked.status).toBe("available");
    expect(result.recentlyCompleted.status).toBe("available");
    expect(result.intelligence.status).toBe("partial");
    expect(result.unavailableSignals).toContain("attention");
  });

  it("queries legacy dashboard views with safe metadata only", async () => {
    const queries: Record<string, unknown> = {};
    const prisma = {
      auditEvent: {
        findMany: (input: unknown) => {
          queries.audit = input;
          return Promise.resolve([]);
        },
      },
      memoryItem: {
        findMany: (input: unknown) => {
          queries.memory = input;
          return Promise.resolve([]);
        },
      },
      task: {
        findMany: (input: unknown) => {
          queries.tasks = input;
          return Promise.resolve([]);
        },
        findUnique: (input: unknown) => {
          queries.task = input;
          return Promise.resolve(null);
        },
      },
    };
    const service = new DashboardService(prisma as never);

    await Promise.all([
      service.audit("atlas"),
      service.memory("atlas"),
      service.task(taskId),
      service.tasks("atlas"),
    ]);

    const serializedQueries = JSON.stringify(queries);
    for (const forbidden of [
      "originalMessage",
      "normalizedDemand",
      "presentedPayload",
      "resultPayload",
      '"payload":true',
      '"content":true',
      '"commands":true',
      '"worktree":true',
    ]) {
      expect(serializedQueries).not.toContain(forbidden);
    }
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
              taskId,
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
