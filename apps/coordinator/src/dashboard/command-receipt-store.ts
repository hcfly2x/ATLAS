import {
  AuditActor,
  DashboardCommandReceiptStatus,
  DashboardCommandType,
  Prisma,
  type PrismaClient,
} from "@prisma/client";

import {
  TaskIdempotencyConflictError,
  TaskNotFoundError,
  TaskVersionConflictError,
  type TaskCoreStore,
  type TaskSnapshot,
} from "@atlas/core";
import {
  taskPauseOriginSchema,
  taskPrioritySchema,
  taskStateSchema,
  type TaskPriority,
} from "@atlas/shared";

import { PrismaTaskCoreStore } from "../core/prisma-task-core-store.js";

export type DashboardCommandKind =
  "cancel_task" | "create_demand" | "pause_task" | "resume_task" | "set_task_priority";

export class DashboardTaskPriorityConflictError extends Error {
  constructor() {
    super("Task priority cannot be changed in its current state");
    this.name = "DashboardTaskPriorityConflictError";
  }
}

export interface DashboardCommandTaskStore extends TaskCoreStore {
  canResumeTask(task: TaskSnapshot): Promise<boolean>;
  setTaskPriority(input: {
    readonly correlationId: string;
    readonly expectedVersion: number;
    readonly idempotencyKey: string;
    readonly priority: TaskPriority;
    readonly requestHash: string;
    readonly taskId: string;
  }): Promise<TaskSnapshot>;
}

export interface DashboardCommandReceiptClaim {
  readonly actor: "user";
  readonly command: DashboardCommandKind;
  readonly correlationId: string;
  readonly expectedVersion?: number;
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly requestedProject?: string;
  readonly targetTaskId?: string;
}

export type DashboardCommandOperationResult<Result> =
  | {
      readonly resultCode: string;
      readonly resultPayload: Result;
      readonly status: "accepted";
    }
  | {
      readonly resultCode: string;
      readonly status: "rejected";
    };

export type DashboardCommandReceiptResult<Result> = DashboardCommandOperationResult<Result> & {
  readonly idempotentReplay: boolean;
};

export interface DashboardCommandReceiptStore {
  execute<Result>(
    input: DashboardCommandReceiptClaim,
    operation: (
      taskStore: DashboardCommandTaskStore,
    ) => Promise<DashboardCommandOperationResult<Result>>,
  ): Promise<DashboardCommandReceiptResult<Result>>;
}

export class DashboardCommandOutcomeUnknownError extends Error {
  constructor() {
    super("Dashboard command outcome is pending or unknown");
    this.name = "DashboardCommandOutcomeUnknownError";
  }
}

const commandMap: Record<DashboardCommandKind, DashboardCommandType> = {
  cancel_task: DashboardCommandType.CANCEL_TASK,
  create_demand: DashboardCommandType.CREATE_DEMAND,
  pause_task: DashboardCommandType.PAUSE_TASK,
  resume_task: DashboardCommandType.RESUME_TASK,
  set_task_priority: DashboardCommandType.SET_TASK_PRIORITY,
};

function snapshot(task: {
  readonly failureStage: string | null;
  readonly id: string;
  readonly pausedFromState: "WAITING_APPROVAL" | "QUEUED" | null;
  readonly priority: number;
  readonly projectId: string;
  readonly state: string;
  readonly version: number;
}): TaskSnapshot {
  return {
    ...(task.failureStage === null ? {} : { failureStage: task.failureStage }),
    id: task.id,
    ...(task.pausedFromState === null
      ? {}
      : { pausedFromState: taskPauseOriginSchema.parse(task.pausedFromState) }),
    priority: taskPrioritySchema.parse(task.priority),
    projectId: task.projectId,
    state: taskStateSchema.parse(task.state),
    version: task.version,
  };
}

