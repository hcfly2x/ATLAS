import { randomUUID } from "node:crypto";

import { PrismaClient, ProjectStatus } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AgentRequest, AgentResponse, AgentRuntime } from "@atlas/agent-runtime";
import { InvalidTaskTransitionError, TaskStateMachine } from "@atlas/core";
import {
  canonicalPayloadHash,
  complexityClassificationSchema,
  executableSpecificationPayloadSchema,
  normalizedDemandSchema,
  specificationContentSchema,
} from "@atlas/shared";

import { PrismaTaskCoreStore } from "./prisma-task-core-store.js";
import { PrismaSupervisorStore } from "../supervisor/prisma-supervisor-store.js";
import { SupervisorService } from "../supervisor/service.js";
import { ApprovalTargetHashMismatchError, PrismaTelegramStore } from "../telegram/store.js";

const prisma = new PrismaClient();
const store = new PrismaTaskCoreStore(prisma);
const machine = new TaskStateMachine(store);
const telegramStore = new PrismaTelegramStore(prisma);

class IntegrationAgentRuntime implements AgentRuntime {
  run<Output>(request: AgentRequest<Output>): Promise<AgentResponse<Output>> {
    const fixture =
      request.agentId === "normalizer"
        ? normalizedDemandSchema.parse({
            constraints: [],
            context: ["integration"],
            objective: "Generate a moderate specification",
            requested_actions: [],
          })
        : request.agentId === "complexity_router"
          ? complexityClassificationSchema.parse({
              complexity: "moderate",
              reasons: ["bounded change"],
            })
          : specificationContentSchema.parse({
              acceptance_criteria: ["persisted"],
              allowed_commands: [],
              approval_required_for: [],
              authorized_scope: ["docs/**"],
              constraints: [],
              context: ["integration"],
              expected_delivery: "Specification",
              implementation_strategy: ["persist"],
              objective: "Integration supervision",
              out_of_scope: ["worker"],
              required_tests: ["integration"],
            });
    return Promise.resolve({
      estimatedCostUsd: 0.001,
      inputTokens: 10,
      latencyMs: 1,
      model: request.model,
      output: request.outputSchema.parse(fixture),
      outputTokens: 10,
    });
  }
}

function specificationPayload(taskId: string, projectId: string, version = 1) {
  return executableSpecificationPayloadSchema.parse({
    acceptance_criteria: ["approved"],
    allowed_commands: [],
    approval_required_for: [],
    authorized_scope: ["docs/**"],
    constraints: [],
    context: [],
    expected_delivery: "documented result",
    implementation_strategy: ["apply scoped change"],
    objective: "integration specification",
    out_of_scope: [],
    project_id: projectId,
    required_tests: ["pnpm test"],
    risk_level: "moderate",
    task_id: taskId,
    version,
  });
}

beforeAll(async () => prisma.$connect());
afterAll(async () => prisma.$disconnect());

