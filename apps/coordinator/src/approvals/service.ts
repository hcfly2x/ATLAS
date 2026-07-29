import {
  ApprovalActor,
  ApprovalStatus,
  type Prisma,
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

const decisionReplaySchema = z.object({
  approvalId: z.string(),
  channel: z.enum(["DASHBOARD", "TELEGRAM"]).optional(),
  comment: z.string().optional(),
  decision: z.enum(["APPROVED", "REJECTED"]),
  decisionKind: z.enum(["approve", "reject", "request_change"]).optional(),
  requestHash: z.string().optional(),
  targetHash: z.string(),
  targetId: z.string(),
  targetType: z.string(),
  targetVersion: z.number().int().nullable(),
});

export interface ApprovalDecisionView {
  readonly id: string;
  readonly targetHash: string;
  readonly targetId: string;
  readonly targetType: ApprovalTargetType;
  readonly targetVersion: number | null;
  readonly type: ApprovalType;
}

export interface ApprovalDecisionResult {
  readonly approval: ApprovalDecisionView;
  readonly decision: "APPROVED" | "REJECTED";
  readonly decisionKind: "approve" | "reject" | "request_change";
  readonly idempotentReplay: boolean;
  readonly task: TaskSnapshot;
}

export interface DecideApprovalInput {
  readonly approvalId: string;
  readonly channel: "DASHBOARD" | "TELEGRAM";
  readonly comment?: string | undefined;
  readonly correlationId: string;
  readonly decidedBy: string;
  readonly decision: "APPROVED" | "REJECTED";
  readonly decisionKind: "approve" | "reject" | "request_change";
  readonly denySensitiveApproval?: boolean | undefined;
  readonly expectedTargetVersion?: number | undefined;
  readonly expectedTaskVersion?: number | undefined;
  readonly idempotencyKey: string;
  readonly requireHumanActor?: boolean | undefined;
  readonly taskOrigin?: string | undefined;
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

export class ApprovalDecisionNotFoundError extends Error {
  readonly code = "APPROVAL_NOT_FOUND";

  constructor() {
    super("Approval was not found");
    this.name = "ApprovalDecisionNotFoundError";
  }
}

export class ApprovalDecisionNotHumanError extends Error {
  readonly code = "APPROVAL_NOT_HUMAN";

  constructor() {
    super("Approval is not assigned to a human");
    this.name = "ApprovalDecisionNotHumanError";
  }
}

export class ApprovalDecisionNotPendingError extends Error {
  readonly code = "APPROVAL_NOT_PENDING";

  constructor() {
    super("Approval is no longer pending");
    this.name = "ApprovalDecisionNotPendingError";
  }
}

export class ApprovalDecisionVersionConflictError extends Error {
  readonly code = "APPROVAL_VERSION_CONFLICT";

  constructor() {
    super("Approval target version no longer matches");
    this.name = "ApprovalDecisionVersionConflictError";
  }
}

export class ApprovalDecisionIdempotencyConflictError extends Error {
  readonly code = "APPROVAL_IDEMPOTENCY_CONFLICT";

  constructor() {
    super("Approval idempotency key was reused with another decision");
    this.name = "ApprovalDecisionIdempotencyConflictError";
  }
}

export class SensitiveApprovalDashboardDeniedError extends Error {
  readonly code = "SENSITIVE_APPROVAL_DASHBOARD_DENIED";

  constructor() {
    super("Sensitive approvals cannot be approved from this dashboard phase");
    this.name = "SensitiveApprovalDashboardDeniedError";
  }
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

function approvalView(approval: ApprovalDecisionView): ApprovalDecisionView {
  return {
    id: approval.id,
    targetHash: approval.targetHash,
    targetId: approval.targetId,
    targetType: approval.targetType,
    targetVersion: approval.targetVersion,
    type: approval.type,
  };
}

function requestHash(input: DecideApprovalInput): string {
  return canonicalPayloadHash({
    approvalId: input.approvalId,
    channel: input.channel,
    comment: input.comment ?? null,
    decision: input.decision,
    decisionKind: input.decisionKind,
    expectedTargetVersion: input.expectedTargetVersion ?? null,
    expectedTaskVersion: input.expectedTaskVersion ?? null,
  });
}

type Transaction = Prisma.TransactionClient;

export class PrismaApprovalDecisionService {
  constructor(private readonly prisma: PrismaClient) {}

  async decide(input: DecideApprovalInput): Promise<ApprovalDecisionResult> {
    const currentRequestHash = requestHash(input);
    try {
      const outcome = await this.prisma.$transaction(async (transaction) =>
        this.decideInTransaction(transaction, input, currentRequestHash),
      );
      return this.unwrap(outcome);
    } catch (error: unknown) {
      const replay = await this.replay(input.idempotencyKey, currentRequestHash);
      if (replay !== undefined) return replay;
      throw error;
    }
  }

  private async replay(
    idempotencyKey: string,
    currentRequestHash: string,
  ): Promise<ApprovalDecisionResult | undefined> {
    const existingAudit = await this.prisma.auditEvent.findUnique({
      where: { idempotencyKey },
    });
    if (existingAudit?.action !== "approval.decided") return undefined;
    const replay = decisionReplaySchema.parse(existingAudit.payload);
    if (replay.requestHash !== undefined && replay.requestHash !== currentRequestHash) {
      throw new ApprovalDecisionIdempotencyConflictError();
    }
    const approval = await this.prisma.approval.findUniqueOrThrow({
      where: { id: replay.approvalId },
    });
    const task = await this.prisma.task.findUniqueOrThrow({
      where: { id: approval.taskId },
    });
    return {
      approval: approvalView(approval),
      decision: replay.decision,
      decisionKind: replay.decisionKind ?? (replay.decision === "APPROVED" ? "approve" : "reject"),
      idempotentReplay: true,
      task: snapshot(task),
    };
  }

  private async decideInTransaction(
    transaction: Transaction,
    input: DecideApprovalInput,
    currentRequestHash: string,
  ) {
    const existingAudit = await transaction.auditEvent.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existingAudit !== null) {
      if (existingAudit.action !== "approval.decided") {
        return { kind: "idempotency_conflict" as const };
      }
      const replay = decisionReplaySchema.parse(existingAudit.payload);
      if (replay.requestHash !== undefined && replay.requestHash !== currentRequestHash) {
        return { kind: "idempotency_conflict" as const };
      }
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
          decisionKind:
            replay.decisionKind ?? (replay.decision === "APPROVED" ? "approve" : "reject"),
          idempotentReplay: true,
          task: snapshot(task),
        },
      };
    }

    const approval = await transaction.approval.findUnique({
      where: { id: input.approvalId },
      include: { task: true },
    });
    if (
      approval === null ||
      (input.taskOrigin !== undefined && approval.task.origin !== input.taskOrigin)
    ) {
      return { kind: "not_found" as const };
    }
    if (input.requireHumanActor === true && approval.actor !== ApprovalActor.USER) {
      return { kind: "not_human" as const };
    }
    if (approval.status !== ApprovalStatus.PENDING) {
      return { kind: "not_pending" as const };
    }
    if (
      input.expectedTargetVersion !== undefined &&
      approval.targetVersion !== input.expectedTargetVersion
    ) {
      return { kind: "version_conflict" as const };
    }
    if (
      input.expectedTaskVersion !== undefined &&
      approval.task.version !== input.expectedTaskVersion
    ) {
      return { kind: "version_conflict" as const };
    }
    if (
      input.denySensitiveApproval === true &&
      input.decision === "APPROVED" &&
      (approval.type === "SENSITIVE_ACTION" || approval.targetType === "SENSITIVE_ACTION")
    ) {
      return { kind: "sensitive_denied" as const };
    }

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
        await this.auditTargetMismatch(
          transaction,
          input,
          approval,
          expectedHash,
          currentRequestHash,
        );
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
        await this.auditTargetMismatch(
          transaction,
          input,
          approval,
          expectedHash,
          currentRequestHash,
        );
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
            where: { idempotencyKey: `${input.idempotencyKey}:qa-pending` },
            create: {
              action: "approval.post_execution_review_pending",
              actor: "USER",
              correlationId: input.correlationId,
              idempotencyKey: `${input.idempotencyKey}:qa-pending`,
              payload: json({
                approvalId: approval.id,
                reason: "post_execution_review_not_approved",
                requestHash: currentRequestHash,
                reviewStatus: review?.status ?? null,
              }),
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
      where: {
        id: approval.id,
        status: ApprovalStatus.PENDING,
        ...(input.requireHumanActor === true ? { actor: ApprovalActor.USER } : {}),
        ...(input.expectedTargetVersion === undefined
          ? {}
          : { targetVersion: input.expectedTargetVersion }),
        ...(input.expectedTaskVersion === undefined
          ? {}
          : { task: { version: input.expectedTaskVersion } }),
      },
      data: {
        decidedBy: input.decidedBy,
        respondedAt: new Date(),
        status: input.decision === "APPROVED" ? ApprovalStatus.APPROVED : ApprovalStatus.REJECTED,
      },
    });
    if (updated.count !== 1) {
      if (input.expectedTaskVersion !== undefined) {
        const current = await transaction.approval.findUnique({
          where: { id: approval.id },
          select: { status: true, task: { select: { version: true } } },
        });
        if (
          current?.status === ApprovalStatus.PENDING &&
          current.task.version !== input.expectedTaskVersion
        ) {
          throw new ApprovalDecisionVersionConflictError();
        }
      }
      throw new ApprovalDecisionNotPendingError();
    }

    const decidedTask = await this.transitionTask(transaction, input, approval);
    const payload = {
      approvalId: approval.id,
      channel: input.channel,
      ...(input.comment === undefined ? {} : { comment: input.comment }),
      decision: input.decision,
      decisionKind: input.decisionKind,
      requestHash: currentRequestHash,
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
        idempotencyKey: input.idempotencyKey,
        payload: json(payload),
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
        decisionKind: input.decisionKind,
        idempotentReplay: false,
        task: snapshot(decidedTask),
      },
    };
  }

  private async transitionTask(
    transaction: Transaction,
    input: DecideApprovalInput,
    approval: {
      targetId: string;
      targetType: ApprovalTargetType;
      task: {
        failureStage: string | null;
        id: string;
        projectId: string;
        state: TaskState;
        version: number;
      };
      taskId: string;
      type: ApprovalType;
    },
  ) {
    let nextState: TaskState | undefined;
    if (approval.type === "PRE_EXECUTION" && approval.task.state === "WAITING_APPROVAL") {
      nextState = input.decision === "APPROVED" ? "QUEUED" : "CANCELLED";
    } else if (
      approval.targetType === "EXECUTION_RESULT" &&
      approval.task.state === "WAITING_RESULT_APPROVAL"
    ) {
      nextState = input.decision === "APPROVED" ? "FINALIZING" : "SPECIFYING";
    }
    if (nextState === undefined) return approval.task;

    const transitioned = await transaction.task.updateMany({
      where: {
        id: approval.taskId,
        state: approval.task.state,
        version: approval.task.version,
      },
      data: { state: nextState, version: { increment: 1 } },
    });
    if (transitioned.count !== 1) {
      throw new ApprovalDecisionVersionConflictError();
    }
    const task = await transaction.task.findUniqueOrThrow({
      where: { id: approval.taskId },
    });
    if (approval.targetType === "EXECUTION_RESULT") {
      await transaction.execution.update({
        where: { id: approval.targetId },
        data: {
          status: input.decision === "APPROVED" ? "FINALIZING" : "FAILED",
          ...(input.decision === "REJECTED" ? { failureStage: "result_review" } : {}),
        },
      });
    }
    await transaction.auditEvent.create({
      data: {
        action:
          approval.type === "PRE_EXECUTION" ? "task.transition.accepted" : "task.transitioned",
        actor: "USER",
        correlationId: input.correlationId,
        idempotencyKey: `${input.idempotencyKey}:task-transition`,
        payload:
          approval.type === "PRE_EXECUTION"
            ? json({ fromState: approval.task.state, task: snapshot(task) })
            : json({ fromState: approval.task.state, toState: nextState }),
        projectId: approval.task.projectId,
        targetId: approval.taskId,
        targetType: approval.type === "PRE_EXECUTION" ? "task" : "TASK",
        taskId: approval.taskId,
      },
    });
    return task;
  }

  private async auditTargetMismatch(
    transaction: Transaction,
    input: DecideApprovalInput,
    approval: {
      id: string;
      targetHash: string;
      targetId: string;
      targetType: ApprovalTargetType;
      targetVersion: number | null;
      task: { projectId: string };
      taskId: string;
    },
    expectedHash: string | null,
    currentRequestHash: string,
  ): Promise<void> {
    await transaction.auditEvent.upsert({
      where: { idempotencyKey: `${input.idempotencyKey}:hash-mismatch` },
      create: {
        action: "approval.target_hash_mismatch",
        actor: "USER",
        correlationId: input.correlationId,
        idempotencyKey: `${input.idempotencyKey}:hash-mismatch`,
        payload: json({
          approvalId: approval.id,
          expectedHash,
          recordedHash: approval.targetHash,
          requestHash: currentRequestHash,
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
  }

  private unwrap(
    outcome:
      | {
          readonly kind: "success";
          readonly result: ApprovalDecisionResult;
        }
      | {
          readonly approvalId: string;
          readonly expectedHash: string | null;
          readonly kind: "hash_mismatch";
          readonly recordedHash: string;
        }
      | { readonly approvalId: string; readonly kind: "qa_pending" }
      | {
          readonly kind:
            | "idempotency_conflict"
            | "not_found"
            | "not_human"
            | "not_pending"
            | "sensitive_denied"
            | "version_conflict";
        },
  ): ApprovalDecisionResult {
    switch (outcome.kind) {
      case "success":
        return outcome.result;
      case "hash_mismatch":
        throw new ApprovalTargetHashMismatchError(
          outcome.approvalId,
          outcome.expectedHash,
          outcome.recordedHash,
        );
      case "qa_pending":
        throw new PostExecutionReviewPendingError(outcome.approvalId);
      case "idempotency_conflict":
        throw new ApprovalDecisionIdempotencyConflictError();
      case "not_found":
        throw new ApprovalDecisionNotFoundError();
      case "not_human":
        throw new ApprovalDecisionNotHumanError();
      case "not_pending":
        throw new ApprovalDecisionNotPendingError();
      case "sensitive_denied":
        throw new SensitiveApprovalDashboardDeniedError();
      case "version_conflict":
        throw new ApprovalDecisionVersionConflictError();
    }
  }
}
