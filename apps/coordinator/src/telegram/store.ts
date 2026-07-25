import {
  ApprovalStatus,
  Prisma,
  type ApprovalTargetType,
  type ApprovalType,
  type PrismaClient,
  type TaskState,
} from "@prisma/client";
import { z } from "zod";

import type { TaskSnapshot } from "@atlas/core";
import {
  canonicalPayloadHash,
  executableSpecificationPayloadSchema,
  taskStateSchema,
} from "@atlas/shared";

import type { TelegramResponse } from "./types.js";

const responseSchema = z.array(
  z.object({
    buttons: z.array(z.array(z.object({ callbackData: z.string(), text: z.string() }))).optional(),
    text: z.string(),
  }),
);

const decisionReplaySchema = z.object({
  approvalId: z.string(),
  decision: z.enum(["APPROVED", "REJECTED"]),
  targetHash: z.string(),
  targetId: z.string(),
  targetType: z.string(),
  targetVersion: z.number().int().nullable(),
});

function parseResponses(value: unknown): readonly TelegramResponse[] {
  return responseSchema.parse(value).map((response) => ({
    text: response.text,
    ...(response.buttons === undefined ? {} : { buttons: response.buttons }),
  }));
}

export interface TelegramProject {
  readonly id: string;
  readonly name: string;
}

export interface TelegramApproval {
  readonly id: string;
  readonly targetHash: string;
  readonly targetId: string;
  readonly targetType: ApprovalTargetType;
  readonly targetVersion: number | null;
  readonly type: ApprovalType;
}

export interface TelegramTaskStatus {
  readonly approvals: readonly TelegramApproval[];
  readonly task: TaskSnapshot;
}

export interface ApprovalDecisionResult {
  readonly approval: TelegramApproval;
  readonly decision: "APPROVED" | "REJECTED";
  readonly idempotentReplay: boolean;
  readonly task: TaskSnapshot;
}

export interface RecordTelegramUpdateResult {
  readonly idempotentReplay: boolean;
  readonly responses: readonly TelegramResponse[];
}

export class ApprovalTargetHashMismatchError extends Error {
  readonly code = "APPROVAL_TARGET_HASH_MISMATCH";

  constructor(
    readonly approvalId: string,
    readonly expectedHash: string | null,
    readonly recordedHash: string,
  ) {
    super(`Approval target hash mismatch for ${approvalId}`);
    this.name = "ApprovalTargetHashMismatchError";
  }
}

export class PostExecutionReviewPendingError extends Error {
  readonly code = "POST_EXECUTION_REVIEW_PENDING";

  constructor(readonly approvalId: string) {
    super(`Post-execution review is not approved for ${approvalId}`);
    this.name = "PostExecutionReviewPendingError";
  }
}

