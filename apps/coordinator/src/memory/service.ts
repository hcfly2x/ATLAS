import { MemoryType, Prisma, type PrismaClient } from "@prisma/client";

import { buildProjectMemoryContext, type ProjectMemoryContext } from "@atlas/memory";
import {
  canonicalPayloadHash,
  createMemoryItemSchema,
  memoryItemSchema,
  type CreateMemoryItem,
  type MemoryItem,
  type MemoryType as SharedMemoryType,
} from "@atlas/shared";

const memoryTypeToPrisma: Record<SharedMemoryType, MemoryType> = {
  decision: MemoryType.DECISION,
  note: MemoryType.NOTE,
  summary: MemoryType.SUMMARY,
};
const memoryTypeFromPrisma: Record<MemoryType, SharedMemoryType> = {
  DECISION: "decision",
  NOTE: "note",
  SUMMARY: "summary",
};

function item(record: {
  agentId: string | null;
  content: string;
  createdAt: Date;
  id: string;
  projectId: string;
  taskId: string | null;
  type: MemoryType;
}): MemoryItem {
  return memoryItemSchema.parse({
    agentId: record.agentId ?? undefined,
    content: record.content,
    createdAt: record.createdAt.toISOString(),
    id: record.id,
    projectId: record.projectId,
    taskId: record.taskId ?? undefined,
    type: memoryTypeFromPrisma[record.type],
  });
}

export class MemoryConflictError extends Error {
  readonly code = "MEMORY_IDEMPOTENCY_CONFLICT";
}

export class MemoryProjectNotFoundError extends Error {
  readonly code = "MEMORY_PROJECT_NOT_FOUND";
}

export class MemoryTaskScopeError extends Error {
  readonly code = "MEMORY_TASK_SCOPE_MISMATCH";
}

export interface MemoryService {
  create(
    projectId: string,
    input: CreateMemoryItem,
    correlationId: string,
  ): Promise<{ item: MemoryItem; replayed: boolean }>;
  list(input: {
    before?: Date;
    limit: number;
    projectId: string;
    taskId?: string;
    type?: SharedMemoryType;
  }): Promise<MemoryItem[]>;
  getContext(projectId: string, taskId?: string): Promise<ProjectMemoryContext>;
}

export class PrismaMemoryService implements MemoryService {
  constructor(private readonly prisma: PrismaClient) {}

  async create(
    projectId: string,
    rawInput: CreateMemoryItem,
    correlationId: string,
  ): Promise<{ item: MemoryItem; replayed: boolean }> {
    const input = createMemoryItemSchema.parse(rawInput);
    const payloadHash = canonicalPayloadHash({ ...input, projectId });
    const replay = await this.prisma.memoryItem.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (replay !== null) {
      if (replay.payloadHash !== payloadHash) {
        await this.prisma.auditEvent.upsert({
          where: { idempotencyKey: `memory-conflict:${input.idempotencyKey}` },
          create: {
            action: "memory.idempotency_conflict",
            actor: "SYSTEM",
            correlationId,
            idempotencyKey: `memory-conflict:${input.idempotencyKey}`,
            payload: { receivedHash: payloadHash, storedHash: replay.payloadHash },
            projectId: replay.projectId,
            targetId: replay.id,
            targetType: "memory_item",
            taskId: replay.taskId,
          },
          update: {},
        });
        throw new MemoryConflictError("Idempotency key was reused with a different payload");
      }
      return { item: item(replay), replayed: true };
    }
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (project === null) throw new MemoryProjectNotFoundError(projectId);
    if (input.taskId !== undefined) {
      const task = await this.prisma.task.findUnique({ where: { id: input.taskId } });
      if (task?.projectId !== projectId) {
        throw new MemoryTaskScopeError("Task does not belong to the memory project");
      }
    }
    let created;
    try {
      created = await this.prisma.$transaction(async (transaction) => {
        const memory = await transaction.memoryItem.create({
          data: {
            content: input.content,
            idempotencyKey: input.idempotencyKey,
            payloadHash,
            projectId,
            type: memoryTypeToPrisma[input.type],
            ...(input.agentId === undefined ? {} : { agentId: input.agentId }),
            ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
          },
        });
        await transaction.auditEvent.create({
          data: {
            action: "memory.created",
            actor: "USER",
            correlationId,
            idempotencyKey: `memory-created:${input.idempotencyKey}`,
            payload: {
              agentId: input.agentId ?? null,
              memoryType: input.type,
              payloadHash,
            },
            projectId,
            targetId: memory.id,
            targetType: "memory_item",
            ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
          },
        });
        return memory;
      });
    } catch (error: unknown) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
        throw error;
      }
      const concurrent = await this.prisma.memoryItem.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (concurrent !== null && concurrent.payloadHash === payloadHash) {
        return { item: item(concurrent), replayed: true };
      }
      if (concurrent !== null) {
        await this.prisma.auditEvent.upsert({
          where: { idempotencyKey: `memory-conflict:${input.idempotencyKey}` },
          create: {
            action: "memory.idempotency_conflict",
            actor: "SYSTEM",
            correlationId,
            idempotencyKey: `memory-conflict:${input.idempotencyKey}`,
            payload: { receivedHash: payloadHash, storedHash: concurrent.payloadHash },
            projectId: concurrent.projectId,
            targetId: concurrent.id,
            targetType: "memory_item",
            taskId: concurrent.taskId,
          },
          update: {},
        });
      }
      throw new MemoryConflictError("Concurrent memory write used a conflicting payload");
    }
    return { item: item(created), replayed: false };
  }

  async list(input: {
    before?: Date;
    limit: number;
    projectId: string;
    taskId?: string;
    type?: SharedMemoryType;
  }): Promise<MemoryItem[]> {
    const records = await this.prisma.memoryItem.findMany({
      where: {
        projectId: input.projectId,
        ...(input.before === undefined ? {} : { createdAt: { lt: input.before } }),
        ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
        ...(input.type === undefined ? {} : { type: memoryTypeToPrisma[input.type] }),
      },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: input.limit,
    });
    return records.map(item);
  }

  async getContext(projectId: string, taskId?: string): Promise<ProjectMemoryContext> {
    const records = await this.list({ limit: 100, projectId });
    return buildProjectMemoryContext({
      items: records,
      projectId,
      ...(taskId === undefined ? {} : { taskId }),
    });
  }
}
