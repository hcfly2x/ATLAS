import {
  AuditActor,
  DashboardCommandReceiptStatus,
  DashboardCommandType,
  Prisma,
  type PrismaClient,
} from "@prisma/client";

import { TaskIdempotencyConflictError, type TaskCoreStore } from "@atlas/core";

import { PrismaTaskCoreStore } from "../core/prisma-task-core-store.js";

export type DashboardCommandKind = "cancel_task" | "create_demand";

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
    operation: (taskStore: TaskCoreStore) => Promise<DashboardCommandOperationResult<Result>>,
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
};

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export class PrismaDashboardCommandReceiptStore implements DashboardCommandReceiptStore {
  constructor(private readonly prisma: PrismaClient) {}

  async execute<Result>(
    input: DashboardCommandReceiptClaim,
    operation: (taskStore: TaskCoreStore) => Promise<DashboardCommandOperationResult<Result>>,
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

        const result = await operation(new PrismaTaskCoreStore(transaction));
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
