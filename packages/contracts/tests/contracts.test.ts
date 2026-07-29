import { describe, expect, it } from "vitest";

import { demandWorkspaceResponseSchema, missionControlResponseSchema } from "../src/index.js";

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
});
