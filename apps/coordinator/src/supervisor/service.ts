import type { AgentRequest, AgentResponse, AgentRuntime } from "@atlas/agent-runtime";
import { OPENAI_MODELS } from "@atlas/agent-runtime";
import {
  TaskNotFoundError,
  TaskStateMachine,
  type TaskCoreStore,
  type TaskSnapshot,
} from "@atlas/core";
import {
  complexityClassificationSchema,
  divergenceAnalysisSchema,
  executableSpecificationPayloadSchema,
  normalizedDemandSchema,
  specialistOpinionSchema,
  specificationContentSchema,
  canonicalPayloadHash,
  type ComplexityClassification,
  type DivergenceAnalysis,
  type ExecutableSpecificationPayload,
  type NormalizedDemand,
  type SpecialistOpinion,
  type SpecificationContent,
  type TaskComplexity,
} from "@atlas/shared";

import type { CouncilConfig } from "./council-config.js";

export interface SupervisionTask extends TaskSnapshot {
  readonly autonomyLevel: number;
  readonly originalMessage: string;
}

export interface LlmCallRecord {
  readonly agentId: string;
  readonly correlationId: string;
  readonly estimatedCostUsd: number;
  readonly inputTokens: number;
  readonly latencyMs: number;
  readonly model: string;
  readonly outputTokens: number;
  readonly projectId: string;
  readonly taskId: string;
}

export interface PersistSpecificationInput {
  readonly actor: "SYSTEM" | "USER";
  readonly channel: "POLICY" | "TELEGRAM";
  readonly correlationId: string;
  readonly expectedTaskVersion: number;
  readonly payload: ExecutableSpecificationPayload;
  readonly payloadHash: string;
  readonly status: "APPROVED" | "PENDING";
  readonly targetState: "QUEUED" | "WAITING_APPROVAL";
  readonly taskId: string;
}

export interface SupervisorStore {
  getTask(taskId: string): Promise<SupervisionTask | undefined>;
  getMonthlySpendUsd(monthStart: Date): Promise<number>;
  recordBudgetBlocked(input: {
    correlationId: string;
    limitUsd: number;
    projectId: string;
    spentUsd: number;
    taskId: string;
  }): Promise<void>;
  recordLlmCall(input: LlmCallRecord): Promise<void>;
  createDeliberation(input: {
    correlationId: string;
    projectId: string;
    round: 1 | 2;
    taskId: string;
  }): Promise<{ id: string }>;
  persistAgentOpinion(input: {
    agentId: string;
    correlationId: string;
    deliberationId: string;
    estimatedCostUsd: number;
    inputTokens: number;
    model: string;
    opinion: SpecialistOpinion;
    outputTokens: number;
    projectId: string;
    round: 1 | 2;
    taskId: string;
  }): Promise<void>;
  completeDeliberation(input: {
    analysis: DivergenceAnalysis;
    correlationId: string;
    deliberationId: string;
    projectId: string;
    round: 1 | 2;
    taskId: string;
  }): Promise<void>;
  persistNormalizedDemand(input: {
    correlationId: string;
    demand: NormalizedDemand;
    projectId: string;
    taskId: string;
  }): Promise<void>;
  persistComplexity(input: {
    complexity: TaskComplexity;
    correlationId: string;
    projectId: string;
    reasons: readonly string[];
    taskId: string;
  }): Promise<void>;
  nextSpecificationVersion(taskId: string): Promise<number>;
  persistSpecification(input: PersistSpecificationInput): Promise<{
    approvalId: string;
    specificationId: string;
    task: TaskSnapshot;
  }>;
}

export interface ProjectMemoryContextProvider {
  getContext(projectId: string, taskId?: string): Promise<{ text: string; truncated: boolean }>;
}

export class LlmMonthlyBudgetExceededError extends Error {
  readonly code = "LLM_MONTHLY_BUDGET_EXCEEDED";

  constructor(
    readonly limitUsd: number,
    readonly spentUsd: number,
  ) {
    super(`LLM monthly budget reached: ${spentUsd.toFixed(8)} / ${limitUsd.toFixed(2)} USD`);
    this.name = "LlmMonthlyBudgetExceededError";
  }
}

export class TaskNotReadyForSupervisionError extends Error {
  constructor(readonly state: string) {
    super(`Task must be NEW before supervision; found ${state}`);
    this.name = "TaskNotReadyForSupervisionError";
  }
}

export interface AutonomyPolicyInput {
  readonly alwaysHuman: ReadonlySet<string>;
  readonly autonomyLevel: number;
  readonly complexity: TaskComplexity;
  readonly requestedActions: readonly string[];
}

