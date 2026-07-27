import { createHash, randomUUID } from "node:crypto";

import { PrismaClient, ProjectStatus } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AgentRequest, AgentResponse, AgentRuntime } from "@atlas/agent-runtime";
import { InvalidTaskTransitionError, TaskStateMachine } from "@atlas/core";
import {
  canonicalPayloadHash,
  complexityClassificationSchema,
  createWorkerResult,
  divergenceAnalysisSchema,
  executableSpecificationPayloadSchema,
  normalizedDemandSchema,
  specialistOpinionSchema,
  specificationContentSchema,
} from "@atlas/shared";

import { PrismaTaskCoreStore } from "./prisma-task-core-store.js";
import type { CouncilConfig } from "../supervisor/council-config.js";
import { PrismaSupervisorStore } from "../supervisor/prisma-supervisor-store.js";
import { SupervisorService } from "../supervisor/service.js";
import { ApprovalTargetHashMismatchError, PrismaTelegramStore } from "../telegram/store.js";
import {
  CodexMonthlyBudgetExceededError,
  WorkerConflictError,
  WorkerLeaseError,
  WorkerService,
} from "../worker/service.js";

const prisma = new PrismaClient();
const store = new PrismaTaskCoreStore(prisma);
const machine = new TaskStateMachine(store);
const telegramStore = new PrismaTelegramStore(prisma);

