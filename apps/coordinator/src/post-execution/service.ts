import { randomUUID } from "node:crypto";

import type { AgentRuntime } from "@atlas/agent-runtime";
import { OPENAI_MODELS } from "@atlas/agent-runtime";
import {
  ApprovalStatus,
  ExecutionStatus,
  PostExecutionReviewStatus,
  Prisma,
  TaskState,
  WorkerStatus,
  type PrismaClient,
} from "@prisma/client";
import {
  canonicalPayloadHash,
  executableSpecificationPayloadSchema,
  postExecutionReviewSchema,
  workerResultSchema,
  type PostExecutionReview,
} from "@atlas/shared";

import type { CouncilAgent, CouncilConfig } from "../supervisor/council-config.js";
import { telegramResultDestination } from "../telegram/origin.js";

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function monthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export function postExecutionReviewInstructions(answerOnly: boolean): string {
  return `You are the post-execution quality gate. Review the worker result against the immutable Specification. Approve only when the delivered result, tests and constraints satisfy it. Reject when rework is required. ${
    answerOnly
      ? "This is answer_only: an empty diff is valid and must not be rejected for lack of a repository artifact. Validate the textual summary against the acceptance criteria and the authorized delivery contract."
      : "This is repository_change: preserve the existing diff and artifact review behavior."
  } Do not implement code, alter scope, send messages or authorize merge/deploy.`;
}

export class PostExecutionQaService {
  private readonly reviewer: CouncilAgent;

  constructor(
    private readonly options: {
      claimDurationMs: number;
      council: CouncilConfig;
      monthlyBudgetUsd: number;
      prisma: PrismaClient;
      runtime: AgentRuntime;
    },
  ) {
    const reviewer = options.council.agents.get("qa");
    if (reviewer === undefined) throw new Error("QA reviewer is not registered");
    if (reviewer.id === options.council.supervisorId) {
      throw new Error("Post-execution reviewer must differ from the supervisor");
    }
    this.reviewer = reviewer;
  }

  async processPendingReviews(now = new Date()): Promise<number> {
    const candidates = await this.options.prisma.execution.findMany({
      where: {
        resultPayload: { not: Prisma.JsonNull },
        status: ExecutionStatus.AWAITING_RESULT_APPROVAL,
        task: { state: TaskState.WAITING_RESULT_APPROVAL },
      },
      select: { id: true },
    });
    let processed = 0;
    for (const candidate of candidates) {
      if (await this.reviewExecution(candidate.id, now)) processed += 1;
    }
    return processed;
  }

  async reviewExecution(executionId: string, now = new Date()): Promise<boolean> {
    const execution = await this.options.prisma.execution.findUnique({
      where: { id: executionId },
      include: {
        postExecutionReview: true,
        specification: true,
        task: true,
      },
    });
    if (execution === null) {
      return false;
    }
    if (
      execution.resultPayload === null ||
      execution.status !== ExecutionStatus.AWAITING_RESULT_APPROVAL ||
      execution.task.state !== TaskState.WAITING_RESULT_APPROVAL
    ) {
      return false;
    }
    const review = await this.options.prisma.postExecutionReview.upsert({
      where: { executionId: execution.id },
      create: {
        executionId: execution.id,
        idempotencyKey: `execution:${execution.id}:post-execution-review:v1`,
        reviewerId: this.reviewer.id,
        specificationId: execution.specificationId,
        taskId: execution.taskId,
      },
      update: {},
    });
    if (
      review.status === PostExecutionReviewStatus.APPROVED ||
      review.status === PostExecutionReviewStatus.REJECTED ||
      review.status === PostExecutionReviewStatus.FAILED
    ) {
      return false;
    }

    const spend = await this.options.prisma.llmCall.aggregate({
      where: { createdAt: { gte: monthStart(now) } },
      _sum: { estimatedCostUsd: true },
    });
    if (Number(spend._sum.estimatedCostUsd ?? 0) >= this.options.monthlyBudgetUsd) {
      return this.failReview(review.id, undefined, "monthly_budget_exceeded", now);
    }

    const claimToken = randomUUID();
    const claimed = await this.options.prisma.postExecutionReview.updateMany({
      where: {
        id: review.id,
        OR: [
          { status: PostExecutionReviewStatus.PENDING },
          { status: PostExecutionReviewStatus.RUNNING, claimExpiresAt: { lt: now } },
        ],
      },
      data: {
        claimExpiresAt: new Date(now.getTime() + this.options.claimDurationMs),
        claimToken,
        status: PostExecutionReviewStatus.RUNNING,
      },
    });
    if (claimed.count !== 1) return false;

    try {
      const result = workerResultSchema.parse(execution.resultPayload);
      const specification = executableSpecificationPayloadSchema.parse(
        execution.specification.payload,
      );
      const answerOnly = specification.delivery_mode === "answer_only";
      const destinationAuthorized =
        !answerOnly || telegramResultDestination(execution.task.origin) !== undefined;
      if (!destinationAuthorized) {
        throw new Error("answer_only_destination_is_not_authorized");
      }
      const response = await this.options.runtime.run({
        agentId: this.reviewer.id,
        input: JSON.stringify(
          {
            execution: {
              changed_paths: result.changed_paths,
              diff_hash: result.diff_hash,
              diff_summary: result.diff_summary,
              protected_path_matches: result.protected_path_matches,
              status: result.status,
              summary: result.summary,
              tests: result.tests,
            },
            delivery_contract: {
              destination_authorized: destinationAuthorized,
              mode: specification.delivery_mode,
            },
            specification,
          },
          null,
          2,
        ),
        instructions: `${this.reviewer.instructions}\n\n${postExecutionReviewInstructions(answerOnly)}`,
        model: OPENAI_MODELS.reviewer,
        outputSchema: postExecutionReviewSchema,
        outputSchemaName: "post_execution_review",
        taskId: execution.taskId,
      });
      return await this.completeReview(execution.id, review.id, claimToken, response, now);
    } catch (error: unknown) {
      return this.failReview(
        review.id,
        claimToken,
        error instanceof Error ? error.message : "post_execution_qa_failed",
        now,
      );
    }
  }

