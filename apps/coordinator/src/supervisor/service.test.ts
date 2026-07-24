import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { AgentRequest, AgentResponse, AgentRuntime } from "@atlas/agent-runtime";
import type {
  CommitTransitionInput,
  CreateTaskResult,
  RejectedTransition,
  TaskCoreStore,
  TaskSnapshot,
  TaskTransitionResult,
} from "@atlas/core";
import {
  complexityClassificationSchema,
  divergenceAnalysisSchema,
  normalizedDemandSchema,
  specialistOpinionSchema,
  specificationContentSchema,
  type DivergenceAnalysis,
  type NormalizedDemand,
  type SpecialistOpinion,
  type TaskComplexity,
} from "@atlas/shared";

import type { CouncilConfig } from "./council-config.js";
import {
  LlmMonthlyBudgetExceededError,
  SupervisorService,
  type LlmCallRecord,
  type PersistSpecificationInput,
  type SupervisionTask,
  type SupervisorStore,
} from "./service.js";

const specificationContent = {
  acceptance_criteria: ["Specification is persisted"],
  allowed_commands: ["pnpm test"],
  approval_required_for: [],
  authorized_scope: ["packages/shared/**"],
  constraints: ["No worker execution"],
  context: ["Phase 4"],
  expected_delivery: "Versioned specification",
  implementation_strategy: ["Validate and persist"],
  objective: "Produce a specification",
  out_of_scope: ["Worker"],
  required_tests: ["unit"],
};

class FakeAgentRuntime implements AgentRuntime {
  calls = 0;
  readonly inputs: string[] = [];

  constructor(
    private readonly complexity: TaskComplexity,
    private readonly requestedActions: readonly string[] = [],
    private readonly materialDivergence = false,
    private readonly allowedCommands: readonly string[] = ["pnpm test"],
  ) {}

  run<Output>(request: AgentRequest<Output>): Promise<AgentResponse<Output>> {
    this.calls += 1;
    this.inputs.push(request.input);
    const fixture =
      request.outputSchemaName === "normalized_demand"
        ? normalizedDemandSchema.parse({
            constraints: [],
            context: [],
            objective: "Normalized objective",
            requested_actions: this.requestedActions,
          })
        : request.outputSchemaName === "complexity_classification"
          ? complexityClassificationSchema.parse({
              complexity: this.complexity,
              reasons: [`classified as ${this.complexity}`],
            })
          : request.outputSchemaName.startsWith("specialist_opinion_")
            ? specialistOpinionSchema.parse({
                acceptance_criteria: ["Keep the change bounded"],
                confidence: 0.8,
                findings: ["The request is feasible"],
                recommendation: "Proceed with tests",
                risks: [],
                understanding: "Review the requested change",
                unresolved_questions: [],
              })
            : request.outputSchemaName === "material_divergence_analysis"
              ? divergenceAnalysisSchema.parse({
                  material_divergences: this.materialDivergence
                    ? [
                        {
                          agent_ids: ["architect", "qa"],
                          description: "Testing boundary is disputed",
                          topic: "test strategy",
                        },
                      ]
                    : [],
                  revision_requests: this.materialDivergence
                    ? [{ agent_id: "architect", focus: "Reconcile the test boundary" }]
                    : [],
                })
              : request.outputSchemaName === "final_divergence_analysis"
                ? divergenceAnalysisSchema.parse({
                    material_divergences: [],
                    revision_requests: [],
                  })
                : specificationContentSchema.parse({
                    ...specificationContent,
                    allowed_commands: this.allowedCommands,
                  });
    return Promise.resolve({
      estimatedCostUsd: 0.01,
      inputTokens: 10,
      latencyMs: 5,
      model: request.model,
      output: request.outputSchema.parse(fixture),
      outputTokens: 20,
    });
  }
}

interface ApprovalRecord {
  readonly actor: PersistSpecificationInput["actor"];
  readonly channel: PersistSpecificationInput["channel"];
  readonly payloadHash: string;
  readonly status: PersistSpecificationInput["status"];
  readonly targetState: PersistSpecificationInput["targetState"];
}

class InMemorySupervisorStore implements SupervisorStore, TaskCoreStore {
  readonly approvals: ApprovalRecord[] = [];
  readonly calls: LlmCallRecord[] = [];
  readonly replays = new Map<string, TaskTransitionResult>();
  readonly rejected: RejectedTransition[] = [];
  budgetBlocked = false;
  complexity: TaskComplexity | undefined;
  monthlySpendUsd = 0;
  normalizedDemand: NormalizedDemand | undefined;
  readonly opinions: { agentId: string; opinion: SpecialistOpinion; round: 1 | 2 }[] = [];
  readonly rounds: { analysis?: DivergenceAnalysis; id: string; round: 1 | 2 }[] = [];

