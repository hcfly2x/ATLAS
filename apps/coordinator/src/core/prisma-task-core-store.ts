import {
  AuditActor as PrismaAuditActor,
  Prisma,
  TaskState as PrismaTaskState,
} from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";

import {
  TaskIdempotencyConflictError,
  TaskProjectNotEligibleError,
  TaskVersionConflictError,
  type CommitTransitionInput,
  type CreateTaskInput,
  type CreateTaskResult,
  type RejectedTransition,
  type TaskCoreStore,
  type TaskSnapshot,
  type TaskTransitionResult,
} from "@atlas/core";
import { auditActorSchema, taskStateSchema, type AuditActor, type TaskState } from "@atlas/shared";

const snapshotSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  state: taskStateSchema,
  version: z.number().int().nonnegative(),
  failureStage: z.string().optional(),
});

const transitionAuditPayloadSchema = z.object({
  fromState: taskStateSchema,
  reasonCode: z.string().optional(),
  requestHash: z.string().optional(),
  task: snapshotSchema,
});

const taskCreatedAuditPayloadSchema = z.object({
  requestHash: z.string().optional(),
  task: snapshotSchema,
});

const actorMap: Record<AuditActor, PrismaAuditActor> = {
  user: PrismaAuditActor.USER,
  agent: PrismaAuditActor.AGENT,
  worker: PrismaAuditActor.WORKER,
  system: PrismaAuditActor.SYSTEM,
};

function toSnapshot(task: {
  id: string;
  projectId: string;
  state: PrismaTaskState;
  version: number;
  failureStage: string | null;
}): TaskSnapshot {
  return {
    id: task.id,
    projectId: task.projectId,
    state: taskStateSchema.parse(task.state),
    version: task.version,
    ...(task.failureStage === null ? {} : { failureStage: task.failureStage }),
  };
}

function parsedSnapshot(task: z.infer<typeof snapshotSchema>): TaskSnapshot {
  return {
    id: task.id,
    projectId: task.projectId,
    state: task.state,
    version: task.version,
    ...(task.failureStage === undefined ? {} : { failureStage: task.failureStage }),
  };
}