class IntegrationAgentRuntime implements AgentRuntime {
  run<Output>(request: AgentRequest<Output>): Promise<AgentResponse<Output>> {
    const fixture =
      request.outputSchemaName === "normalized_demand"
        ? normalizedDemandSchema.parse({
            constraints: [],
            context: ["integration"],
            objective: "Generate a moderate specification",
            requested_actions: [],
          })
        : request.outputSchemaName === "complexity_classification"
          ? complexityClassificationSchema.parse({
              complexity: "moderate",
              reasons: ["bounded change"],
            })
          : request.outputSchemaName.startsWith("specialist_opinion_")
            ? specialistOpinionSchema.parse({
                acceptance_criteria: ["persisted"],
                confidence: 0.9,
                findings: ["bounded"],
                recommendation: "proceed",
                risks: [],
                understanding: "integration council opinion",
                unresolved_questions: [],
              })
            : request.outputSchemaName === "material_divergence_analysis"
              ? divergenceAnalysisSchema.parse({
                  material_divergences: [],
                  revision_requests: [],
                })
              : request.outputSchemaName === "final_divergence_analysis"
                ? divergenceAnalysisSchema.parse({
                    material_divergences: [],
                    revision_requests: [],
                  })
                : specificationContentSchema.parse({
                    acceptance_criteria: ["persisted"],
                    allowed_commands: [],
                    approval_required_for: [],
                    authorized_scope: ["docs/**"],
                    constraints: [],
                    context: ["integration"],
                    delivery_mode: "repository_change",
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

const integrationCouncil: CouncilConfig = {
  agents: new Map(
    ["product", "project_context", "architect", "security", "qa", "engineering_supervisor"].map(
      (id) => [id, { id, instructions: `Act as ${id}` }],
    ),
  ),
  routes: {
    critical: [
      "product",
      "project_context",
      "architect",
      "security",
      "qa",
      "engineering_supervisor",
    ],
    moderate: ["project_context", "architect", "qa", "engineering_supervisor"],
    simple: ["project_context", "engineering_supervisor"],
  },
  supervisorId: "engineering_supervisor",
};

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
    await telegramStore.setVerboseLevel(42n, 100n, 2);
    expect(
      await prisma.telegramSession.findUnique({
        where: { userId: 42n },
        select: { verboseLevel: true },
      }),
    ).toEqual({ verboseLevel: 2 });

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
    const callbackId = `integration-callback-${randomUUID()}`;
    const decided = await telegramStore.decideApproval({
      approvalId: approval.id,
      callbackId,
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
        where: { idempotencyKey: `telegram:callback:${callbackId}:approval` },
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
        repository: "/tmp/atlas-supervisor-integration",
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
      council: integrationCouncil,
      monthlyBudgetUsd: 25,
      runtime: new IntegrationAgentRuntime(),
      store: new PrismaSupervisorStore(prisma),
      taskStore: store,
    });

    const result = await service.processTask(created.task.id, "supervisor-integration-correlation");

    expect(result.state).toBe("QUEUED");
    const task = await prisma.task.findUniqueOrThrow({
      where: { id: created.task.id },
      include: {
        activeSpecification: true,
        approvals: true,
        deliberations: { include: { opinions: true } },
        llmCalls: true,
      },
    });
    expect(task).toMatchObject({ complexity: "MODERATE", state: "QUEUED", version: 4 });
    expect(task.llmCalls).toHaveLength(7);
    expect(task.deliberations).toHaveLength(1);
    expect(task.deliberations[0]?.status).toBe("COMPLETED");
    expect(task.deliberations[0]?.opinions).toHaveLength(3);
    const opinionEvents = await prisma.auditEvent.findMany({
      where: { action: "agent.opinion.recorded", taskId: created.task.id },
    });
    expect(opinionEvents).toHaveLength(3);
    expect(
      opinionEvents.every(
        ({ correlationId }) => correlationId === "supervisor-integration-correlation",
      ),
    ).toBe(true);
    const roundEvents = await prisma.auditEvent.findMany({
      where: {
        action: { in: ["deliberation.round.started", "deliberation.round.completed"] },
        taskId: created.task.id,
      },
    });
    expect(roundEvents).toHaveLength(2);
    expect(
      roundEvents.every(
        ({ correlationId }) => correlationId === "supervisor-integration-correlation",
      ),
    ).toBe(true);
    const opinionId = task.deliberations[0]?.opinions[0]?.id;
    if (opinionId === undefined) {
      throw new Error("expected a persisted specialist opinion");
    }
    await expect(
      prisma.agentOpinion.update({
        where: { id: opinionId },
        data: { agentId: "mutated" },
      }),
    ).rejects.toThrow(/agent_opinions is append-only/);
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

  it("enforces worker lease, fencing, replay and automatic result policy", async () => {
    const projectId = `worker-${randomUUID()}`;
    const taskId = randomUUID();
    await prisma.project.create({
      data: {
        allowedCommands: [],
        autonomyLevel: 2,
        dataClassification: "internal_test",
        id: projectId,
        name: "Worker Integration Test",
        policy: "least_privilege",
        protectedPathsProfile: "project_default",
        repository: "/tmp/atlas-worker-integration",
        requiredTools: { codex_cli: null, git: null, gnu_tools: [], node: null },
        retention: { audit_events_expire: false, files_days: 1, logs_days: 1 },
        risk: "low",
        status: "ACTIVE",
      },
    });
    await prisma.task.create({
      data: {
        id: taskId,
        idempotencyKey: `worker-task-${taskId}`,
        origin: "integration-test",
        originalMessage: "execute a bounded change",
        projectId,
        state: "QUEUED",
      },
    });
    const payload = specificationPayload(taskId, projectId);
    const specification = await prisma.specification.create({
      data: {
        payload,
        payloadHash: canonicalPayloadHash(payload),
        taskId,
        version: 1,
      },
    });
    await prisma.task.update({
      where: { id: taskId },
      data: { activeSpecificationId: specification.id },
    });
    const service = new WorkerService({
      codexMonthlyBudgetUsd: 75,
      leaseDurationMs: 60_000,
      prisma,
      protectedGlobsByProject: new Map([[projectId, [".env*"]]]),
    });
    const token = `worker-token-${randomUUID()}`;
    const registration = await service.register({
      capabilities: {
        architecture: "arm64",
        codex_version: "codex 1.0.0",
        git_version: "git version 2.0.0",
        node_version: "v22.13.0",
        platform: "darwin",
        tools: {},
      },
      concurrencyLimit: 1,
      name: "integration-worker",
      projectScopes: [projectId],
      token,
    });
    const identity = await service.authenticate(token);
    const assignment = await service.claim(identity, `claim-${randomUUID()}`);
    expect(assignment).not.toBeNull();
    if (assignment === null) throw new Error("assignment expected");

    await expect(
      service.renewLease({
        executionId: assignment.execution_id,
        fencingToken: 0n,
        idempotencyKey: "stale-renewal",
        leaseId: assignment.lease_id,
        workerId: registration.workerId,
      }),
    ).rejects.toBeInstanceOf(WorkerLeaseError);

    const chunkContent = "sanitized output";
    const chunkChecksum = `sha256:${createHash("sha256").update(chunkContent).digest("hex")}`;
    const chunk = {
      checksum: chunkChecksum,
      content: chunkContent,
      executionId: assignment.execution_id,
      fencingToken: 1n,
      idempotencyKey: `log-${randomUUID()}`,
      leaseId: assignment.lease_id,
      sequence: 0,
      workerId: registration.workerId,
    };
    expect(await service.appendLog(chunk)).toEqual({ replayed: false });
    expect(await service.appendLog(chunk)).toEqual({ replayed: true });
    const changedContent = "changed";
    await expect(
      service.appendLog({
        ...chunk,
        checksum: `sha256:${createHash("sha256").update(changedContent).digest("hex")}`,
        content: changedContent,
      }),
    ).rejects.toBeInstanceOf(WorkerConflictError);

    const result = createWorkerResult({
      changed_paths: ["docs/readme.md"],
      codex_estimated_cost_usd: 1,
      commands: [
        {
          args: ["test"],
          executable: "/usr/local/bin/pnpm",
          exit_code: 0,
          finished_at: "2026-07-24T13:00:30.000Z",
          started_at: "2026-07-24T13:00:00.000Z",
          status: "passed",
        },
      ],
      contract_version: "1.0",
      diff_hash: `sha256:${"d".repeat(64)}`,
      diff_ref: `execution:${assignment.execution_id}:diff`,
      diff_summary: {
        deletions: 0,
        description: "one file",
        files_changed: 1,
        insertions: 1,
      },
      error: null,
      execution_id: assignment.execution_id,
      failure_stage: null,
      finished_at: "2026-07-24T13:01:00.000Z",
      idempotency_key: `result-${randomUUID()}`,
      log_chunks: [
        {
          checksum: chunkChecksum,
          created_at: "2026-07-24T13:00:15.000Z",
          sequence: 0,
          size_bytes: Buffer.byteLength(chunkContent),
        },
      ],
      logs_truncated: false,
      pending_items: [],
      protected_path_matches: [],
      redaction_applied: true,
      risks: [],
      sequence: 1,
      specification_hash: assignment.specification_hash,
      specification_id: assignment.specification_id,
      specification_version: assignment.specification_version,
      started_at: "2026-07-24T13:00:00.000Z",
      status: "succeeded",
      summary: "done",
      task_id: assignment.task_id,
      tests: [
        {
          command_index: 0,
          duration_ms: 30_000,
          name: "pnpm test",
          status: "passed",
          summary: "passed",
        },
      ],
      worker_id: registration.workerId,
    });
    expect(
      await service.submitResult({
        fencingToken: 1n,
        leaseId: assignment.lease_id,
        result,
        workerId: registration.workerId,
      }),
    ).toEqual({ replayed: false, state: "WAITING_RESULT_APPROVAL" });
    const persisted = await prisma.execution.findUniqueOrThrow({
      where: { id: assignment.execution_id },
      include: { codexUsage: true, task: { include: { approvals: true } } },
    });
    expect(persisted.status).toBe("AWAITING_RESULT_APPROVAL");
    expect(Number(persisted.codexUsage?.estimatedCostUsd)).toBe(1);
    expect(persisted.task.approvals).toEqual([
      expect.objectContaining({ actor: "SYSTEM", channel: "POLICY", status: "APPROVED" }),
    ]);
    await prisma.project.update({ where: { id: projectId }, data: { autonomyLevel: 3 } });
    await prisma.execution.update({
      where: { id: assignment.execution_id },
      data: {
        failureStage: "timeout",
        leaseExpiresAt: null,
        leaseId: null,
        status: "FAILED",
      },
    });
    await prisma.task.update({
      where: { id: taskId },
      data: { failureStage: "timeout", state: "FAILED" },
    });

    expect(await service.retryEligibleTechnicalFailures()).toBe(1);
    const attempts = await prisma.execution.findMany({
      where: { taskId },
      orderBy: { attempt: "asc" },
    });
    expect(attempts).toHaveLength(2);
    expect(attempts[1]).toMatchObject({ fencingToken: 2n, status: "QUEUED" });
    expect(await prisma.task.findUniqueOrThrow({ where: { id: taskId } })).toMatchObject({
      failureStage: null,
      state: "QUEUED",
    });
    await prisma.codexUsage.update({
      where: { executionId: assignment.execution_id },
      data: { estimatedCostUsd: 75 },
    });
    await expect(service.claim(identity, `budget-claim-${randomUUID()}`)).rejects.toBeInstanceOf(
      CodexMonthlyBudgetExceededError,
    );
    expect(
      await prisma.auditEvent.findFirst({
        where: { action: "codex.budget_blocked", projectId },
      }),
    ).not.toBeNull();
    await prisma.codexUsage.update({
      where: { executionId: assignment.execution_id },
      data: { estimatedCostUsd: 1 },
    });
    const retryAssignment = await service.claim(identity, `retry-claim-${randomUUID()}`);
    expect(retryAssignment).not.toBeNull();
    if (retryAssignment === null) throw new Error("retry assignment expected");
    expect(retryAssignment.fencing_token).toBe("2");
    await expect(
      service.appendLog({
        checksum: `sha256:${createHash("sha256").update("late").digest("hex")}`,
        content: "late",
        executionId: retryAssignment.execution_id,
        fencingToken: 1n,
        idempotencyKey: `late-log-${randomUUID()}`,
        leaseId: retryAssignment.lease_id,
        sequence: 0,
        workerId: registration.workerId,
      }),
    ).rejects.toBeInstanceOf(WorkerLeaseError);
    const { result_hash: _previousHash, ...previousResultContent } = result;
    expect(_previousHash).toMatch(/^sha256:/);
    const protectedResult = createWorkerResult({
      ...previousResultContent,
      execution_id: retryAssignment.execution_id,
      idempotency_key: `protected-result-${randomUUID()}`,
      log_chunks: [],
      protected_path_matches: [".env.local"],
      sequence: 1,
      worker_id: registration.workerId,
    });
    expect(
      await service.submitResult({
        fencingToken: 2n,
        leaseId: retryAssignment.lease_id,
        result: protectedResult,
        workerId: registration.workerId,
      }),
    ).toEqual({ replayed: false, state: "WAITING_RESULT_APPROVAL" });

    const cancelledTaskId = randomUUID();
    await prisma.task.create({
      data: {
        id: cancelledTaskId,
        idempotencyKey: `cancel-race-task-${cancelledTaskId}`,
        origin: "integration-test",
        originalMessage: "cancel while result is in flight",
        projectId,
        state: "QUEUED",
      },
    });
    const cancelledPayload = specificationPayload(cancelledTaskId, projectId);
    const cancelledSpecification = await prisma.specification.create({
      data: {
        payload: cancelledPayload,
        payloadHash: canonicalPayloadHash(cancelledPayload),
        taskId: cancelledTaskId,
        version: 1,
      },
    });
    await prisma.task.update({
      where: { id: cancelledTaskId },
      data: { activeSpecificationId: cancelledSpecification.id },
    });
    const secondToken = `worker-token-${randomUUID()}`;
    const secondRegistration = await service.register({
      capabilities: {
        architecture: "arm64",
        codex_version: "codex 1.0.0",
        git_version: "git version 2.0.0",
        node_version: "v22.13.0",
        platform: "darwin",
        tools: {},
      },
      concurrencyLimit: 1,
      name: "cancel-race-worker",
      projectScopes: [projectId],
      token: secondToken,
    });
    const cancelAssignment = await service.claim(
      await service.authenticate(secondToken),
      `cancel-race-claim-${randomUUID()}`,
    );
    expect(cancelAssignment).not.toBeNull();
    if (cancelAssignment === null) throw new Error("cancel assignment expected");
    await prisma.task.update({
      where: { id: cancelledTaskId },
      data: { state: "CANCEL_REQUESTED", version: { increment: 1 } },
    });
    const cancelledRaceResult = createWorkerResult({
      ...previousResultContent,
      execution_id: cancelAssignment.execution_id,
      idempotency_key: `cancel-race-result-${randomUUID()}`,
      log_chunks: [],
      specification_hash: cancelAssignment.specification_hash,
      specification_id: cancelAssignment.specification_id,
      specification_version: cancelAssignment.specification_version,
      task_id: cancelAssignment.task_id,
      worker_id: secondRegistration.workerId,
    });
    await expect(
      service.submitResult({
        fencingToken: BigInt(cancelAssignment.fencing_token),
        leaseId: cancelAssignment.lease_id,
        result: cancelledRaceResult,
        workerId: secondRegistration.workerId,
      }),
    ).rejects.toBeInstanceOf(WorkerConflictError);
    expect(await prisma.task.findUniqueOrThrow({ where: { id: cancelledTaskId } })).toMatchObject({
      state: "CANCEL_REQUESTED",
    });
    expect(
      await prisma.auditEvent.findUnique({
        where: {
          idempotencyKey: `audit:${cancelledRaceResult.idempotency_key}:transition-rejected`,
        },
      }),
    ).toMatchObject({ action: "task.transition.rejected" });
  });
});