  constructor(public task: SupervisionTask) {}

  createTask(): Promise<CreateTaskResult> {
    return Promise.reject(new Error("not used"));
  }

  findReplay(idempotencyKey: string): Promise<TaskTransitionResult | undefined> {
    return Promise.resolve(this.replays.get(idempotencyKey));
  }

  getTask(taskId: string): Promise<SupervisionTask | undefined> {
    return Promise.resolve(taskId === this.task.id ? this.task : undefined);
  }

  commitTransition(input: CommitTransitionInput): Promise<TaskTransitionResult> {
    this.task = {
      ...this.task,
      ...(input.failureStage === undefined ? {} : { failureStage: input.failureStage }),
      state: input.toState,
      version: input.expectedVersion + 1,
    };
    const result = {
      auditEventId: randomUUID(),
      fromState: input.fromState,
      idempotentReplay: false,
      task: this.task,
    };
    this.replays.set(input.idempotencyKey, result);
    return Promise.resolve(result);
  }

  recordRejectedTransition(input: RejectedTransition): Promise<void> {
    this.rejected.push(input);
    return Promise.resolve();
  }

  getMonthlySpendUsd(): Promise<number> {
    return Promise.resolve(this.monthlySpendUsd);
  }

  recordBudgetBlocked(): Promise<void> {
    this.budgetBlocked = true;
    return Promise.resolve();
  }

  recordLlmCall(input: LlmCallRecord): Promise<void> {
    this.calls.push(input);
    return Promise.resolve();
  }

  createDeliberation(input: { round: 1 | 2 }): Promise<{ id: string }> {
    const record = { id: randomUUID(), round: input.round };
    this.rounds.push(record);
    return Promise.resolve(record);
  }

  persistAgentOpinion(input: {
    agentId: string;
    opinion: SpecialistOpinion;
    round: 1 | 2;
  }): Promise<void> {
    this.opinions.push(input);
    return Promise.resolve();
  }

  completeDeliberation(input: {
    analysis: DivergenceAnalysis;
    deliberationId: string;
  }): Promise<void> {
    const round = this.rounds.find(({ id }) => id === input.deliberationId);
    if (round !== undefined) {
      Object.assign(round, { analysis: input.analysis });
    }
    return Promise.resolve();
  }

  persistNormalizedDemand(input: { demand: NormalizedDemand }): Promise<void> {
    this.normalizedDemand = input.demand;
    return Promise.resolve();
  }

  persistComplexity(input: { complexity: TaskComplexity }): Promise<void> {
    this.complexity = input.complexity;
    return Promise.resolve();
  }

  nextSpecificationVersion(): Promise<number> {
    return Promise.resolve(1);
  }

  persistSpecification(input: PersistSpecificationInput): Promise<{
    approvalId: string;
    specificationId: string;
    task: TaskSnapshot;
  }> {
    this.approvals.push({
      actor: input.actor,
      channel: input.channel,
      payloadHash: input.payloadHash,
      status: input.status,
      targetState: input.targetState,
    });
    this.task = {
      ...this.task,
      state: input.targetState,
      version: input.expectedTaskVersion + 1,
    };
    return Promise.resolve({
      approvalId: randomUUID(),
      specificationId: randomUUID(),
      task: this.task,
    });
  }
}

function task(autonomyLevel = 2): SupervisionTask {
  return {
    allowedCommands: ["pnpm test"],
    autonomyLevel,
    id: randomUUID(),
    originalMessage: "Create the requested change",
    projectId: "atlas",
    state: "NEW",
    version: 0,
  };
}

function service(
  store: InMemorySupervisorStore,
  runtime: AgentRuntime,
  memoryContextProvider?: { getContext: () => Promise<{ text: string; truncated: boolean }> },
): SupervisorService {
  return new SupervisorService({
    alwaysHuman: new Set(["production_secret_change"]),
    council: testCouncil,
    monthlyBudgetUsd: 25,
    ...(memoryContextProvider === undefined ? {} : { memoryContextProvider }),
    runtime,
    store,
    taskStore: store,
  });
}

