import { randomUUID } from "node:crypto";

import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createWorkerResult } from "@atlas/shared";

import { PrismaMemoryService, MemoryConflictError, MemoryTaskScopeError } from "./service.js";
import { WorkerService } from "../worker/service.js";

const prisma = new PrismaClient();
const service = new PrismaMemoryService(prisma);

async function project(id: string) {
  return prisma.project.create({
    data: {
      allowedCommands: [],
      dataClassification: "internal_test",
      id,
      name: id,
      policy: "least_privilege",
      protectedPathsProfile: "project_default",
      requiredTools: {},
      retention: { audit_events_expire: false, files_days: 1, logs_days: 1 },
      risk: "low",
    },
  });
}

beforeAll(async () => prisma.$connect());
afterAll(async () => prisma.$disconnect());

describe("Prisma project memory", () => {
  it("persists idempotently, audits, and never crosses project scope", async () => {
    const atlas = await project(`memory-atlas-${randomUUID()}`);
    const course = await project(`memory-course-${randomUUID()}`);
    const task = await prisma.task.create({
      data: {
        idempotencyKey: `memory-task-${randomUUID()}`,
        origin: "integration",
        originalMessage: "remember",
        projectId: atlas.id,
      },
    });
    const idempotencyKey = `memory-${randomUUID()}`;
    const created = await service.create(
      atlas.id,
      {
        content: "Use deterministic context",
        idempotencyKey,
        taskId: task.id,
        type: "decision",
      },
      "memory-integration",
    );
    const replay = await service.create(
      atlas.id,
      {
        content: "Use deterministic context",
        idempotencyKey,
        taskId: task.id,
        type: "decision",
      },
      "memory-integration-replay",
    );

    expect(created.replayed).toBe(false);
    expect(replay).toMatchObject({ replayed: true, item: { id: created.item.id } });
    expect(await service.list({ limit: 10, projectId: course.id })).toEqual([]);
    expect((await service.getContext(atlas.id, task.id)).text).toContain(
      "Use deterministic context",
    );
    expect(
      await prisma.auditEvent.findUnique({
        where: { idempotencyKey: `memory-created:${idempotencyKey}` },
      }),
    ).not.toBeNull();
    await expect(
      prisma.memoryItem.update({
        where: { id: created.item.id },
        data: { content: "forbidden mutation" },
      }),
    ).rejects.toThrow(/append-only/);

    await expect(
      service.create(
        course.id,
        {
          content: "wrong scope",
          idempotencyKey: `memory-scope-${randomUUID()}`,
          taskId: task.id,
          type: "summary",
        },
        "memory-scope",
      ),
    ).rejects.toBeInstanceOf(MemoryTaskScopeError);
    await expect(
      service.create(
        atlas.id,
        {
          content: "changed",
          idempotencyKey,
          taskId: task.id,
          type: "decision",
        },
        "memory-conflict",
      ),
    ).rejects.toBeInstanceOf(MemoryConflictError);
  });

  it("creates an audited task summary when finalization completes", async () => {
    const projectRecord = await project(`memory-finalize-${randomUUID()}`);
    const task = await prisma.task.create({
      data: {
        idempotencyKey: `memory-finalize-task-${randomUUID()}`,
        origin: "integration",
        originalMessage: "finish",
        projectId: projectRecord.id,
        state: "FINALIZING",
      },
    });
    const specification = await prisma.specification.create({
      data: {
        payload: {
          acceptance_criteria: ["Persist the completion summary"],
          allowed_commands: [],
          approval_required_for: [],
          authorized_scope: ["task completion memory"],
          constraints: [],
          context: [],
          delivery_mode: "repository_change",
          expected_delivery: "Audited task summary",
          implementation_strategy: ["Finalize the completed execution"],
          objective: "Persist completion memory during finalization",
          out_of_scope: [],
          project_id: projectRecord.id,
          required_tests: ["Prisma memory integration"],
          risk_level: "moderate",
          task_id: task.id,
          version: 1,
        },
        payloadHash: `sha256:${"a".repeat(64)}`,
        taskId: task.id,
        version: 1,
      },
    });
    const worker = await prisma.worker.create({
      data: {
        capabilities: {},
        name: "memory-finalizer",
        projectScopes: [projectRecord.id],
        status: "BUSY",
        tokenHash: `token-${randomUUID()}`,
      },
    });
    const executionId = randomUUID();
    const leaseId = randomUUID();
    const result = createWorkerResult({
      changed_paths: [],
      codex_estimated_cost_usd: 0,
      commands: [],
      contract_version: "1.0",
      diff_hash: `sha256:${"b".repeat(64)}`,
      diff_ref: `execution:${executionId}:diff`,
      diff_summary: {
        deletions: 0,
        description: "memory phase complete",
        files_changed: 0,
        insertions: 0,
      },
      error: null,
      execution_id: executionId,
      failure_stage: null,
      finished_at: "2026-07-24T14:01:00.000Z",
      idempotency_key: `result-${executionId}`,
      log_chunks: [],
      logs_truncated: false,
      pending_items: [],
      protected_path_matches: [],
      redaction_applied: true,
      risks: [],
      sequence: 1,
      specification_hash: specification.payloadHash,
      specification_id: specification.id,
      specification_version: 1,
      started_at: "2026-07-24T14:00:00.000Z",
      status: "succeeded",
      summary: "Persist this completion summary",
      task_id: task.id,
      tests: [],
      worker_id: worker.id,
    });
    await prisma.execution.create({
      data: {
        attempt: 1,
        fencingToken: 1,
        id: executionId,
        idempotencyKey: `execution-${executionId}`,
        leaseExpiresAt: new Date(Date.now() + 60_000),
        leaseId,
        resultHash: result.result_hash,
        resultPayload: result,
        specificationId: specification.id,
        status: "FINALIZING",
        taskId: task.id,
        workerId: worker.id,
      },
    });
    const workerService = new WorkerService({
      codexMonthlyBudgetUsd: 75,
      leaseDurationMs: 60_000,
      prisma,
      protectedGlobsByProject: new Map(),
    });

    await workerService.finalize({
      commitSha: "abc123",
      executionId,
      fencingToken: 1n,
      idempotencyKey: `finalize-${executionId}`,
      leaseId,
      pullRequestUrl: "https://example.invalid/pull/1",
      workerId: worker.id,
    });

    expect(
      await prisma.memoryItem.findFirst({ where: { taskId: task.id, type: "SUMMARY" } }),
    ).toMatchObject({ content: "Persist this completion summary", projectId: projectRecord.id });
    expect(
      await prisma.auditEvent.findUnique({
        where: { idempotencyKey: `audit:task-summary:${executionId}` },
      }),
    ).not.toBeNull();
  });
});
