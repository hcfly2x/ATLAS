import type { AgentRequest, AgentRuntime } from "@atlas/agent-runtime";
import { OPENAI_MODELS } from "@atlas/agent-runtime";
import {
  TaskNotFoundError,
  TaskStateMachine,
  type TaskCoreStore,
  type TaskSnapshot,
} from "@atlas/core";
import {
  complexityClassificationSchema,
  executableSpecificationPayloadSchema,
  normalizedDemandSchema,
  specificationContentSchema,
  canonicalPayloadHash,
  type ComplexityClassification,
  type ExecutableSpecificationPayload,
  type NormalizedDemand,
  type SpecificationContent,
  type TaskComplexity,
} from "@atlas/shared";

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
      monthlyBudgetUsd: number;
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
      input: task.originalMessage,
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

    const content = await this.runAndRecord<SpecificationContent>({
      agentId: "engineering_supervisor",
      correlationId,
      input: JSON.stringify({ complexity: classification, normalized }),
      instructions:
        "Produce one executable specification. Keep scope bounded, use authorized_scope semantics, list tests, commands, expected delivery, and policy actions requiring approval. Do not invoke a multi-agent council.",
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

  private async runAndRecord<Output>(
    input: AgentRequest<Output> & {
      correlationId: string;
      projectId: string;
    },
  ): Promise<Output> {
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
    return response.output;
  }
}
