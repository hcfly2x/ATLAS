import { describe, expect, it, vi } from "vitest";
import { createWorkerResult } from "@atlas/shared";

import { DashboardService, PROJECT_BOARD_COLUMN_BY_STATE } from "./service.js";

const now = new Date("2026-07-29T12:00:00.000Z");
const taskId = "10000000-0000-4000-8000-000000000001";
const hash = `sha256:${"a".repeat(64)}`;

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

function missionPrisma(
  options: { readonly failApprovals?: boolean; readonly reworkEscalated?: boolean } = {},
) {
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
                expiresAt: options.reworkEscalated ? null : new Date("2026-07-29T11:00:00.000Z"),
                id: "approval-1",
                presentedPayload: "SECRET_APPROVAL_PAYLOAD",
                requestedAt: new Date("2026-07-29T09:00:00.000Z"),
                requestedBy: options.reworkEscalated
                  ? "post-execution-rework-loop-breaker"
                  : "worker",
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

function demandWorkspaceTask() {
  return {
    approvals: [
      {
        actor: "USER",
        id: "approval-1",
        presentedPayload: { prompt: "SECRET_APPROVAL_PROMPT" },
        requestedAt: new Date("2026-07-29T09:15:00.000Z"),
        respondedAt: new Date("2026-07-29T09:16:00.000Z"),
        status: "REJECTED",
        targetVersion: 3,
        type: "RESULT",
      },
    ],
    auditEvents: [
      {
        action: "task.reviewed",
        correlationId: "correlation-1",
        createdAt: new Date("2026-07-29T09:20:00.000Z"),
        id: "audit-1",
        payload: { response: "SECRET_AUDIT_PAYLOAD" },
      },
    ],
    codexUsages: [{ estimatedCostUsd: 0.75 }],
    createdAt: new Date("2026-07-29T09:00:00.000Z"),
    executions: [
      {
        attempt: 1,
        commands: [{ args: ["SECRET_COMMAND_ARG"], executable: "pnpm" }],
        createdAt: new Date("2026-07-29T09:10:00.000Z"),
        empiricalReview: { payload: "SECRET_EMPIRICAL_PAYLOAD", verdict: "FAIL" },
        id: "execution-1",
        postExecutionReview: {
          empiricalVerdict: "FAIL",
          payload: "SECRET_REVIEW_PAYLOAD",
          reconciliationReason: "qa_empirical_failed",
          reviewerDecision: "REJECTED",
        },
        resultPayload: {
          messageText: "SECRET_RESULT_MESSAGE",
          payload: "SECRET_RESULT_PAYLOAD",
        },
        specification: { version: 3 },
        status: "AWAITING_RESULT_APPROVAL",
        updatedAt: new Date("2026-07-29T09:14:00.000Z"),
      },
    ],
    id: taskId,
    llmCalls: [{ estimatedCostUsd: 1.25 }],
    memoryItems: [
      { content: "SECRET_MEMORY_CONTENT", type: "DECISION" },
      { content: "SECRET_MEMORY_NOTE", type: "NOTE" },
    ],
    normalizedDemand: {
      context: ["Contexto exibível da demanda"],
      constraints: [],
      objective: "Corrigir o fluxo de entrega",
      prompt: "SECRET_NORMALIZATION_PROMPT",
      requested_actions: [],
    },
    origin: "telegram:42:-100500",
    originalMessage: "SECRET_ORIGINAL_MESSAGE",
    project: {
      autonomyLevel: 2,
      id: "atlas",
      name: "ATLAS",
      risk: "moderate",
    },
    specifications: [
      {
        deliveryMode: "REPOSITORY_CHANGE",
        id: "specification-1",
        payload: {
          acceptance_criteria: ["O resultado é entregue"],
          allowed_commands: ["pnpm test"],
          approval_required_for: [],
          authorized_scope: ["apps/coordinator"],
          constraints: [],
          context: [],
          delivery_mode: "repository_change",
          expected_delivery: "PR draft",
          implementation_strategy: ["Criar o read-model", "Validar o contrato"],
          model_response: "SECRET_MODEL_RESPONSE",
          objective: "Corrigir o fluxo de entrega",
          out_of_scope: [],
          project_id: "atlas",
          required_tests: ["pnpm test"],
          risk_level: "moderate",
          task_id: taskId,
          version: 3,
        },
        version: 3,
      },
    ],
    state: "WAITING_RESULT_APPROVAL",
    updatedAt: new Date("2026-07-29T09:20:00.000Z"),
  };
}

describe("DashboardService", () => {
  it("projects only safe execution evidence from a valid worker result", async () => {
    const task = demandWorkspaceTask();
    const resultPayload = createWorkerResult({
      codex_estimated_cost_usd: 0.5,
      commands: [
        {
          args: ["SECRET_VALID_RESULT_ARG"],
          executable: "pnpm",
          exit_code: 0,
          finished_at: "2026-07-29T09:10:03.000Z",
          started_at: "2026-07-29T09:10:01.000Z",
          status: "passed",
        },
      ],
      contract_version: "1.0",
      diff_hash: hash,
      diff_ref: "git-diff",
      diff_summary: {
        deletions: 2,
        description: "SECRET_DIFF_DESCRIPTION",
        files_changed: 3,
        insertions: 7,
      },
      error: null,
      execution_id: "20000000-0000-4000-8000-000000000002",
      failure_stage: null,
      finished_at: "2026-07-29T09:10:04.000Z",
      idempotency_key: "worker-result-1",
      log_chunks: [],
      logs_truncated: false,
      pending_items: [],
      protected_path_matches: [".env.local"],
      redaction_applied: true,
      risks: [],
      sequence: 1,
      specification_hash: hash,
      specification_id: "30000000-0000-4000-8000-000000000003",
      specification_version: 3,
      started_at: "2026-07-29T09:10:00.000Z",
      status: "succeeded",
      summary: "SECRET_RESULT_SUMMARY",
      task_id: taskId,
      tests: [],
      worker_id: "40000000-0000-4000-8000-000000000004",
      changed_paths: ["apps/coordinator/src/dashboard/service.ts"],
    });
    const taskWithResult = {
      ...task,
      executions: [
        {
          ...task.executions[0],
          resultPayload,
        },
      ],
    };
    const service = new DashboardService({
      task: { findUnique: () => Promise.resolve(taskWithResult) },
    } as never);

    const result = await service.demandWorkspace(taskId);

    expect(result?.executions[0]).toMatchObject({
      diffSummary: { deletions: 2, filesChanged: 3, insertions: 7 },
      durationMs: 4_000,
      executables: ["pnpm"],
      protectedPathMatchCount: 1,
      resultStatus: "succeeded",
    });
    expect(JSON.stringify(result)).not.toContain("SECRET_VALID_RESULT_ARG");
    expect(JSON.stringify(result)).not.toContain("SECRET_DIFF_DESCRIPTION");
    expect(JSON.stringify(result)).not.toContain("SECRET_RESULT_SUMMARY");
  });

  it("builds a sanitized read-only demand workspace with rejected QA", async () => {
    const write = vi.fn(() => {
      throw new Error("demand workspace attempted a write");
    });
    let query: unknown;
    const prisma = {
      task: {
        findUnique: (input: unknown) => {
          query = input;
          return Promise.resolve(demandWorkspaceTask());
        },
        update: write,
      },
      write,
    };
    const service = new DashboardService(prisma as never, { now: () => now });

    const result = await service.demandWorkspace(taskId);

    expect(result).toMatchObject({
      approvals: [
        {
          actor: "USER",
          status: "REJECTED",
          targetVersion: 3,
          type: "RESULT",
        },
      ],
      cost: {
        currency: "USD",
        estimatedUsd: 2,
        methodology: "persisted_estimates",
      },
      demand: { objective: "Corrigir o fluxo de entrega" },
      executions: [
        {
          attempt: 1,
          diffSummary: "indeterminado",
          durationMs: "indeterminado",
          executables: ["pnpm"],
          protectedPathMatchCount: "indeterminado",
          resultStatus: "indeterminado",
          status: "AWAITING_RESULT_APPROVAL",
        },
      ],
      header: {
        autonomyLevel: 2,
        deliveryMode: "repository_change",
        executionState: "AWAITING_RESULT_APPROVAL",
        originChannel: "telegram",
        risk: "moderate",
        taskId,
        taskState: "WAITING_RESULT_APPROVAL",
      },
      memory: {
        byType: { DECISION: 1, NOTE: 1, SUMMARY: 0 },
        total: 2,
      },
      plan: {
        acceptanceCriteria: ["O resultado é entregue"],
        implementationStrategy: ["Criar o read-model", "Validar o contrato"],
        specificationVersion: 3,
      },
      qa: [
        {
          empiricalVerdict: "FAIL",
          reconciliationReason: "qa_empirical_failed",
          reviewerDecision: "REJECTED",
        },
      ],
    });
    expect(write).not.toHaveBeenCalled();
    expect(query).toMatchObject({
      select: {
        auditEvents: { select: { action: true, correlationId: true, createdAt: true, id: true } },
        memoryItems: { select: { type: true } },
      },
      where: { id: taskId },
    });
    const serialized = JSON.stringify(result);
    for (const forbidden of [
      "SECRET_APPROVAL_PROMPT",
      "SECRET_AUDIT_PAYLOAD",
      "SECRET_COMMAND_ARG",
      "SECRET_EMPIRICAL_PAYLOAD",
      "SECRET_MEMORY_CONTENT",
      "SECRET_MEMORY_NOTE",
      "SECRET_MODEL_RESPONSE",
      "SECRET_NORMALIZATION_PROMPT",
      "SECRET_ORIGINAL_MESSAGE",
      "SECRET_RESULT_MESSAGE",
      "SECRET_RESULT_PAYLOAD",
      "args",
      "messageText",
      "payload",
      "prompt",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("uses explicit indeterminate values when demand workspace signals are absent", async () => {
    const task = demandWorkspaceTask();
    const service = new DashboardService({
      task: {
        findUnique: () =>
          Promise.resolve({
            ...task,
            approvals: [],
            codexUsages: [],
            executions: [],
            llmCalls: [],
            normalizedDemand: null,
            origin: "",
            specifications: [],
          }),
      },
    } as never);

    const result = await service.demandWorkspace(taskId);

    expect(result).toMatchObject({
      approvals: [],
      cost: { estimatedUsd: "indeterminado" },
      demand: { objective: "indeterminado" },
      executions: [],
      header: {
        deliveryMode: "indeterminado",
        executionState: "indeterminado",
        originChannel: "indeterminado",
      },
      plan: {
        acceptanceCriteria: "indeterminado",
        implementationStrategy: "indeterminado",
        specificationVersion: "indeterminado",
      },
      qa: [],
    });
  });

  it("returns null for an unknown demand", async () => {
    const service = new DashboardService({
      task: { findUnique: () => Promise.resolve(null) },
    } as never);

    await expect(service.demandWorkspace(taskId)).resolves.toBeNull();
  });

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

  it("surfaces a loop-breaker Approval as high-priority human rework", async () => {
    const service = new DashboardService(missionPrisma({ reworkEscalated: true }) as never, {
      now: () => now,
    });

    const result = await service.missionControl("atlas");

    expect(result.needsAttention).toMatchObject({
      count: 1,
      items: [
        {
          kind: "rework_required",
          label: "Retrabalho exige decisão humana",
          severity: "high",
          taskId,
        },
      ],
      status: "available",
    });
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

  it("maps every canonical state into one Projects board column", () => {
    expect(PROJECT_BOARD_COLUMN_BY_STATE).toEqual({
      CANCELLED: "stopped",
      CANCEL_REQUESTED: "stopped",
      COMPLETED: "completed",
      FAILED: "stopped",
      FINALIZING: "in_progress",
      NEW: "in_progress",
      NORMALIZING: "in_progress",
      PAUSED: "stopped",
      QUEUED: "in_progress",
      ROUTING: "in_progress",
      RUNNING: "in_progress",
      SPECIFYING: "in_progress",
      TESTING: "in_progress",
      WAITING_APPROVAL: "needs_attention",
      WAITING_RESULT_APPROVAL: "needs_attention",
    });
  });

  it("builds a safe read-only Projects board and never returns raw demand fields", async () => {
    let taskQuery: unknown;
    const write = vi.fn(() => {
      throw new Error("Projects board attempted a write");
    });
    const prisma = {
      project: {
        create: write,
        findMany: () =>
          Promise.resolve([
            { id: "atlas", name: "ATLAS", status: "ACTIVE" },
            { id: "future", name: "Futuro", status: "FUTURE" },
          ]),
        update: write,
      },
      task: {
        create: write,
        findMany: (input: unknown) => {
          taskQuery = input;
          return Promise.resolve([
            {
              activeSpecification: null,
              approvals: [{ id: "approval-1" }],
              id: taskId,
              normalizedDemand: {
                context: ["SECRET_CONTEXT"],
                constraints: [],
                objective: "Revisar entrega token=SECRET_TOKEN_VALUE",
                prompt: "SECRET_PROMPT",
                requested_actions: [],
              },
              originalMessage: "SECRET_ORIGINAL_MESSAGE",
              projectId: "atlas",
              state: "RUNNING",
              updatedAt: new Date("2026-08-04T11:00:00.000Z"),
            },
            {
              activeSpecification: null,
              approvals: [],
              id: "20000000-0000-4000-8000-000000000002",
              normalizedDemand: null,
              projectId: "future",
              state: "COMPLETED",
              updatedAt: new Date("2026-08-03T11:00:00.000Z"),
            },
          ]);
        },
        update: write,
      },
    };
    const service = new DashboardService(prisma as never, {
      now: () => new Date("2026-08-04T12:00:00.000Z"),
      projectDescriptions: new Map([
        ["atlas", "Orquestra demandas password=SECRET_PASSWORD_VALUE"],
      ]),
    });

    const board = await service.projectsBoard();
    const serialized = JSON.stringify(board);

    expect(board.projects[0]).toMatchObject({
      activeDemandCount: 1,
      description: "Orquestra demandas [conteúdo protegido]",
      hasActiveDemand: true,
      id: "atlas",
      isActive: true,
    });
    expect(board.projects[0]?.columns.needsAttention[0]).toMatchObject({
      column: "needs_attention",
      stateLabel: "Em execução",
    });
    expect(board.projects[1]).toMatchObject({
      activeDemandCount: 0,
      description: "sem descrição",
      hasActiveDemand: false,
      id: "future",
    });
    expect(write).not.toHaveBeenCalled();
    expect(taskQuery).toMatchObject({
      select: {
        activeSpecification: { select: { payload: true } },
        normalizedDemand: true,
      },
    });
    for (const forbidden of [
      "SECRET_CONTEXT",
      "SECRET_ORIGINAL_MESSAGE",
      "SECRET_PASSWORD_VALUE",
      "SECRET_PROMPT",
      "SECRET_TOKEN_VALUE",
      "originalMessage",
      "prompt",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});
