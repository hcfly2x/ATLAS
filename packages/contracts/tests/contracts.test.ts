import { describe, expect, it } from "vitest";

import {
  approvalDecisionRequestSchema,
  approvalDecisionResponseSchema,
  cancelDashboardTaskRequestSchema,
  createDashboardDemandRequestSchema,
  dashboardSessionResponseSchema,
  demandWorkspaceResponseSchema,
  missionControlResponseSchema,
  pauseDashboardTaskRequestSchema,
  resumeDashboardTaskRequestSchema,
  setDashboardTaskPriorityRequestSchema,
} from "../src/index.js";

const missionControlFixture = {
  blocked: { count: 0, items: [], status: "available" },
  generatedAt: "2026-07-29T12:00:00.000Z",
  inProgress: { count: 0, items: [], status: "available" },
  intelligence: {
    facts: [],
    generatedBy: "deterministic_rules",
    headline: "Nenhuma prioridade derivada",
    status: "available",
  },
  methodology: {
    cost: "declared_task_cost_limit",
    eta: "indeterminado",
    pendingQuestions: "indeterminado",
    progress: "task_state",
    recentWindowDays: 7,
  },
  needsAttention: { count: 0, items: [], status: "available" },
  priorityNow: { item: null, status: "available" },
  projectId: "atlas",
  recentlyCompleted: { count: 0, items: [], status: "available" },
  risks: { count: 0, items: [], status: "available" },
  unavailableSignals: [],
};

const demandWorkspaceFixture = {
  approvals: [],
  cost: {
    currency: "USD",
    estimatedUsd: "indeterminado",
    methodology: "persisted_estimates",
  },
  demand: { objective: "indeterminado" },
  executions: [],
  generatedAt: "2026-07-29T12:00:00.000Z",
  header: {
    autonomyLevel: 2,
    createdAt: "2026-07-29T09:00:00.000Z",
    deliveryMode: "indeterminado",
    executionState: "indeterminado",
    originChannel: "telegram",
    project: { id: "atlas", name: "ATLAS" },
    risk: "moderate",
    taskId: "10000000-0000-4000-8000-000000000001",
    taskState: "NEW",
    taskVersion: 0,
    updatedAt: "2026-07-29T09:01:00.000Z",
  },
  memory: {
    byType: { DECISION: 0, NOTE: 0, SUMMARY: 0 },
    total: 0,
  },
  plan: {
    acceptanceCriteria: "indeterminado",
    implementationStrategy: "indeterminado",
    specificationVersion: "indeterminado",
  },
  qa: [],
  timeline: [],
};

describe("@atlas/contracts dashboard schemas", () => {
  it("accepts valid Mission Control and demand Workspace fixtures", () => {
    expect(missionControlResponseSchema.parse(missionControlFixture)).toEqual(
      missionControlFixture,
    );
    expect(demandWorkspaceResponseSchema.parse(demandWorkspaceFixture)).toEqual(
      demandWorkspaceFixture,
    );
  });

  it("rejects unexpected fields at both public boundaries", () => {
    expect(() =>
      missionControlResponseSchema.parse({
        ...missionControlFixture,
        messageText: "must-not-cross-the-contract",
      }),
    ).toThrow();
    expect(() =>
      demandWorkspaceResponseSchema.parse({
        ...demandWorkspaceFixture,
        payload: "must-not-cross-the-contract",
      }),
    ).toThrow();
  });

  it("validates the session-bound approval decision contract strictly", () => {
    const request = {
      comment: "Ajustar critérios",
      decision: "request_change",
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
      targetVersion: 3,
      taskVersion: 7,
    };
    expect(approvalDecisionRequestSchema.parse(request)).toEqual(request);
    expect(() =>
      approvalDecisionRequestSchema.parse({
        ...request,
        comment: undefined,
      }),
    ).toThrow();
    expect(
      dashboardSessionResponseSchema.parse({
        csrfToken: "a".repeat(43),
        expiresAt: "2026-07-29T12:00:00.000Z",
        role: "owner",
      }),
    ).toBeDefined();
    expect(
      approvalDecisionResponseSchema.parse({
        approvalId: "22222222-2222-4222-8222-222222222222",
        decision: "approve",
        idempotentReplay: false,
        status: "APPROVED",
        task: {
          id: "33333333-3333-4333-8333-333333333333",
          state: "QUEUED",
          version: 8,
        },
      }),
    ).toBeDefined();
  });

  it("validates create and cancel commands strictly", () => {
    const create = {
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
      objective: "Planejar a melhoria",
      projectId: "atlas",
    };
    expect(createDashboardDemandRequestSchema.parse(create)).toEqual(create);
    expect(() =>
      createDashboardDemandRequestSchema.parse({ ...create, objective: "   " }),
    ).toThrow();
    expect(() =>
      createDashboardDemandRequestSchema.parse({ ...create, payload: "SECRET_PAYLOAD" }),
    ).toThrow();

    const cancel = {
      idempotencyKey: "22222222-2222-4222-8222-222222222222",
      reason: "Não é mais necessário",
      taskVersion: 7,
    };
    expect(cancelDashboardTaskRequestSchema.parse(cancel)).toEqual(cancel);
    expect(() => cancelDashboardTaskRequestSchema.parse({ ...cancel, taskVersion: -1 })).toThrow();
    expect(() =>
      cancelDashboardTaskRequestSchema.parse({ ...cancel, messageText: "SECRET" }),
    ).toThrow();
  });

  it("validates pause, resume and priority commands strictly", () => {
    const versioned = {
      idempotencyKey: "33333333-3333-4333-8333-333333333333",
      taskVersion: 8,
    };
    expect(pauseDashboardTaskRequestSchema.parse(versioned)).toEqual(versioned);
    expect(resumeDashboardTaskRequestSchema.parse(versioned)).toEqual(versioned);
    expect(() =>
      pauseDashboardTaskRequestSchema.parse({ ...versioned, destination: "QUEUED" }),
    ).toThrow();
    expect(() =>
      resumeDashboardTaskRequestSchema.parse({ ...versioned, payload: "SECRET" }),
    ).toThrow();

    for (const priority of [0, 10, 20] as const) {
      expect(setDashboardTaskPriorityRequestSchema.parse({ ...versioned, priority })).toEqual({
        ...versioned,
        priority,
      });
    }
    for (const priority of [-1, 5, 30]) {
      expect(() =>
        setDashboardTaskPriorityRequestSchema.parse({ ...versioned, priority }),
      ).toThrow();
    }
  });
});