  private async completeReview(
    executionId: string,
    reviewId: string,
    claimToken: string,
    response: {
      estimatedCostUsd: number;
      inputTokens: number;
      latencyMs: number;
      model: string;
      output: PostExecutionReview;
      outputTokens: number;
    },
    now: Date,
  ): Promise<boolean> {
    const review = postExecutionReviewSchema.parse(response.output);
    const payloadHash = canonicalPayloadHash(review);
    return this.options.prisma.$transaction(async (transaction) => {
      const execution = await transaction.execution.findUniqueOrThrow({
        where: { id: executionId },
        include: { task: true },
      });
      const updatedReview = await transaction.postExecutionReview.updateMany({
        where: {
          claimToken,
          id: reviewId,
          status: PostExecutionReviewStatus.RUNNING,
        },
        data: {
          claimExpiresAt: null,
          model: response.model,
          payload: json(review),
          payloadHash,
          reviewedAt: now,
          status:
            review.decision === "approved"
              ? PostExecutionReviewStatus.APPROVED
              : PostExecutionReviewStatus.REJECTED,
        },
      });
      if (updatedReview.count !== 1) return false;
      const correlationId = `execution:${execution.id}:post-execution-review:v1`;
      await transaction.llmCall.create({
        data: {
          agentId: this.reviewer.id,
          correlationId,
          estimatedCostUsd: response.estimatedCostUsd,
          inputTokens: response.inputTokens,
          latencyMs: response.latencyMs,
          model: response.model,
          outputTokens: response.outputTokens,
          projectId: execution.task.projectId,
          taskId: execution.taskId,
        },
      });
      await transaction.auditEvent.create({
        data: {
          action: "post_execution_review.completed",
          actor: "AGENT",
          correlationId,
          idempotencyKey: `audit:${correlationId}`,
          payload: json({
            decision: review.decision,
            executionId: execution.id,
            payloadHash,
            reviewerId: this.reviewer.id,
            specificationId: execution.specificationId,
          }),
          projectId: execution.task.projectId,
          targetId: reviewId,
          targetType: "post_execution_review",
          taskId: execution.taskId,
        },
      });
      if (
        execution.status !== ExecutionStatus.AWAITING_RESULT_APPROVAL ||
        execution.task.state !== TaskState.WAITING_RESULT_APPROVAL
      ) {
        return true;
      }
      if (review.decision === "rejected") {
        await this.returnForRework(transaction, execution, correlationId, "qa_rejected");
        return true;
      }
      const policyApproval = await transaction.approval.findUnique({
        where: { idempotencyKey: `execution:${execution.id}:result-approval` },
      });
      if (policyApproval?.status !== ApprovalStatus.APPROVED) return true;
      const transitioned = await transaction.task.updateMany({
        where: {
          id: execution.taskId,
          state: TaskState.WAITING_RESULT_APPROVAL,
          version: execution.task.version,
        },
        data: { state: TaskState.FINALIZING, version: { increment: 1 } },
      });
      if (transitioned.count !== 1) return false;
      await transaction.execution.updateMany({
        where: { id: execution.id, status: ExecutionStatus.AWAITING_RESULT_APPROVAL },
        data: { status: ExecutionStatus.FINALIZING },
      });
      await transaction.auditEvent.create({
        data: {
          action: "task.transition.accepted",
          actor: "SYSTEM",
          correlationId,
          idempotencyKey: `audit:${correlationId}:finalizing`,
          payload: json({
            fromState: TaskState.WAITING_RESULT_APPROVAL,
            reason: "post_execution_review_approved",
            task: {
              failureStage: execution.task.failureStage,
              id: execution.taskId,
              projectId: execution.task.projectId,
              state: TaskState.FINALIZING,
              version: execution.task.version + 1,
            },
          }),
          projectId: execution.task.projectId,
          targetId: execution.taskId,
          targetType: "task",
          taskId: execution.taskId,
        },
      });
      return true;
    });
  }

