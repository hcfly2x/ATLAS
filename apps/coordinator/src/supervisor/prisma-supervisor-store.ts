import {
  ApprovalActor,
  ApprovalChannel,
  ApprovalStatus,
  ApprovalTargetType,
  ApprovalType,
  Prisma,
  TaskComplexity,
  TaskState,
  type PrismaClient,
} from "@prisma/client";

import { TaskVersionConflictError, type TaskSnapshot } from "@atlas/core";
import {
  taskStateSchema,
  type DivergenceAnalysis,
  type NormalizedDemand,
  type SpecialistOpinion,
  type TaskComplexity as SharedTaskComplexity,
} from "@atlas/shared";

import type {
  LlmCallRecord,
  PersistSpecificationInput,
  SupervisionTask,
  SupervisorStore,
} from "./service.js";

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function taskSnapshot(task: {
  failureStage: string | null;
  id: string;
  projectId: string;
  state: TaskState;
  version: number;
}): TaskSnapshot {
  return {
    id: task.id,
    projectId: task.projectId,
    state: taskStateSchema.parse(task.state),
    version: task.version,
    ...(task.failureStage === null ? {} : { failureStage: task.failureStage }),
  };
}

const complexityMap: Record<SharedTaskComplexity, TaskComplexity> = {
  critical: TaskComplexity.CRITICAL,
  moderate: TaskComplexity.MODERATE,
  simple: TaskComplexity.SIMPLE,
};

export class PrismaSupervisorStore implements SupervisorStore {
  constructor(private readonly prisma: PrismaClient) {}