const testCouncil: CouncilConfig = {
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

describe("SupervisorService", () => {
  it("routes a moderate level-2 task directly to QUEUED with a system Approval", async () => {
    const store = new InMemorySupervisorStore(task());
    const runtime = new FakeAgentRuntime("moderate");

    const result = await service(store, runtime).processTask(store.task.id, "moderate-correlation");

    expect(result.state).toBe("QUEUED");
    expect(store.complexity).toBe("moderate");
    expect(store.calls).toHaveLength(7);
    expect(store.opinions.map(({ agentId }) => agentId)).toEqual([
      "project_context",
      "architect",
      "qa",
    ]);
    expect(store.rounds).toHaveLength(1);
    expect(store.approvals).toEqual([
      expect.objectContaining({
        actor: "SYSTEM",
        channel: "POLICY",
        status: "APPROVED",
        targetState: "QUEUED",
      }),
    ]);
    expect(store.approvals[0]?.payloadHash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("routes a critical level-2 task to WAITING_APPROVAL", async () => {
    const store = new InMemorySupervisorStore(task());

    const result = await service(store, new FakeAgentRuntime("critical")).processTask(
      store.task.id,
      "critical-correlation",
    );

    expect(result.state).toBe("WAITING_APPROVAL");
    expect(store.approvals[0]).toMatchObject({
      actor: "USER",
      channel: "TELEGRAM",
      status: "PENDING",
      targetState: "WAITING_APPROVAL",
    });
    expect(store.opinions.map(({ agentId }) => agentId)).toEqual([
      "product",
      "project_context",
      "architect",
      "security",
      "qa",
    ]);
  });

  it("uses only project context as independent reviewer for a simple task", async () => {
    const store = new InMemorySupervisorStore(task());

    await service(store, new FakeAgentRuntime("simple")).processTask(
      store.task.id,
      "simple-correlation",
    );

    expect(store.opinions.map(({ agentId }) => agentId)).toEqual(["project_context"]);
  });

  it("requires approval for an always-human action regardless of moderate complexity", async () => {
    const store = new InMemorySupervisorStore(task());

    const result = await service(
      store,
      new FakeAgentRuntime("moderate", ["production_secret_change"]),
    ).processTask(store.task.id, "policy-correlation");

    expect(result.state).toBe("WAITING_APPROVAL");
  });

  it("runs one focused second round for material divergences and never asks the supervisor to review", async () => {
    const store = new InMemorySupervisorStore(task());

    await service(store, new FakeAgentRuntime("moderate", [], true)).processTask(
      store.task.id,
      "divergence-correlation",
    );

    expect(store.rounds.map(({ round }) => round)).toEqual([1, 2]);
    expect(store.opinions.map(({ agentId, round }) => `${String(round)}:${agentId}`)).toEqual([
      "1:project_context",
      "1:architect",
      "1:qa",
      "2:architect",
    ]);
    expect(store.opinions.some(({ agentId }) => agentId === "engineering_supervisor")).toBe(false);
  });

  it("blocks new deliberation at the monthly limit and audits without calling the runtime", async () => {
    const store = new InMemorySupervisorStore(task());
    store.monthlySpendUsd = 25;
    const runtime = new FakeAgentRuntime("moderate");

    await expect(
      service(store, runtime).processTask(store.task.id, "budget-correlation"),
    ).rejects.toBeInstanceOf(LlmMonthlyBudgetExceededError);
    expect(store.budgetBlocked).toBe(true);
    expect(runtime.calls).toBe(0);
    expect(store.task.state).toBe("NEW");
  });

  it("adds only the selected project memory context to deliberation inputs", async () => {
    const store = new InMemorySupervisorStore(task());
    const runtime = new FakeAgentRuntime("moderate");

    await service(store, runtime, {
      getContext: () => Promise.resolve({ text: "[decision] Keep PostgreSQL", truncated: false }),
    }).processTask(store.task.id, "memory-correlation");

    expect(runtime.inputs[0]).toContain("[decision] Keep PostgreSQL");
    expect(runtime.inputs.some((value) => value.includes("[decision] Keep PostgreSQL"))).toBe(true);
  });

  it("transitions the Task to FAILED when the LLM fails after supervision starts", async () => {
    const store = new InMemorySupervisorStore(task());
    const runtime: AgentRuntime = {
      run: () => Promise.reject(new Error("provider unavailable")),
    };

    await expect(
      service(store, runtime).processTask(store.task.id, "provider-failure"),
    ).rejects.toThrow("provider unavailable");

    expect(store.task).toMatchObject({
      failureStage: "normalizing",
      state: "FAILED",
      version: 2,
    });
  });

  it("fails closed when the Specification expands the project command allowlist", async () => {
    const store = new InMemorySupervisorStore(task());

    await expect(
      service(
        store,
        new FakeAgentRuntime("moderate", [], false, ["git status --short"]),
      ).processTask(store.task.id, "command-policy"),
    ).rejects.toMatchObject({
      code: "SPECIFICATION_COMMAND_OUTSIDE_ALLOWLIST",
    });

    expect(store.task).toMatchObject({
      failureStage: "specifying",
      state: "FAILED",
    });
  });
});