  private async failReview(
    reviewId: string,
    claimToken: string | undefined,
    reason: string,
    now: Date,
  ): Promise<boolean> {
    return this.options.prisma.$transaction(async (transaction) => {
      const review = await transaction.postExecutionReview.findUniqueOrThrow({
        where: { id: reviewId },
        include: { execution: { include: { task: true } } },
      });
      const failedReview = await transaction.postExecutionReview.updateMany({
        where: {
          id: review.id,
          status:
            claimToken === undefined
              ? PostExecutionReviewStatus.PENDING
              : PostExecutionReviewStatus.RUNNING,
          ...(claimToken === undefined ? {} : { claimToken }),
        },
        data: {
          claimExpiresAt: null,
          failureReason: reason.slice(0, 500),
          reviewedAt: now,
          status: PostExecutionReviewStatus.FAILED,
        },
      });
      if (failedReview.count !== 1) return false;
      const correlationId = `execution:${review.executionId}:post-execution-review:v1`;
      await transaction.auditEvent.create({
        data: {
          action: "post_execution_review.failed",
          actor: "SYSTEM",
          correlationId,
          idempotencyKey: `audit:${correlationId}:failed`,
          payload: json({ reason: reason.slice(0, 500), reviewerId: review.reviewerId }),
          projectId: review.execution.task.projectId,
          targetId: review.id,
          targetType: "post_execution_review",
          taskId: review.taskId,
        },
      });
      if (
        review.execution.status === ExecutionStatus.AWAITING_RESULT_APPROVAL &&
        review.execution.task.state === TaskState.WAITING_RESULT_APPROVAL
      ) {
        await this.returnForRework(transaction, review.execution, correlationId, "qa_unavailable");
      }
      return true;
    });
  }

  private async returnForRework(
    transaction: Prisma.TransactionClient,
    execution: {
      id: string;
      status: ExecutionStatus;
      taskId: string;
      workerId: string | null;
      task: {
        failureStage: string | null;
        id: string;
        projectId: string;
        state: TaskState;
        version: number;
      };
    },
    correlationId: string,
    reason: "qa_rejected" | "qa_unavailable",
  ): Promise<void> {
    const transitioned = await transaction.task.updateMany({
      where: {
        id: execution.taskId,
        state: TaskState.WAITING_RESULT_APPROVAL,
        version: execution.task.version,
      },
      data: { state: TaskState.SPECIFYING, version: { increment: 1 } },
    });
    if (transitioned.count !== 1) return;
    await transaction.execution.updateMany({
      where: { id: execution.id, status: ExecutionStatus.AWAITING_RESULT_APPROVAL },
      data: {
        failureStage: "post_execution_qa",
        leaseExpiresAt: null,
        leaseId: null,
        status: ExecutionStatus.FAILED,
      },
    });
    if (execution.workerId !== null) {
      await transaction.worker.update({
        where: { id: execution.workerId },
        data: { status: WorkerStatus.IDLE },
      });
    }
    await transaction.auditEvent.create({
      data: {
        action: "task.transition.accepted",
        actor: "SYSTEM",
        correlationId,
        idempotencyKey: `audit:${correlationId}:rework`,
        payload: json({
          fromState: TaskState.WAITING_RESULT_APPROVAL,
          reason,
          task: {
            failureStage: execution.task.failureStage,
            id: execution.taskId,
            projectId: execution.task.projectId,
            state: TaskState.SPECIFYING,
            version: execution.task.version + 1,
          },
        }),
        projectId: execution.task.projectId,
        targetId: execution.taskId,
        targetType: "task",
        taskId: execution.taskId,
      },
    });
  }
}