  async getTask(taskId: string): Promise<SupervisionTask | undefined> {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: { project: { select: { autonomyLevel: true } } },
    });
    if (task === null) {
      return undefined;
    }
    return {
      ...taskSnapshot(task),
      autonomyLevel: task.project.autonomyLevel,
      originalMessage: task.originalMessage,
    };
  }

  async getMonthlySpendUsd(monthStart: Date): Promise<number> {
    const aggregate = await this.prisma.llmCall.aggregate({
      where: { createdAt: { gte: monthStart } },
      _sum: { estimatedCostUsd: true },
    });
    return aggregate._sum.estimatedCostUsd?.toNumber() ?? 0;
  }

  async recordBudgetBlocked(input: {
    correlationId: string;
    limitUsd: number;
    projectId: string;
    spentUsd: number;
    taskId: string;
  }): Promise<void> {
    await this.prisma.auditEvent.upsert({
      where: { idempotencyKey: `llm-budget:${input.taskId}:${input.correlationId}` },
      create: {
        action: "llm.budget.blocked",
        actor: "SYSTEM",
        correlationId: input.correlationId,
        idempotencyKey: `llm-budget:${input.taskId}:${input.correlationId}`,
        payload: json({ limitUsd: input.limitUsd, spentUsd: input.spentUsd }),
        projectId: input.projectId,
        targetId: input.taskId,
        targetType: "task",
        taskId: input.taskId,
      },
      update: {},
    });
  }

  async recordLlmCall(input: LlmCallRecord): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const call = await transaction.llmCall.create({
        data: {
          agentId: input.agentId,
          correlationId: input.correlationId,
          estimatedCostUsd: new Prisma.Decimal(input.estimatedCostUsd),
          inputTokens: input.inputTokens,
          latencyMs: input.latencyMs,
          model: input.model,
          outputTokens: input.outputTokens,
          projectId: input.projectId,
          taskId: input.taskId,
        },
      });
      await transaction.auditEvent.create({
        data: {
          action: "llm.call.recorded",
          actor: "AGENT",
          correlationId: input.correlationId,
          idempotencyKey: `llm-call:${call.id}`,
          payload: json({
            agentId: input.agentId,
            estimatedCostUsd: input.estimatedCostUsd,
            inputTokens: input.inputTokens,
            latencyMs: input.latencyMs,
            model: input.model,
            outputTokens: input.outputTokens,
          }),
          projectId: input.projectId,
          targetId: call.id,
          targetType: "llm_call",
          taskId: input.taskId,
        },
      });
    });
  }

  async createDeliberation(input: {
    correlationId: string;
    projectId: string;
    round: 1 | 2;
    taskId: string;
  }): Promise<{ id: string }> {
    return this.prisma.$transaction(async (transaction) => {
      const deliberation = await transaction.deliberation.create({
        data: { round: input.round, taskId: input.taskId },
      });
      await transaction.auditEvent.create({
        data: {
          action: "deliberation.round.started",
          actor: "AGENT",
          correlationId: input.correlationId,
          idempotencyKey: `deliberation:${input.taskId}:${String(input.round)}:started`,
          payload: json({ deliberationId: deliberation.id, round: input.round }),
          projectId: input.projectId,
          targetId: deliberation.id,
          targetType: "deliberation",
          taskId: input.taskId,
        },
      });
      return { id: deliberation.id };
    });
  }

  async persistAgentOpinion(input: {
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
  }): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const opinion = await transaction.agentOpinion.create({
        data: {
          agentId: input.agentId,
          deliberationId: input.deliberationId,
          estimatedCostUsd: new Prisma.Decimal(input.estimatedCostUsd),
          inputTokens: input.inputTokens,
          model: input.model,
          outputTokens: input.outputTokens,
          payload: json(input.opinion),
        },
      });
      await transaction.auditEvent.create({
        data: {
          action: "agent.opinion.recorded",
          actor: "AGENT",
          correlationId: input.correlationId,
          idempotencyKey: `agent-opinion:${opinion.id}:recorded`,
          payload: json({
            agentId: input.agentId,
            deliberationId: input.deliberationId,
            model: input.model,
            round: input.round,
          }),
          projectId: input.projectId,
          targetId: opinion.id,
          targetType: "agent_opinion",
          taskId: input.taskId,
        },
      });
    });
  }

  async completeDeliberation(input: {
    analysis: DivergenceAnalysis;
    correlationId: string;
    deliberationId: string;
    projectId: string;
    round: 1 | 2;
    taskId: string;
  }): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await transaction.deliberation.update({
        where: { id: input.deliberationId },
        data: {
          completedAt: new Date(),
          divergenceSummary: json(input.analysis),
          status: "COMPLETED",
        },
      });
      await transaction.auditEvent.create({
        data: {
          action: "deliberation.round.completed",
          actor: "AGENT",
          correlationId: input.correlationId,
          idempotencyKey: `deliberation:${input.taskId}:${String(input.round)}:completed`,
          payload: json({
            deliberationId: input.deliberationId,
            materialDivergenceCount: input.analysis.material_divergences.length,
            round: input.round,
          }),
          projectId: input.projectId,
          targetId: input.deliberationId,
          targetType: "deliberation",
          taskId: input.taskId,
        },
      });
    });
  }

  async persistNormalizedDemand(input: {
    correlationId: string;
    demand: NormalizedDemand;
    projectId: string;
    taskId: string;
  }): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.task.update({
        where: { id: input.taskId },
        data: { normalizedDemand: json(input.demand) },
      }),
      this.prisma.auditEvent.create({
        data: {
          action: "task.normalized",
          actor: "AGENT",
          correlationId: input.correlationId,
          idempotencyKey: `task-normalized:${input.taskId}`,
          payload: json({ normalizedDemand: input.demand }),
          projectId: input.projectId,
          targetId: input.taskId,
          targetType: "task",
          taskId: input.taskId,
        },
      }),
    ]);
  }

  async persistComplexity(input: {
    complexity: SharedTaskComplexity;
    correlationId: string;
    projectId: string;
    reasons: readonly string[];
    taskId: string;
  }): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.task.update({
        where: { id: input.taskId },
        data: { complexity: complexityMap[input.complexity] },
      }),
      this.prisma.auditEvent.create({
        data: {
          action: "task.complexity.classified",
          actor: "AGENT",
          correlationId: input.correlationId,
          idempotencyKey: `task-complexity:${input.taskId}`,
          payload: json({ complexity: input.complexity, reasons: input.reasons }),
          projectId: input.projectId,
          targetId: input.taskId,
          targetType: "task",
          taskId: input.taskId,
        },
      }),
    ]);
  }

  async nextSpecificationVersion(taskId: string): Promise<number> {
    const aggregate = await this.prisma.specification.aggregate({
      where: { taskId },
      _max: { version: true },
    });
    return (aggregate._max.version ?? 0) + 1;
  }

  async persistSpecification(input: PersistSpecificationInput): Promise<{
    approvalId: string;
    specificationId: string;
    task: TaskSnapshot;
  }> {
    return this.prisma.$transaction(async (transaction) => {
      const specification = await transaction.specification.create({
        data: {
          payload: json(input.payload),
          payloadHash: input.payloadHash,
          taskId: input.taskId,
          version: input.payload.version,
        },
      });
      const updated = await transaction.task.updateMany({
        where: {
          id: input.taskId,
          state: TaskState.SPECIFYING,
          version: input.expectedTaskVersion,
        },
        data: {
          activeSpecificationId: specification.id,
          state: TaskState[input.targetState],
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) {
        const current = await transaction.task.findUniqueOrThrow({
          where: { id: input.taskId },
        });
        throw new TaskVersionConflictError(input.expectedTaskVersion, current.version);
      }
      const approval = await transaction.approval.create({
        data: {
          actor: ApprovalActor[input.actor],
          channel: ApprovalChannel[input.channel],
          decidedBy: input.status === "APPROVED" ? "system:policy" : null,
          idempotencyKey: `specification:${specification.id}:pre-execution`,
          presentedPayload: json(input.payload),
          requestedBy: "engineering_supervisor",
          respondedAt: input.status === "APPROVED" ? new Date() : null,
          status: ApprovalStatus[input.status],
          targetHash: input.payloadHash,
          targetId: specification.id,
          targetType: ApprovalTargetType.SPECIFICATION,
          targetVersion: specification.version,
          taskId: input.taskId,
          type: ApprovalType.PRE_EXECUTION,
        },
      });
      const task = taskSnapshot(
        await transaction.task.findUniqueOrThrow({ where: { id: input.taskId } }),
      );
      await transaction.auditEvent.create({
        data: {
          action: "specification.created",
          actor: "AGENT",
          correlationId: input.correlationId,
          idempotencyKey: `specification:${specification.id}:created`,
          payload: json({
            payloadHash: input.payloadHash,
            specificationId: specification.id,
            version: specification.version,
          }),
          projectId: task.projectId,
          targetId: specification.id,
          targetType: "specification",
          taskId: input.taskId,
        },
      });
      await transaction.auditEvent.create({
        data: {
          action: input.status === "APPROVED" ? "approval.auto_approved" : "approval.requested",
          actor: input.status === "APPROVED" ? "SYSTEM" : "AGENT",
          correlationId: input.correlationId,
          idempotencyKey: `approval:${approval.id}:${input.status.toLowerCase()}`,
          payload: json({
            actor: input.actor,
            approvalId: approval.id,
            channel: input.channel,
            targetHash: input.payloadHash,
            targetId: specification.id,
            targetType: "SPECIFICATION",
            targetVersion: specification.version,
          }),
          projectId: task.projectId,
          targetId: specification.id,
          targetType: "SPECIFICATION",
          taskId: input.taskId,
        },
      });
      await transaction.auditEvent.create({
        data: {
          action: "task.transition.accepted",
          actor: "SYSTEM",
          correlationId: input.correlationId,
          idempotencyKey: `supervisor:${input.taskId}:${input.targetState.toLowerCase()}`,
          payload: json({ fromState: "SPECIFYING", task }),
          projectId: task.projectId,
          targetId: input.taskId,
          targetType: "task",
          taskId: input.taskId,
        },
      });
      return { approvalId: approval.id, specificationId: specification.id, task };
    });
  }
}
