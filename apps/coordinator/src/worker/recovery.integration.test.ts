import { randomUUID } from "node:crypto";

import {
  ExecutionStatus,
  PrismaClient,
  ProjectStatus,
  TaskState,
  WorkerStatus,
} from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { canonicalPayloadHash, executableSpecificationPayloadSchema } from "@atlas/shared";

import { WorkerService } from "./service.js";

const prisma = new PrismaClient();

beforeAll(async () => prisma.$connect());
afterAll(async () => prisma.$disconnect());

describe("expired FINALIZING recovery", () => {
  it("fails and fences an expired finalization without scheduling another Codex execution", async () => {
    const suffix = randomUUID();
    const projectId = `recovery-${suffix}`;
    const taskId = randomUUID();
    const specificationId = randomUUID();
    const workerId = randomUUID();
    const executionId = randomUUID();
    const before = new Date("2026-07-25T12:00:00.000Z");
    const expiredAt = new Date(before.getTime() - 1_000);
    const payload = executableSpecificationPayloadSchema.parse({
      acceptance_criteria: ["terminal recovery is audited"],
      allowed_commands: [],
      approval_required_for: [],
      authorized_scope: ["docs/**"],
      constraints: [],
      context: [],
      expected_delivery: "terminal result",
      implementation_strategy: ["recover safely"],
      objective: "Recover an expired finalization",
      out_of_scope: [],
      project_id: projectId,
      required_tests: [],
      risk_level: "moderate",
      task_id: taskId,
      version: 1,
    });
    await prisma.project.create({
      data: {
        allowedCommands: [],
        dataClassification: "internal_test",
        id: projectId,
        name: "Durable recovery test",
        policy: "least_privilege",
        protectedPathsProfile: "project_default",
        requiredTools: {},
        retention: {
          audit_events_expire: false,
          files_days: 1,
          logs_days: 1,
          sensitive_days: null,
        },
        risk: "low",
        status: ProjectStatus.ACTIVE,
      },
    });
    await prisma.task.create({
      data: {
        id: taskId,
        idempotencyKey: `task-${suffix}`,
        origin: "integration-test",
        originalMessage: "Recover expired finalization",
        projectId,
        state: TaskState.FINALIZING,
        version: 7,
      },
    });
    await prisma.specification.create({
      data: {
        id: specificationId,
        payload,
        payloadHash: canonicalPayloadHash(payload),
        taskId,
        version: 1,
      },
    });
    await prisma.task.update({
      where: { id: taskId },
      data: { activeSpecificationId: specificationId },
    });
    await prisma.worker.create({
      data: {
        capabilities: {},
        id: workerId,
        name: "Recovery worker",
        projectScopes: [projectId],
        status: WorkerStatus.BUSY,
        tokenHash: `token-${suffix}`,
      },
    });
    await prisma.execution.create({
      data: {
        attempt: 1,
        fencingToken: 3n,
        id: executionId,
        idempotencyKey: `execution-${suffix}`,
        leaseExpiresAt: expiredAt,
        leaseId: `lease-${suffix}`,
        resultPayload: { status: "succeeded" },
        specificationId,
        status: ExecutionStatus.FINALIZING,
        taskId,
        workerId,
      },
    });

    const service = new WorkerService({
      codexMonthlyBudgetUsd: 75,
      leaseDurationMs: 30_000,
      prisma,
      protectedGlobsByProject: new Map([[projectId, []]]),
    });

    expect(await service.reconcileExpiredFinalizations(new Date(expiredAt.getTime() - 1))).toBe(0);
    expect(await service.reconcileExpiredFinalizations(before)).toBe(1);
    expect(await service.reconcileExpiredFinalizations(before)).toBe(0);

    expect(await prisma.task.findUniqueOrThrow({ where: { id: taskId } })).toMatchObject({
      failureStage: "finalizing",
      state: TaskState.FAILED,
      version: 8,
    });
    expect(await prisma.execution.findUniqueOrThrow({ where: { id: executionId } })).toMatchObject({
      failureStage: "finalizing",
      leaseExpiresAt: null,
      leaseId: null,
      reconciledAt: before,
      status: ExecutionStatus.FAILED,
    });
    expect(await prisma.worker.findUniqueOrThrow({ where: { id: workerId } })).toMatchObject({
      status: WorkerStatus.IDLE,
    });
    expect(await prisma.execution.count({ where: { taskId } })).toBe(1);
    expect(
      await prisma.auditEvent.findFirst({
        where: { action: "execution.finalization_reconciled", taskId },
      }),
    ).toMatchObject({
      payload: expect.objectContaining({
        action: "failed_without_codex_retry",
        reason: "lease_expired_before_finalization",
      }),
    });
  });
});
