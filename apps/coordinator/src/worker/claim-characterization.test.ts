import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { canonicalPayloadHash, executableSpecificationPayloadSchema } from "@atlas/shared";

import { WorkerConflictError, WorkerService } from "./service.js";

const now = new Date("2026-08-03T12:00:00.000Z");
const projectId = "claim-characterization";
const workerId = randomUUID();

function specification(taskId: string) {
  const payload = executableSpecificationPayloadSchema.parse({
    acceptance_criteria: ["characterized"],
    allowed_commands: [],
    approval_required_for: [],
    authorized_scope: ["docs/**"],
    constraints: [],
    context: [],
    expected_delivery: "tests",
    implementation_strategy: ["observe only"],
    objective: "characterize the current claim",
    out_of_scope: [],
    project_id: projectId,
    required_tests: ["pnpm test"],
    risk_level: "moderate",
    task_id: taskId,
    version: 1,
  });
  return {
    id: randomUUID(),
    payload,
    payloadHash: canonicalPayloadHash(payload),
    version: 1,
  };
}

function project() {
  return {
    allowedCommands: [],
    autonomyLevel: 2,
    repository: "/tmp/atlas-claim-characterization",
    requiredTools: { codex_cli: null, git: null, gnu_tools: [], node: null },
    runtime: null,
  };
}

function serviceWithTransaction(transaction: object) {
  const prisma = {
    codexUsage: { aggregate: vi.fn().mockResolvedValue({ _sum: { estimatedCostUsd: null } }) },
    execution: { findUnique: vi.fn().mockResolvedValue(null) },
    worker: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({
        _count: { executions: 0 },
        concurrencyLimit: 1,
      }),
    },
    $transaction: vi.fn((operation: (client: object) => unknown) =>
      Promise.resolve(operation(transaction)),
    ),
  } as unknown as PrismaClient;
  return new WorkerService({
    codexMonthlyBudgetUsd: 75,
    leaseDurationMs: 60_000,
    prisma,
    protectedGlobsByProject: new Map([[projectId, ["**/.env*"]]]),
  });
}

describe("WorkerService claim characterization", () => {
  it("keeps the pre-created Execution path FIFO and updates Task by id without CAS", async () => {
    const taskId = randomUUID();
    const task = {
      failureStage: null,
      id: taskId,
      project: project(),
      projectId,
      state: "QUEUED",
      version: 4,
    };
    const queued = {
      fencingToken: 7n,
      id: randomUUID(),
      leaseExpiresAt: null,
      leaseId: null,
      specification: specification(taskId),
      task,
      taskId,
      workerId: null,
    };
    const taskUpdate = vi.fn().mockResolvedValue({ ...task, state: "RUNNING", version: 5 });
    const executionFindFirst = vi.fn().mockResolvedValue(queued);
    const transaction = {
      auditEvent: { create: vi.fn().mockResolvedValue({}) },
      codexUsage: { create: vi.fn().mockResolvedValue({}) },
      execution: {
        findFirst: executionFindFirst,
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn(({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({
            ...queued,
            ...data,
          }),
        ),
      },
      task: { update: taskUpdate },
      worker: { update: vi.fn().mockResolvedValue({}) },
    };

    const assignment = await serviceWithTransaction(transaction).claim(
      { id: workerId, projectScopes: [projectId] },
      "claim-pre-created",
      now,
    );

    expect(executionFindFirst.mock.calls[0]?.[0]).toMatchObject({
      orderBy: { createdAt: "asc" },
      where: { task: { state: "QUEUED" } },
    });
    expect(taskUpdate).toHaveBeenCalledWith({
      data: { state: "RUNNING", version: { increment: 1 } },
      where: { id: taskId },
    });
    expect(assignment).toMatchObject({
      execution_id: queued.id,
      fencing_token: "7",
      lease_expires_at: "2026-08-03T12:01:00.000Z",
      task_id: taskId,
    });
  });

  it("keeps the bare Task path FIFO and rejects a lost state+version CAS", async () => {
    const taskId = randomUUID();
    const activeSpecification = specification(taskId);
    const task = {
      activeSpecification,
      failureStage: null,
      id: taskId,
      project: project(),
      projectId,
      state: "QUEUED",
      version: 9,
    };
    const taskFindFirst = vi.fn().mockResolvedValue(task);
    const taskUpdateMany = vi.fn().mockResolvedValue({ count: 0 });
    const transaction = {
      execution: {
        count: vi.fn().mockResolvedValue(0),
        create: vi.fn().mockResolvedValue({
          fencingToken: 1n,
          id: randomUUID(),
          leaseExpiresAt: new Date("2026-08-03T12:01:00.000Z"),
          leaseId: randomUUID(),
          specification: activeSpecification,
          task,
        }),
        findFirst: vi.fn().mockResolvedValue(null),
        findUnique: vi.fn().mockResolvedValue(null),
      },
      task: { findFirst: taskFindFirst, updateMany: taskUpdateMany },
    };

    await expect(
      serviceWithTransaction(transaction).claim(
        { id: workerId, projectScopes: [projectId] },
        "claim-bare-cas-conflict",
        now,
      ),
    ).rejects.toEqual(new WorkerConflictError("task was claimed concurrently"));
    expect(taskFindFirst.mock.calls[0]?.[0]).toMatchObject({
      orderBy: { createdAt: "asc" },
      where: { state: "QUEUED" },
    });
    expect(taskUpdateMany).toHaveBeenCalledWith({
      data: { state: "RUNNING", version: { increment: 1 } },
      where: { id: taskId, state: "QUEUED", version: 9 },
    });
  });
});
