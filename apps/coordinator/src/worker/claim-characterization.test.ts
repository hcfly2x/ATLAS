import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { canonicalPayloadHash, executableSpecificationPayloadSchema } from "@atlas/shared";

import { TASK_CLAIM_AGING_THRESHOLD_MS, WorkerConflictError, WorkerService } from "./service.js";

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
  it("selects an aged Task first and claims its pre-created Execution only after CAS", async () => {
    const taskId = randomUUID();
    const activeSpecification = specification(taskId);
    const task = {
      activeSpecification,
      failureStage: null,
      id: taskId,
      project: project(),
      projectId,
      priority: 0,
      state: "QUEUED",
      version: 4,
    };
    const queued = {
      fencingToken: 7n,
      id: randomUUID(),
      leaseExpiresAt: null,
      leaseId: null,
      specification: activeSpecification,
      task,
      taskId,
      workerId: null,
    };
    const taskUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const taskFindFirst = vi.fn().mockResolvedValue(task);
    const executionFindFirst = vi.fn().mockResolvedValue(queued);
    const executionUpdate = vi.fn(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({
        ...queued,
        ...data,
      }),
    );
    const transaction = {
      auditEvent: { create: vi.fn().mockResolvedValue({}) },
      codexUsage: { create: vi.fn().mockResolvedValue({}) },
      execution: {
        findFirst: executionFindFirst,
        findUnique: vi.fn().mockResolvedValue(null),
        update: executionUpdate,
      },
      task: { findFirst: taskFindFirst, updateMany: taskUpdateMany },
      worker: { update: vi.fn().mockResolvedValue({}) },
    };

    const assignment = await serviceWithTransaction(transaction).claim(
      { id: workerId, projectScopes: [projectId] },
      "claim-pre-created",
      now,
    );

    expect(TASK_CLAIM_AGING_THRESHOLD_MS).toBe(86_400_000);
    expect(taskFindFirst.mock.calls[0]?.[0]).toMatchObject({
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      where: {
        createdAt: { lt: new Date("2026-08-02T12:00:00.000Z") },
        state: "QUEUED",
      },
    });
    expect(executionFindFirst.mock.calls[0]?.[0]).toMatchObject({
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      where: { status: "QUEUED", taskId },
    });
    expect(taskUpdateMany).toHaveBeenCalledWith({
      data: { state: "RUNNING", version: { increment: 1 } },
      where: { id: taskId, state: "QUEUED", version: 4 },
    });
    expect(taskUpdateMany.mock.invocationCallOrder[0]).toBeLessThan(
      executionUpdate.mock.invocationCallOrder[0] ?? 0,
    );
    expect(assignment).toMatchObject({
      execution_id: queued.id,
      fencing_token: "7",
      lease_expires_at: "2026-08-03T12:01:00.000Z",
      task_id: taskId,
    });
  });

  it("rolls back the bare Task path before creating an Execution when CAS loses", async () => {
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
    const executionCreate = vi.fn();
    const transaction = {
      execution: {
        count: vi.fn().mockResolvedValue(0),
        create: executionCreate,
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
    expect(taskUpdateMany).toHaveBeenCalledWith({
      data: { state: "RUNNING", version: { increment: 1 } },
      where: { id: taskId, state: "QUEUED", version: 9 },
    });
    expect(executionCreate).not.toHaveBeenCalled();
  });

  it("does not mutate a pre-created Execution when its Task CAS loses", async () => {
    const taskId = randomUUID();
    const activeSpecification = specification(taskId);
    const task = {
      activeSpecification,
      failureStage: null,
      id: taskId,
      project: project(),
      projectId,
      priority: 20,
      state: "QUEUED",
      version: 3,
    };
    const executionUpdate = vi.fn();
    const transaction = {
      execution: {
        findFirst: vi.fn().mockResolvedValue({
          fencingToken: 8n,
          id: randomUUID(),
          specification: activeSpecification,
          task,
          taskId,
        }),
        findUnique: vi.fn().mockResolvedValue(null),
        update: executionUpdate,
      },
      task: {
        findFirst: vi.fn().mockResolvedValue(task),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    };

    await expect(
      serviceWithTransaction(transaction).claim(
        { id: workerId, projectScopes: [projectId] },
        "claim-pre-created-cas-conflict",
        now,
      ),
    ).rejects.toEqual(new WorkerConflictError("task was claimed concurrently"));
    expect(executionUpdate).not.toHaveBeenCalled();
  });

  it("uses priority, then createdAt and id only when no aged Task is eligible", async () => {
    const taskFindFirst = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    const transaction = {
      execution: { findUnique: vi.fn().mockResolvedValue(null) },
      task: { findFirst: taskFindFirst },
    };

    await expect(
      serviceWithTransaction(transaction).claim(
        { id: workerId, projectScopes: [projectId] },
        "claim-priority-order",
        now,
      ),
    ).resolves.toBeNull();

    expect(taskFindFirst).toHaveBeenCalledTimes(2);
    expect(taskFindFirst.mock.calls[1]?.[0]).toMatchObject({
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }, { id: "asc" }],
      where: {
        activeSpecificationId: { not: null },
        project: { status: "ACTIVE" },
        projectId: { in: [projectId] },
        state: "QUEUED",
      },
    });
  });
});