function toPrismaState(state: TaskState): PrismaTaskState {
  return PrismaTaskState[state];
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export class PrismaTaskCoreStore implements TaskCoreStore {
  constructor(private readonly prisma: PrismaClient) {}

  async createTask(input: CreateTaskInput): Promise<CreateTaskResult> {
    const existing = await this.prisma.task.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existing !== null) {
      const audit = await this.prisma.auditEvent.findUniqueOrThrow({
        where: { idempotencyKey: `${input.idempotencyKey}:created` },
      });
      const payload = taskCreatedAuditPayloadSchema.parse(audit.payload);
      if (
        existing.origin !== input.origin ||
        existing.originalMessage !== input.originalMessage ||
        existing.projectId !== input.projectId ||
        (input.requestHash !== undefined && payload.requestHash !== input.requestHash)
      ) {
        throw new TaskIdempotencyConflictError();
      }
      return {
        auditEventId: audit.id,
        idempotentReplay: true,
        task: toSnapshot(existing),
      };
    }

    try {
      return await this.prisma.$transaction(async (transaction) => {
        if (input.requireActiveProject === true) {
          const project = await transaction.project.findFirst({
            where: { id: input.projectId, status: "ACTIVE" },
            select: { id: true },
          });
          if (project === null) {
            throw new TaskProjectNotEligibleError();
          }
        }
        const task = await transaction.task.create({
          data: {
            idempotencyKey: input.idempotencyKey,
            origin: input.origin,
            originalMessage: input.originalMessage,
            projectId: input.projectId,
          },
        });
        const snapshot = toSnapshot(task);
        const audit = await transaction.auditEvent.create({
          data: {
            action: "task.created",
            actor: actorMap[input.actor ?? "system"],
            correlationId: input.correlationId,
            idempotencyKey: `${input.idempotencyKey}:created`,
            payload: json({
              ...(input.requestHash === undefined ? {} : { requestHash: input.requestHash }),
              task: snapshot,
            }),
            projectId: input.projectId,
            targetId: task.id,
            targetType: "task",
            taskId: task.id,
          },
        });
        return {
          auditEventId: audit.id,
          idempotentReplay: false,
          task: snapshot,
        };
      });
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const task = await this.prisma.task.findUniqueOrThrow({
          where: { idempotencyKey: input.idempotencyKey },
        });
        const audit = await this.prisma.auditEvent.findUniqueOrThrow({
          where: { idempotencyKey: `${input.idempotencyKey}:created` },
        });
        const payload = taskCreatedAuditPayloadSchema.parse(audit.payload);
        if (
          task.origin !== input.origin ||
          task.originalMessage !== input.originalMessage ||
          task.projectId !== input.projectId ||
          (input.requestHash !== undefined && payload.requestHash !== input.requestHash)
        ) {
          throw new TaskIdempotencyConflictError();
        }
        return {
          auditEventId: audit.id,
          idempotentReplay: true,
          task: toSnapshot(task),
        };
      }
      throw error;
    }
  }

  async findReplay(
    idempotencyKey: string,
    requestHash?: string,
  ): Promise<TaskTransitionResult | undefined> {
    const event = await this.prisma.auditEvent.findUnique({
      where: { idempotencyKey },
    });
    if (event?.action !== "task.transition.accepted") {
      return undefined;
    }
    const payload = transitionAuditPayloadSchema.parse(event.payload);
    if (requestHash !== undefined && payload.requestHash !== requestHash) {
      throw new TaskIdempotencyConflictError();
    }
    return {
      auditEventId: event.id,
      fromState: payload.fromState,
      idempotentReplay: true,
      task: parsedSnapshot(payload.task),
    };
  }

  async getTask(taskId: string): Promise<TaskSnapshot | undefined> {
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });
    return task === null ? undefined : toSnapshot(task);
  }

  async commitTransition(input: CommitTransitionInput): Promise<TaskTransitionResult> {
    return this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.task.updateMany({
        where: {
          id: input.taskId,
          state: toPrismaState(input.fromState),
          version: input.expectedVersion,
        },
        data: {
          failureStage: input.failureStage ?? null,
          state: toPrismaState(input.toState),
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) {
        const replay = await transaction.auditEvent.findUnique({
          where: { idempotencyKey: input.idempotencyKey },
        });
        if (replay?.action === "task.transition.accepted") {
          const payload = transitionAuditPayloadSchema.parse(replay.payload);
          if (input.requestHash !== undefined && payload.requestHash !== input.requestHash) {
            throw new TaskIdempotencyConflictError();
          }
          return {
            auditEventId: replay.id,
            fromState: payload.fromState,
            idempotentReplay: true,
            task: parsedSnapshot(payload.task),
          };
        }
        const current = await transaction.task.findUniqueOrThrow({
          where: { id: input.taskId },
        });
        throw new TaskVersionConflictError(input.expectedVersion, current.version);
      }

      const task = toSnapshot(
        await transaction.task.findUniqueOrThrow({
          where: { id: input.taskId },
        }),
      );
      const audit = await transaction.auditEvent.create({
        data: {
          action: "task.transition.accepted",
          actor: actorMap[input.actor],
          correlationId: input.correlationId,
          idempotencyKey: input.idempotencyKey,
          payload: json({
            fromState: input.fromState,
            ...(input.reasonCode === undefined ? {} : { reasonCode: input.reasonCode }),
            ...(input.requestHash === undefined ? {} : { requestHash: input.requestHash }),
            task,
          }),
          projectId: input.projectId,
          targetId: input.taskId,
          targetType: "task",
          taskId: input.taskId,
        },
      });
      return {
        auditEventId: audit.id,
        fromState: input.fromState,
        idempotentReplay: false,
        task,
      };
    });
  }

  async recordRejectedTransition(input: RejectedTransition): Promise<void> {
    const idempotencyKey = `rejected:${input.idempotencyKey}`;
    const existing = await this.prisma.auditEvent.findUnique({ where: { idempotencyKey } });
    if (existing !== null) {
      return;
    }
    try {
      await this.prisma.auditEvent.create({
        data: {
          action: "task.transition.rejected",
          actor: actorMap[auditActorSchema.parse(input.actor)],
          correlationId: input.correlationId,
          idempotencyKey,
          payload: json({
            fromState: input.fromState,
            reason: input.reason,
            toState: input.toState,
          }),
          projectId: input.projectId,
          targetId: input.taskId,
          targetType: "task",
          taskId: input.taskId,
        },
      });
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return;
      }
      throw error;
    }
  }
}