describe("Prisma core persistence", () => {
  it("persists idempotent Task transitions and append-only audit events atomically", async () => {
    const projectId = `integration-${randomUUID()}`;
    await prisma.project.create({
      data: {
        allowedCommands: [],
        dataClassification: "internal_test",
        id: projectId,
        name: "Integration Test",
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
        status: ProjectStatus.DRAFT,
      },
    });

    const created = await store.createTask({
      correlationId: "integration-create",
      idempotencyKey: `create-${randomUUID()}`,
      origin: "integration-test",
      originalMessage: "test persistence",
      projectId,
    });
    const transitioned = await machine.transition({
      actor: "system",
      correlationId: "integration-transition",
      expectedVersion: 0,
      idempotencyKey: `transition-${randomUUID()}`,
      taskId: created.task.id,
      toState: "NORMALIZING",
    });

    expect(transitioned.task).toMatchObject({ state: "NORMALIZING", version: 1 });
    expect(
      await prisma.auditEvent.count({
        where: { taskId: created.task.id },
      }),
    ).toBe(2);

    await expect(
      machine.transition({
        actor: "system",
        correlationId: "integration-invalid",
        expectedVersion: 1,
        idempotencyKey: `invalid-${randomUUID()}`,
        taskId: created.task.id,
        toState: "COMPLETED",
      }),
    ).rejects.toBeInstanceOf(InvalidTaskTransitionError);
    expect(
      await prisma.auditEvent.count({
        where: {
          action: "task.transition.rejected",
          taskId: created.task.id,
        },
      }),
    ).toBe(1);

    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: { taskId: created.task.id },
    });
    await expect(
      prisma.auditEvent.update({
        where: { id: audit.id },
        data: { action: "forbidden-update" },
      }),
    ).rejects.toThrow(/append-only/);
  });

  it("enforces immutable Specification versions and Execution linkage", async () => {
    const projectId = `integration-${randomUUID()}`;
    const project = await prisma.project.create({
      data: {
        allowedCommands: [],
        dataClassification: "internal_test",
        id: projectId,
        name: "Specification Integration Test",
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
      },
    });
    const task = await prisma.task.create({
      data: {
        idempotencyKey: `task-${randomUUID()}`,
        origin: "integration-test",
        originalMessage: "test immutable specification",
        projectId: project.id,
      },
    });
    const specification = await prisma.specification.create({
      data: {
        payload: { objective: "integration test" },
        payloadHash: `hash-${randomUUID()}`,
        taskId: task.id,
        version: 1,
      },
    });
    const execution = await prisma.execution.create({
      data: {
        attempt: 1,
        idempotencyKey: `execution-${randomUUID()}`,
        specificationId: specification.id,
        taskId: task.id,
      },
    });

    expect(execution.specificationId).toBe(specification.id);
    await expect(
      prisma.specification.update({
        where: { id: specification.id },
        data: { payloadHash: "forbidden-update" },
      }),
    ).rejects.toThrow(/immutable/);
  });

  it("persists Telegram update replay, project selection and versioned approval decisions", async () => {
    const projectId = `telegram-${randomUUID()}`;
    await prisma.project.create({
      data: {
        allowedCommands: [],
        dataClassification: "internal_test",
        id: projectId,
        name: "Telegram Integration Test",
        policy: "least_privilege",
        protectedPathsProfile: "project_default",
        requiredTools: {},
        retention: { audit_events_expire: false, files_days: 1, logs_days: 1 },
        risk: "low",
      },
    });
    await telegramStore.selectProject(42n, 100n, projectId);
    expect(await telegramStore.getSelectedProject(42n)).toMatchObject({ id: projectId });

    const responses = [{ text: "persisted response" }];
    await telegramStore.recordProcessedUpdate({
      chatId: 100n,
      responses,
      updateId: 9001n,
      userId: 42n,
    });
    expect(await telegramStore.findProcessedUpdate(9001n)).toEqual(responses);

    const task = await prisma.task.create({
      data: {
        idempotencyKey: `telegram-task-${randomUUID()}`,
        origin: "telegram:42",
        originalMessage: "approve this",
        projectId,
      },
    });
    const payload = specificationPayload(task.id, projectId, 3);
    const payloadHash = canonicalPayloadHash(payload);
    const specification = await prisma.specification.create({
      data: { payload, payloadHash, taskId: task.id, version: payload.version },
    });
    await prisma.task.update({
      where: { id: task.id },
      data: {
        activeSpecificationId: specification.id,
        state: "WAITING_APPROVAL",
      },
    });
    const approval = await prisma.approval.create({
      data: {
        channel: "TELEGRAM",
        idempotencyKey: `approval-${randomUUID()}`,
        presentedPayload: payload,
        requestedBy: "system",
        targetHash: payloadHash,
        targetId: specification.id,
        targetType: "SPECIFICATION",
        targetVersion: 3,
        taskId: task.id,
        type: "PRE_EXECUTION",
      },
    });
    const decided = await telegramStore.decideApproval({
      approvalId: approval.id,
      callbackId: "integration-callback",
      correlationId: "integration-telegram",
      decision: "APPROVED",
      userId: 42n,
    });

    expect(decided.approval).toMatchObject({
      targetHash: payloadHash,
      targetId: specification.id,
      targetVersion: 3,
    });
    expect(
      await prisma.auditEvent.findUnique({
        where: { idempotencyKey: "telegram:callback:integration-callback:approval" },
      }),
    ).not.toBeNull();
  });

  it("rejects a stale Specification approval hash and persists an AuditEvent", async () => {
    const projectId = `approval-hash-${randomUUID()}`;
    await prisma.project.create({
      data: {
        allowedCommands: [],
        dataClassification: "internal_test",
        id: projectId,
        name: "Approval Hash Test",
        policy: "least_privilege",
        protectedPathsProfile: "project_default",
        requiredTools: {},
        retention: { audit_events_expire: false, files_days: 1, logs_days: 1 },
        risk: "low",
      },
    });
    const task = await prisma.task.create({
      data: {
        idempotencyKey: `hash-task-${randomUUID()}`,
        origin: "telegram:84",
        originalMessage: "reject stale approval",
        projectId,
      },
    });
    const payload = specificationPayload(task.id, projectId);
    const payloadHash = canonicalPayloadHash(payload);
    const specification = await prisma.specification.create({
      data: { payload, payloadHash, taskId: task.id, version: 1 },
    });
    await prisma.task.update({
      where: { id: task.id },
      data: {
        activeSpecificationId: specification.id,
        state: "WAITING_APPROVAL",
      },
    });
    const approval = await prisma.approval.create({
      data: {
        channel: "TELEGRAM",
        idempotencyKey: `hash-approval-${randomUUID()}`,
        presentedPayload: payload,
        requestedBy: "system",
        targetHash: "sha256:stale",
        targetId: specification.id,
        targetType: "SPECIFICATION",
        targetVersion: 1,
        taskId: task.id,
        type: "PRE_EXECUTION",
      },
    });

    await expect(
      telegramStore.decideApproval({
        approvalId: approval.id,
        callbackId: "hash-mismatch-callback",
        correlationId: "hash-mismatch-correlation",
        decision: "APPROVED",
        userId: 84n,
      }),
    ).rejects.toBeInstanceOf(ApprovalTargetHashMismatchError);

    expect(await prisma.approval.findUniqueOrThrow({ where: { id: approval.id } })).toMatchObject({
      status: "PENDING",
    });
    expect(
      await prisma.auditEvent.findUnique({
        where: {
          idempotencyKey: "telegram:callback:hash-mismatch-callback:approval:hash-mismatch",
        },
      }),
    ).not.toBeNull();
  });

  it("persists a moderate level-2 Specification with system policy Approval and LLM usage", async () => {
    const projectId = `supervisor-${randomUUID()}`;
    await prisma.project.create({
      data: {
        allowedCommands: [],
        autonomyLevel: 2,
        dataClassification: "internal_test",
        id: projectId,
        name: "Supervisor Integration Test",
        policy: "least_privilege",
        protectedPathsProfile: "project_default",
        requiredTools: {},
        retention: { audit_events_expire: false, files_days: 1, logs_days: 1 },
        risk: "low",
      },
    });
    const created = await store.createTask({
      correlationId: "supervisor-create",
      idempotencyKey: `supervisor-task-${randomUUID()}`,
      origin: "integration-test",
      originalMessage: "create a bounded documentation change",
      projectId,
    });
    const service = new SupervisorService({
      alwaysHuman: new Set(["production_secret_change"]),
      monthlyBudgetUsd: 25,
      runtime: new IntegrationAgentRuntime(),
      store: new PrismaSupervisorStore(prisma),
      taskStore: store,
    });

    const result = await service.processTask(created.task.id, "supervisor-integration-correlation");

    expect(result.state).toBe("QUEUED");
    const task = await prisma.task.findUniqueOrThrow({
      where: { id: created.task.id },
      include: { activeSpecification: true, approvals: true, llmCalls: true },
    });
    expect(task).toMatchObject({ complexity: "MODERATE", state: "QUEUED", version: 4 });
    expect(task.llmCalls).toHaveLength(3);
    expect(task.approvals).toEqual([
      expect.objectContaining({
        actor: "SYSTEM",
        channel: "POLICY",
        status: "APPROVED",
      }),
    ]);
    const activeSpecification = task.activeSpecification;
    expect(activeSpecification).not.toBeNull();
    expect(activeSpecification?.payloadHash).toBe(
      canonicalPayloadHash(
        executableSpecificationPayloadSchema.parse(activeSpecification?.payload),
      ),
    );
  });
});