export function requiresPriorHumanApproval(input: AutonomyPolicyInput): boolean {
  if (input.requestedActions.some((action) => input.alwaysHuman.has(action))) {
    return true;
  }
  if (input.autonomyLevel <= 1) {
    return true;
  }
  if (input.autonomyLevel === 2) {
    return input.complexity === "critical";
  }
  if (input.autonomyLevel === 3) {
    return false;
  }
  throw new Error(`Autonomy level is not enabled: ${String(input.autonomyLevel)}`);
}

function monthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export class SupervisorService {
  private readonly stateMachine: TaskStateMachine;

  constructor(
    private readonly options: {
      alwaysHuman: ReadonlySet<string>;
      council: CouncilConfig;
      councilModel?: string;
      monthlyBudgetUsd: number;
      memoryContextProvider?: ProjectMemoryContextProvider;
      runtime: AgentRuntime;
      store: SupervisorStore;
      taskStore: TaskCoreStore;
    },
  ) {
    this.stateMachine = new TaskStateMachine(options.taskStore);
  }

  async processTask(
    taskId: string,
    correlationId: string,
    now = new Date(),
  ): Promise<{
    approvalId: string;
    specificationId: string;
    state: "QUEUED" | "WAITING_APPROVAL";
  }> {
    const task = await this.options.store.getTask(taskId);
    if (task === undefined) {
      throw new TaskNotFoundError(taskId);
    }
    if (task.state !== "NEW") {
      throw new TaskNotReadyForSupervisionError(task.state);
    }

    const spentUsd = await this.options.store.getMonthlySpendUsd(monthStart(now));
    if (spentUsd >= this.options.monthlyBudgetUsd) {
      await this.options.store.recordBudgetBlocked({
        correlationId,
        limitUsd: this.options.monthlyBudgetUsd,
        projectId: task.projectId,
        spentUsd,
        taskId,
      });
      throw new LlmMonthlyBudgetExceededError(this.options.monthlyBudgetUsd, spentUsd);
    }
    const memoryContext = await this.options.memoryContextProvider?.getContext(
      task.projectId,
      taskId,
    );

    let snapshot = (
      await this.stateMachine.transition({
        actor: "agent",
        correlationId,
        expectedVersion: task.version,
        idempotencyKey: `supervisor:${taskId}:normalizing`,
        taskId,
        toState: "NORMALIZING",
      })
    ).task;

    const normalized = await this.runAndRecord<NormalizedDemand>({
      agentId: "normalizer",
      correlationId,
      input: JSON.stringify({
        project_memory: memoryContext?.text ?? "",
        project_memory_truncated: memoryContext?.truncated ?? false,
        user_request: task.originalMessage,
      }),
      instructions:
        "Normalize the request without adding scope. Return objective, relevant context, constraints, and requested policy actions using stable snake_case action names.",
      model: OPENAI_MODELS.normalizer,
      outputSchema: normalizedDemandSchema,
      outputSchemaName: "normalized_demand",
      projectId: task.projectId,
      taskId,
    });
    await this.options.store.persistNormalizedDemand({
      correlationId,
      demand: normalized,
      projectId: task.projectId,
      taskId,
    });
    snapshot = (
      await this.stateMachine.transition({
        actor: "agent",
        correlationId,
        expectedVersion: snapshot.version,
        idempotencyKey: `supervisor:${taskId}:routing`,
        taskId,
        toState: "ROUTING",
      })
    ).task;

    const classification = await this.runAndRecord<ComplexityClassification>({
      agentId: "complexity_router",
      correlationId,
      input: JSON.stringify(normalized),
      instructions:
        "Classify the normalized demand as simple, moderate, or critical. Authentication, payment, migration, production, infrastructure, destructive change, tracking, ad budget, protected areas, and ATLAS self-modification are critical.",
      model: OPENAI_MODELS.router,
      outputSchema: complexityClassificationSchema,
      outputSchemaName: "complexity_classification",
      projectId: task.projectId,
      taskId,
    });
    await this.options.store.persistComplexity({
      complexity: classification.complexity,
      correlationId,
      projectId: task.projectId,
      reasons: classification.reasons,
      taskId,
    });
    snapshot = (
      await this.stateMachine.transition({
        actor: "agent",
        correlationId,
        expectedVersion: snapshot.version,
        idempotencyKey: `supervisor:${taskId}:specifying`,
        taskId,
        toState: "SPECIFYING",
      })
    ).task;

    const opinions = await this.deliberate({
      classification,
      correlationId,
      memoryContext,
      normalized,
      projectId: task.projectId,
      taskId,
    });

    const content = await this.runAndRecord<SpecificationContent>({
      agentId: "engineering_supervisor",
      correlationId,
      input: JSON.stringify({
        complexity: classification,
        normalized,
        specialist_opinions: opinions,
        project_memory: memoryContext?.text ?? "",
        project_memory_truncated: memoryContext?.truncated ?? false,
      }),
      instructions:
        "Consolidate the independent specialist opinions without majority voting. Resolve material divergences, keep scope bounded, use authorized_scope semantics, and produce one executable specification with tests, commands, expected delivery, and policy actions requiring approval.",
      model: OPENAI_MODELS.supervisor,
      outputSchema: specificationContentSchema,
      outputSchemaName: "executable_specification_content",
      projectId: task.projectId,
      taskId,
    });
    const version = await this.options.store.nextSpecificationVersion(taskId);
    const payload = executableSpecificationPayloadSchema.parse({
      ...content,
      project_id: task.projectId,
      risk_level: classification.complexity,
      task_id: taskId,
      version,
    });
    const payloadHash = canonicalPayloadHash(payload);
    const humanApprovalRequired = requiresPriorHumanApproval({
      alwaysHuman: this.options.alwaysHuman,
      autonomyLevel: task.autonomyLevel,
      complexity: classification.complexity,
      requestedActions: [...normalized.requested_actions, ...content.approval_required_for],
    });
    const targetState = humanApprovalRequired ? "WAITING_APPROVAL" : "QUEUED";
    const persisted = await this.options.store.persistSpecification({
      actor: humanApprovalRequired ? "USER" : "SYSTEM",
      channel: humanApprovalRequired ? "TELEGRAM" : "POLICY",
      correlationId,
      expectedTaskVersion: snapshot.version,
      payload,
      payloadHash,
      status: humanApprovalRequired ? "PENDING" : "APPROVED",
      targetState,
      taskId,
    });
    return {
      approvalId: persisted.approvalId,
      specificationId: persisted.specificationId,
      state: targetState,
    };
  }

  private async deliberate(input: {
    classification: ComplexityClassification;
    correlationId: string;
    memoryContext: { text: string; truncated: boolean } | undefined;
    normalized: NormalizedDemand;
    projectId: string;
    taskId: string;
  }): Promise<readonly { agentId: string; opinion: SpecialistOpinion; round: 1 | 2 }[]> {
    const route = this.options.council.routes[input.classification.complexity];
    const supervisorOccurrences = route.filter(
      (agentId) => agentId === this.options.council.supervisorId,
    ).length;
    if (route.at(-1) !== this.options.council.supervisorId || supervisorOccurrences !== 1) {
      throw new Error("The Specification author must appear only as the final consolidator");
    }
    const specialistIds = route.slice(0, -1);
    if (specialistIds.length === 0) {
      throw new Error("A council route requires an independent reviewer");
    }

    const roundOne = await this.runDeliberationRound({
      ...input,
      agentIds: specialistIds,
      round: 1,
    });
    const analysis = await this.runAndRecord<DivergenceAnalysis>({
      agentId: this.options.council.supervisorId,
      correlationId: input.correlationId,
      input: JSON.stringify({
        normalized: input.normalized,
        opinions: roundOne.map(({ agentId, opinion }) => ({ agent_id: agentId, ...opinion })),
      }),
      instructions:
        "Identify only material conflicts among independent opinions. Request focused revisions only from agents involved in a material divergence. Do not decide by majority and do not invent new agents.",
      model: OPENAI_MODELS.supervisor,
      outputSchema: divergenceAnalysisSchema,
      outputSchemaName: "material_divergence_analysis",
      projectId: input.projectId,
      taskId: input.taskId,
    });
    await this.options.store.completeDeliberation({
      analysis,
      correlationId: input.correlationId,
      deliberationId: roundOne.deliberationId,
      projectId: input.projectId,
      round: 1,
      taskId: input.taskId,
    });

    if (analysis.material_divergences.length === 0) {
      return roundOne;
    }
    const involvedAgents = new Set(
      analysis.material_divergences.flatMap(({ agent_ids }) => agent_ids),
    );
    const invalidDivergenceAgent = [...involvedAgents].find(
      (agentId) =>
        !specialistIds.includes(agentId) || agentId === this.options.council.supervisorId,
    );
    if (invalidDivergenceAgent !== undefined) {
      throw new Error(
        `Divergence analysis referenced an invalid reviewer: ${invalidDivergenceAgent}`,
      );
    }
    const requestedAgents = new Set(analysis.revision_requests.map(({ agent_id }) => agent_id));
    const invalidAgent = [...requestedAgents].find(
      (agentId) => !specialistIds.includes(agentId) || !involvedAgents.has(agentId),
    );
    if (invalidAgent !== undefined || requestedAgents.has(this.options.council.supervisorId)) {
      throw new Error(
        `Divergence analysis requested an invalid reviewer: ${invalidAgent ?? "supervisor"}`,
      );
    }
    if (requestedAgents.size === 0) {
      throw new Error("Material divergences require at least one focused revision");
    }
    const roundTwo = await this.runDeliberationRound({
      ...input,
      agentIds: [...requestedAgents],
      previousOpinions: roundOne,
      revisionRequests: analysis.revision_requests,
      round: 2,
    });
    const roundTwoAnalysis = await this.runAndRecord<DivergenceAnalysis>({
      agentId: this.options.council.supervisorId,
      correlationId: input.correlationId,
      input: JSON.stringify({
        initial_divergences: analysis.material_divergences,
        opinions: [...roundOne, ...roundTwo].map(({ agentId, opinion, round }) => ({
          agent_id: agentId,
          opinion,
          round,
        })),
      }),
      instructions:
        "Assess which material divergences remain after the focused second and final round. Do not request another round; revision_requests must be empty. The final supervisor will resolve any remaining conflict without majority voting.",
      model: OPENAI_MODELS.supervisor,
      outputSchema: divergenceAnalysisSchema,
      outputSchemaName: "final_divergence_analysis",
      projectId: input.projectId,
      taskId: input.taskId,
    });
    if (roundTwoAnalysis.revision_requests.length > 0) {
      throw new Error("A third deliberation round is not allowed");
    }
    await this.options.store.completeDeliberation({
      analysis: roundTwoAnalysis,
      correlationId: input.correlationId,
      deliberationId: roundTwo.deliberationId,
      projectId: input.projectId,
      round: 2,
      taskId: input.taskId,
    });
    return [...roundOne, ...roundTwo];
  }

  private async runDeliberationRound(input: {
    agentIds: readonly string[];
    classification: ComplexityClassification;
    correlationId: string;
    memoryContext: { text: string; truncated: boolean } | undefined;
    normalized: NormalizedDemand;
    previousOpinions?: readonly { agentId: string; opinion: SpecialistOpinion; round: 1 | 2 }[];
    projectId: string;
    revisionRequests?: readonly { agent_id: string; focus: string }[];
    round: 1 | 2;
    taskId: string;
  }): Promise<
    { agentId: string; opinion: SpecialistOpinion; round: 1 | 2 }[] & {
      deliberationId: string;
    }
  > {
    const deliberation = await this.options.store.createDeliberation({
      correlationId: input.correlationId,
      projectId: input.projectId,
      round: input.round,
      taskId: input.taskId,
    });
    const results = await Promise.all(
      input.agentIds.map(async (agentId) => {
        const agent = this.options.council.agents.get(agentId);
        if (agent === undefined) {
          throw new Error(`Council agent is not configured: ${agentId}`);
        }
        const focus = input.revisionRequests?.find(
          (request) => request.agent_id === agentId,
        )?.focus;
        const response = await this.runAndRecordResponse<SpecialistOpinion>({
          agentId,
          correlationId: input.correlationId,
          input: JSON.stringify({
            complexity: input.classification,
            normalized: input.normalized,
            previous_opinions: input.previousOpinions ?? [],
            project_memory: input.memoryContext?.text ?? "",
            project_memory_truncated: input.memoryContext?.truncated ?? false,
            revision_focus: focus ?? null,
            round: input.round,
          }),
          instructions: `${agent.instructions}\n\nReturn an independent specialist opinion. Do not produce the final Specification, expand permissions, or coordinate with other agents.${focus === undefined ? "" : ` Reconsider only this material divergence: ${focus}`}`,
          model: this.options.councilModel ?? OPENAI_MODELS.reviewer,
          outputSchema: specialistOpinionSchema,
          outputSchemaName: `specialist_opinion_${agentId}`,
          projectId: input.projectId,
          taskId: input.taskId,
        });
        await this.options.store.persistAgentOpinion({
          agentId,
          correlationId: input.correlationId,
          deliberationId: deliberation.id,
          estimatedCostUsd: response.estimatedCostUsd,
          inputTokens: response.inputTokens,
          model: response.model,
          opinion: response.output,
          outputTokens: response.outputTokens,
          projectId: input.projectId,
          round: input.round,
          taskId: input.taskId,
        });
        return { agentId, opinion: response.output, round: input.round };
      }),
    );
    return Object.assign(results, { deliberationId: deliberation.id });
  }

  private async runAndRecord<Output>(
    input: AgentRequest<Output> & {
      correlationId: string;
      projectId: string;
    },
  ): Promise<Output> {
    return (await this.runAndRecordResponse(input)).output;
  }

  private async runAndRecordResponse<Output>(
    input: AgentRequest<Output> & {
      correlationId: string;
      projectId: string;
    },
  ): Promise<AgentResponse<Output>> {
    const response = await this.options.runtime.run(input);
    await this.options.store.recordLlmCall({
      agentId: input.agentId,
      correlationId: input.correlationId,
      estimatedCostUsd: response.estimatedCostUsd,
      inputTokens: response.inputTokens,
      latencyMs: response.latencyMs,
      model: response.model,
      outputTokens: response.outputTokens,
      projectId: input.projectId,
      taskId: input.taskId,
    });
    return response;
  }
}