export interface TelegramStore {
  findProcessedUpdate(updateId: bigint): Promise<readonly TelegramResponse[] | undefined>;
  recordProcessedUpdate(input: {
    callbackId?: string;
    chatId: bigint;
    responses: readonly TelegramResponse[];
    updateId: bigint;
    userId: bigint;
  }): Promise<RecordTelegramUpdateResult>;
  listProjects(): Promise<readonly TelegramProject[]>;
  selectProject(userId: bigint, chatId: bigint, projectId: string): Promise<TelegramProject>;
  getSelectedProject(userId: bigint): Promise<TelegramProject | undefined>;
  setVerboseLevel(userId: bigint, chatId: bigint, level: 0 | 1 | 2): Promise<number>;
  findTaskStatus(userId: bigint, taskId?: string): Promise<TelegramTaskStatus | undefined>;
  decideApproval(input: {
    approvalId: string;
    callbackId: string;
    correlationId: string;
    decision: "APPROVED" | "REJECTED";
    userId: bigint;
  }): Promise<ApprovalDecisionResult>;
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function snapshot(task: {
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

function approvalView(approval: TelegramApproval): TelegramApproval {
  return {
    id: approval.id,
    targetHash: approval.targetHash,
    targetId: approval.targetId,
    targetType: approval.targetType,
    targetVersion: approval.targetVersion,
    type: approval.type,
  };
}

export class PrismaTelegramStore implements TelegramStore {
  constructor(private readonly prisma: PrismaClient) {}

  async findProcessedUpdate(updateId: bigint): Promise<readonly TelegramResponse[] | undefined> {
    const update = await this.prisma.telegramUpdate.findUnique({ where: { updateId } });
    return update === null ? undefined : parseResponses(update.response);
  }

  async recordProcessedUpdate(input: {
    callbackId?: string;
    chatId: bigint;
    responses: readonly TelegramResponse[];
    updateId: bigint;
    userId: bigint;
  }): Promise<RecordTelegramUpdateResult> {
    try {
      const created = await this.prisma.telegramUpdate.create({
        data: {
          chatId: input.chatId,
          response: json(input.responses),
          updateId: input.updateId,
          userId: input.userId,
          ...(input.callbackId === undefined ? {} : { callbackId: input.callbackId }),
        },
      });
      return {
        idempotentReplay: false,
        responses: parseResponses(created.response),
      };
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const existing =
          input.callbackId === undefined
            ? await this.prisma.telegramUpdate.findUniqueOrThrow({
                where: { updateId: input.updateId },
              })
            : await this.prisma.telegramUpdate.findFirstOrThrow({
                where: {
                  OR: [{ updateId: input.updateId }, { callbackId: input.callbackId }],
                },
              });
        return {
          idempotentReplay: true,
          responses: parseResponses(existing.response),
        };
      }
      throw error;
    }
  }

  async listProjects(): Promise<readonly TelegramProject[]> {
    return this.prisma.project.findMany({
      where: { status: { not: "ARCHIVED" } },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
  }

  async selectProject(userId: bigint, chatId: bigint, projectId: string): Promise<TelegramProject> {
    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { id: true, name: true },
    });
    await this.prisma.telegramSession.upsert({
      where: { userId },
      create: { chatId, selectedProjectId: projectId, userId },
      update: { chatId, selectedProjectId: projectId },
    });
    return project;
  }

  async getSelectedProject(userId: bigint): Promise<TelegramProject | undefined> {
    const session = await this.prisma.telegramSession.findUnique({
      where: { userId },
      select: { selectedProject: { select: { id: true, name: true } } },
    });
    return session?.selectedProject ?? undefined;
  }

  async setVerboseLevel(userId: bigint, chatId: bigint, level: 0 | 1 | 2): Promise<number> {
    const session = await this.prisma.telegramSession.upsert({
      where: { userId },
      create: { chatId, userId, verboseLevel: level },
      update: { chatId, verboseLevel: level },
      select: { verboseLevel: true },
    });
    return session.verboseLevel;
  }

  async findTaskStatus(userId: bigint, taskId?: string): Promise<TelegramTaskStatus | undefined> {
    const task = await this.prisma.task.findFirst({
      where: {
        origin: `telegram:${userId.toString()}`,
        ...(taskId === undefined ? {} : { id: taskId }),
      },
      orderBy: { createdAt: "desc" },
      include: {
        approvals: {
          where: { status: ApprovalStatus.PENDING },
          orderBy: { requestedAt: "asc" },
        },
      },
    });
    if (task === null) {
      return undefined;
    }
    return {
      approvals: task.approvals.map(approvalView),
      task: snapshot(task),
    };
  }

  async decideApproval(input: {
    approvalId: string;
    callbackId: string;
    correlationId: string;
    decision: "APPROVED" | "REJECTED";
    userId: bigint;
  }): Promise<ApprovalDecisionResult> {
    const idempotencyKey = `telegram:callback:${input.callbackId}:approval`;
    const outcome = await this.prisma.$transaction(async (transaction) => {
      const existingAudit = await transaction.auditEvent.findUnique({
        where: { idempotencyKey },
      });
      if (existingAudit !== null) {
        const replay = decisionReplaySchema.parse(existingAudit.payload);
        const approval = await transaction.approval.findUniqueOrThrow({
          where: { id: replay.approvalId },
        });
        const task = await transaction.task.findUniqueOrThrow({
          where: { id: approval.taskId },
        });
        return {
          kind: "success" as const,
          result: {
            approval: approvalView(approval),
            decision: replay.decision,
            idempotentReplay: true,
            task: snapshot(task),
          },
        };
      }

      const approval = await transaction.approval.findFirstOrThrow({
        where: {
          id: input.approvalId,
          task: { origin: `telegram:${input.userId.toString()}` },
        },
        include: { task: true },
      });
      if (approval.targetType === "SPECIFICATION") {
        const specification = await transaction.specification.findUnique({
          where: { id: approval.targetId },
        });
        const parsedPayload =
          specification === null
            ? undefined
            : executableSpecificationPayloadSchema.safeParse(specification.payload);
        const expectedHash =
          specification === null || parsedPayload?.success !== true
            ? null
            : canonicalPayloadHash(parsedPayload.data);
        const targetIsCurrent =
          specification !== null &&
          specification.taskId === approval.taskId &&
          approval.task.activeSpecificationId === specification.id &&
          approval.targetVersion === specification.version &&
          specification.payloadHash === expectedHash &&
          approval.targetHash === expectedHash;
        if (!targetIsCurrent) {
          await transaction.auditEvent.upsert({
            where: { idempotencyKey: `${idempotencyKey}:hash-mismatch` },
            create: {
              action: "approval.target_hash_mismatch",
              actor: "USER",
              correlationId: input.correlationId,
              idempotencyKey: `${idempotencyKey}:hash-mismatch`,
              payload: json({
                approvalId: approval.id,
                expectedHash,
                recordedHash: approval.targetHash,
                targetId: approval.targetId,
                targetVersion: approval.targetVersion,
              }),
              projectId: approval.task.projectId,
              targetId: approval.targetId,
              targetType: approval.targetType,
              taskId: approval.taskId,
            },
            update: {},
          });
          return {
            approvalId: approval.id,
            expectedHash,
            kind: "hash_mismatch" as const,
            recordedHash: approval.targetHash,
          };
        }
      } else if (approval.targetType === "EXECUTION_RESULT") {
        const execution = await transaction.execution.findUnique({
          where: { id: approval.targetId },
        });
        const presented = z
          .object({ diffHash: z.string(), resultHash: z.string() })
          .safeParse(approval.presentedPayload);
        const expectedHash = execution?.resultHash ?? null;
        const targetIsCurrent =
          execution !== null &&
          execution.taskId === approval.taskId &&
          execution.attempt === approval.targetVersion &&
          execution.resultHash !== null &&
          execution.diffHash !== null &&
          approval.targetHash === execution.resultHash &&
          presented.success &&
          presented.data.resultHash === execution.resultHash &&
          presented.data.diffHash === execution.diffHash;
        if (!targetIsCurrent) {
          await transaction.auditEvent.upsert({
            where: { idempotencyKey: `${idempotencyKey}:hash-mismatch` },
            create: {
              action: "approval.target_hash_mismatch",
              actor: "USER",
              correlationId: input.correlationId,
              idempotencyKey: `${idempotencyKey}:hash-mismatch`,
              payload: json({
                approvalId: approval.id,
                expectedHash,
                recordedHash: approval.targetHash,
                targetId: approval.targetId,
                targetVersion: approval.targetVersion,
              }),
              projectId: approval.task.projectId,
              targetId: approval.targetId,
              targetType: approval.targetType,
              taskId: approval.taskId,
            },
            update: {},
          });
          return {
            approvalId: approval.id,
            expectedHash,
            kind: "hash_mismatch" as const,
            recordedHash: approval.targetHash,
          };
        }
        if (input.decision === "APPROVED") {
          const review = await transaction.postExecutionReview.findUnique({
            where: { executionId: execution.id },
          });
          if (review?.status !== "APPROVED") {
            await transaction.auditEvent.upsert({
              where: { idempotencyKey: `${idempotencyKey}:qa-pending` },
              create: {
                action: "approval.post_execution_review_pending",
                actor: "USER",
                correlationId: input.correlationId,
                idempotencyKey: `${idempotencyKey}:qa-pending`,
                payload: json({ approvalId: approval.id, reviewStatus: review?.status ?? null }),
                projectId: approval.task.projectId,
                targetId: approval.targetId,
                targetType: approval.targetType,
                taskId: approval.taskId,
              },
              update: {},
            });
            return { approvalId: approval.id, kind: "qa_pending" as const };
          }
        }
      }
      const updated = await transaction.approval.updateMany({
        where: { id: approval.id, status: ApprovalStatus.PENDING },
        data: {
          decidedBy: `telegram:${input.userId.toString()}`,
          respondedAt: new Date(),
          status: input.decision === "APPROVED" ? ApprovalStatus.APPROVED : ApprovalStatus.REJECTED,
        },
      });
      if (updated.count !== 1) {
        throw new Error("Approval is no longer pending");
      }
      let decidedTask = approval.task;
      if (
        approval.targetType === "EXECUTION_RESULT" &&
        approval.task.state === "WAITING_RESULT_APPROVAL"
      ) {
        const nextState = input.decision === "APPROVED" ? "FINALIZING" : "SPECIFYING";
        decidedTask = await transaction.task.update({
          where: { id: approval.taskId },
          data: { state: nextState, version: { increment: 1 } },
        });
        await transaction.execution.update({
          where: { id: approval.targetId },
          data: {
            status: input.decision === "APPROVED" ? "FINALIZING" : "FAILED",
            ...(input.decision === "REJECTED" ? { failureStage: "result_review" } : {}),
          },
        });
        await transaction.auditEvent.create({
          data: {
            action: "task.transitioned",
            actor: "USER",
            correlationId: input.correlationId,
            idempotencyKey: `${idempotencyKey}:task-transition`,
            payload: json({
              fromState: "WAITING_RESULT_APPROVAL",
              toState: nextState,
            }),
            projectId: approval.task.projectId,
            targetId: approval.taskId,
            targetType: "TASK",
            taskId: approval.taskId,
          },
        });
      }
      const payload = {
        approvalId: approval.id,
        decision: input.decision,
        targetHash: approval.targetHash,
        targetId: approval.targetId,
        targetType: approval.targetType,
        targetVersion: approval.targetVersion,
      };
      await transaction.auditEvent.create({
        data: {
          action: "approval.decided",
          actor: "USER",
          correlationId: input.correlationId,
          idempotencyKey,
          payload,
          projectId: approval.task.projectId,
          targetId: approval.targetId,
          targetType: approval.targetType,
          taskId: approval.taskId,
        },
      });
      return {
        kind: "success" as const,
        result: {
          approval: approvalView(approval),
          decision: input.decision,
          idempotentReplay: false,
          task: snapshot(decidedTask),
        },
      };
    });
    if (outcome.kind === "hash_mismatch") {
      throw new ApprovalTargetHashMismatchError(
        outcome.approvalId,
        outcome.expectedHash,
        outcome.recordedHash,
      );
    }
    if (outcome.kind === "qa_pending") {
      throw new PostExecutionReviewPendingError(outcome.approvalId);
    }
    return outcome.result;
  }
}