class PrismaDashboardCommandTaskStore
  extends PrismaTaskCoreStore
  implements DashboardCommandTaskStore
{
  constructor(private readonly transactionClient: Prisma.TransactionClient) {
    super(transactionClient);
  }

  async canResumeTask(task: TaskSnapshot): Promise<boolean> {
    if (task.state !== "PAUSED" || task.pausedFromState === undefined) return false;
    const persisted = await this.transactionClient.task.findUnique({
      where: { id: task.id },
      select: { activeSpecificationId: true },
    });
    if (persisted?.activeSpecificationId === null || persisted === null) return false;
    if (task.pausedFromState === "WAITING_APPROVAL") {
      const approval = await this.transactionClient.approval.findFirst({
        where: {
          actor: "USER",
          status: "PENDING",
          targetId: persisted.activeSpecificationId,
          targetType: "SPECIFICATION",
          taskId: task.id,
          type: "PRE_EXECUTION",
        },
        select: { id: true },
      });
      return approval !== null;
    }
    const activeExecution = await this.transactionClient.execution.findFirst({
      where: {
        specificationId: persisted.activeSpecificationId,
        status: {
          in: ["RUNNING", "TESTING", "AWAITING_RESULT_APPROVAL", "FINALIZING", "CANCEL_REQUESTED"],
        },
        taskId: task.id,
      },
      select: { id: true },
    });
    return activeExecution === null;
  }

  async setTaskPriority(input: {
    readonly correlationId: string;
    readonly expectedVersion: number;
    readonly idempotencyKey: string;
    readonly priority: TaskPriority;
    readonly requestHash: string;
    readonly taskId: string;
  }): Promise<TaskSnapshot> {
    const current = await this.transactionClient.task.findUnique({ where: { id: input.taskId } });
    if (current === null) throw new TaskNotFoundError(input.taskId);
    if (current.version !== input.expectedVersion) {
      throw new TaskVersionConflictError(input.expectedVersion, current.version);
    }
    if (
      current.state !== "WAITING_APPROVAL" &&
      current.state !== "QUEUED" &&
      current.state !== "PAUSED"
    ) {
      throw new DashboardTaskPriorityConflictError();
    }
    const updated = await this.transactionClient.task.updateMany({
      where: {
        id: input.taskId,
        state: { in: ["WAITING_APPROVAL", "QUEUED", "PAUSED"] },
        version: input.expectedVersion,
      },
      data: { priority: input.priority, version: { increment: 1 } },
    });
    if (updated.count !== 1) {
      const latest = await this.transactionClient.task.findUniqueOrThrow({
        where: { id: input.taskId },
      });
      throw new TaskVersionConflictError(input.expectedVersion, latest.version);
    }
    const task = snapshot(
      await this.transactionClient.task.findUniqueOrThrow({ where: { id: input.taskId } }),
    );
    await this.transactionClient.auditEvent.create({
      data: {
        action: "task.priority.updated",
        actor: AuditActor.USER,
        correlationId: input.correlationId,
        idempotencyKey: input.idempotencyKey,
        payload: json({
          expectedVersion: input.expectedVersion,
          fromPriority: current.priority,
          requestHash: input.requestHash,
          state: current.state,
          taskVersion: task.version,
          toPriority: input.priority,
        }),
        projectId: current.projectId,
        targetId: task.id,
        targetType: "task",
        taskId: task.id,
      },
    });
    return task;
  }
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export class PrismaDashboardCommandReceiptStore implements DashboardCommandReceiptStore {
  constructor(private readonly prisma: PrismaClient) {}

  async execute<Result>(
    input: DashboardCommandReceiptClaim,
    operation: (
      taskStore: DashboardCommandTaskStore,
    ) => Promise<DashboardCommandOperationResult<Result>>,
  ): Promise<DashboardCommandReceiptResult<Result>> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const existing = await transaction.dashboardCommandReceipt.findUnique({
          where: { idempotencyKey: input.idempotencyKey },
        });
        if (existing !== null) {
          return this.replay<Result>(existing, input);
        }

        await transaction.dashboardCommandReceipt.create({
          data: {
            actor: AuditActor.USER,
            commandType: commandMap[input.command],
            correlationId: input.correlationId,
            idempotencyKey: input.idempotencyKey,
            requestHash: input.requestHash,
            ...(input.expectedVersion === undefined
              ? {}
              : { expectedVersion: input.expectedVersion }),
            ...(input.requestedProject === undefined
              ? {}
              : { requestedProject: input.requestedProject }),
            ...(input.targetTaskId === undefined ? {} : { targetTaskId: input.targetTaskId }),
          },
        });

        const result = await operation(new PrismaDashboardCommandTaskStore(transaction));
        await transaction.dashboardCommandReceipt.update({
          where: { idempotencyKey: input.idempotencyKey },
          data: {
            resultCode: result.resultCode,
            resultPayload:
              result.status === "accepted" ? json(result.resultPayload) : Prisma.JsonNull,
            status:
              result.status === "accepted"
                ? DashboardCommandReceiptStatus.ACCEPTED
                : DashboardCommandReceiptStatus.REJECTED,
          },
        });
        return { ...result, idempotentReplay: false };
      });
    } catch (error: unknown) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
        throw error;
      }
      const existing = await this.prisma.dashboardCommandReceipt.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (existing === null) throw error;
      return this.replay<Result>(existing, input);
    }
  }

  private replay<Result>(
    existing: {
      readonly commandType: DashboardCommandType;
      readonly requestHash: string;
      readonly resultCode: string | null;
      readonly resultPayload: Prisma.JsonValue | null;
      readonly status: DashboardCommandReceiptStatus;
    },
    input: DashboardCommandReceiptClaim,
  ): DashboardCommandReceiptResult<Result> {
    if (
      existing.commandType !== commandMap[input.command] ||
      existing.requestHash !== input.requestHash
    ) {
      throw new TaskIdempotencyConflictError();
    }
    if (existing.status === DashboardCommandReceiptStatus.PENDING || existing.resultCode === null) {
      throw new DashboardCommandOutcomeUnknownError();
    }
    return existing.status === DashboardCommandReceiptStatus.ACCEPTED
      ? {
          idempotentReplay: true,
          resultCode: existing.resultCode,
          resultPayload: existing.resultPayload as Result,
          status: "accepted",
        }
      : {
          idempotentReplay: true,
          resultCode: existing.resultCode,
          status: "rejected",
        };
  }
}
