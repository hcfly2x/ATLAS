import type { Prisma, PrismaClient, TaskState } from "@prisma/client";

import { workerResultSchema } from "@atlas/shared";

import type { TelegramClient } from "./client.js";

const TERMINAL_STATES: TaskState[] = ["COMPLETED", "FAILED", "CANCELLED"];
const telegramOrigin = /^telegram:(\d+):(-?\d+)$/;
const TELEGRAM_TEXT_LIMIT = 4096;

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export interface TelegramResultCandidate {
  readonly changedPaths: readonly string[];
  readonly failureStage?: string;
  readonly origin: string;
  readonly projectId: string;
  readonly pullRequestUrl?: string;
  readonly state: "COMPLETED" | "FAILED" | "CANCELLED";
  readonly summary?: string;
  readonly taskId: string;
}

export interface TelegramResultStore {
  claim(candidate: TelegramResultCandidate, chatId: bigint, userId: bigint): Promise<boolean>;
  listTerminalCandidates(): Promise<readonly TelegramResultCandidate[]>;
  recordFailure(candidate: TelegramResultCandidate, detail: string): Promise<void>;
  recordNoChannel(candidate: TelegramResultCandidate, reason: string): Promise<void>;
  recordSent(candidate: TelegramResultCandidate): Promise<void>;
}

export function telegramResultDestination(
  origin: string,
): { chatId: bigint; userId: bigint } | undefined {
  const match = telegramOrigin.exec(origin);
  if (match?.[1] === undefined || match[2] === undefined) return undefined;
  return { userId: BigInt(match[1]), chatId: BigInt(match[2]) };
}

export function formatTelegramResult(candidate: TelegramResultCandidate): string {
  const lines = [`Resultado da Task ${candidate.taskId}: ${candidate.state}`];
  if (candidate.failureStage !== undefined)
    lines.push(`Estágio da falha: ${candidate.failureStage}`);
  if (candidate.summary !== undefined && candidate.summary.trim().length > 0) {
    lines.push(`Resumo:\n${candidate.summary.trim()}`);
  }
  if (candidate.changedPaths.length > 0) {
    lines.push(
      `Arquivos alterados:\n${candidate.changedPaths.map((path) => `- ${path}`).join("\n")}`,
    );
  }
  if (candidate.pullRequestUrl !== undefined) lines.push(`PR: ${candidate.pullRequestUrl}`);
  const text = lines.join("\n\n");
  return text.length <= TELEGRAM_TEXT_LIMIT ? text : `${text.slice(0, TELEGRAM_TEXT_LIMIT - 1)}…`;
}

function deliveryKey(candidate: TelegramResultCandidate): string {
  return `telegram:result:${candidate.taskId}:${candidate.state}`;
}

export class PrismaTelegramResultStore implements TelegramResultStore {
  constructor(private readonly prisma: PrismaClient) {}

  async listTerminalCandidates(): Promise<readonly TelegramResultCandidate[]> {
    const tasks = await this.prisma.task.findMany({
      where: {
        state: { in: TERMINAL_STATES },
        OR: [{ telegramDelivery: null }, { telegramDelivery: { is: { resultDeliveryKey: null } } }],
      },
      include: {
        auditEvents: {
          where: { action: "execution.finalized" },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
        executions: { orderBy: { attempt: "desc" }, take: 1 },
      },
      orderBy: { updatedAt: "asc" },
    });
    return tasks.map((task) => {
      const execution = task.executions[0];
      const result =
        execution?.resultPayload === null || execution?.resultPayload === undefined
          ? undefined
          : workerResultSchema.safeParse(execution.resultPayload);
      const finalized = task.auditEvents[0]?.payload;
      const pullRequestUrl =
        typeof finalized === "object" &&
        finalized !== null &&
        "pullRequestUrl" in finalized &&
        typeof finalized.pullRequestUrl === "string"
          ? finalized.pullRequestUrl
          : undefined;
      return {
        changedPaths: result?.success === true ? result.data.changed_paths : [],
        ...(task.failureStage === null ? {} : { failureStage: task.failureStage }),
        origin: task.origin,
        projectId: task.projectId,
        ...(pullRequestUrl === undefined ? {} : { pullRequestUrl }),
        state: task.state as "COMPLETED" | "FAILED" | "CANCELLED",
        ...(result?.success === true ? { summary: result.data.summary } : {}),
        taskId: task.id,
      };
    });
  }

  async claim(
    candidate: TelegramResultCandidate,
    chatId: bigint,
    userId: bigint,
  ): Promise<boolean> {
    const key = deliveryKey(candidate);
    return this.prisma.$transaction(async (transaction) => {
      const existing = await transaction.telegramTaskDelivery.findUnique({
        where: { taskId: candidate.taskId },
      });
      if (existing?.resultDeliveryKey !== null && existing?.resultDeliveryKey !== undefined)
        return false;
      if (existing === null) {
        try {
          await transaction.telegramTaskDelivery.create({
            data: {
              chatId,
              projectId: candidate.projectId,
              resultClaimedAt: new Date(),
              resultDeliveryKey: key,
              taskId: candidate.taskId,
              userId,
            },
          });
        } catch {
          return false;
        }
      } else {
        const updated = await transaction.telegramTaskDelivery.updateMany({
          where: { resultDeliveryKey: null, taskId: candidate.taskId },
          data: { chatId, resultClaimedAt: new Date(), resultDeliveryKey: key, userId },
        });
        if (updated.count !== 1) return false;
      }
      await transaction.auditEvent.create({
        data: {
          action: "telegram.result_delivery.claimed",
          actor: "SYSTEM",
          correlationId: key,
          idempotencyKey: `audit:${key}:claimed`,
          payload: json({ chatId: chatId.toString(), state: candidate.state }),
          projectId: candidate.projectId,
          targetId: candidate.taskId,
          targetType: "task",
          taskId: candidate.taskId,
        },
      });
      return true;
    });
  }

  async recordNoChannel(candidate: TelegramResultCandidate, reason: string): Promise<void> {
    const key = `${deliveryKey(candidate)}:no-channel`;
    await this.prisma.auditEvent.upsert({
      where: { idempotencyKey: `audit:${key}` },
      create: {
        action: "telegram.result_delivery.no_channel",
        actor: "SYSTEM",
        correlationId: key,
        idempotencyKey: `audit:${key}`,
        payload: json({ reason }),
        projectId: candidate.projectId,
        targetId: candidate.taskId,
        targetType: "task",
        taskId: candidate.taskId,
      },
      update: {},
    });
  }

  async recordSent(candidate: TelegramResultCandidate): Promise<void> {
    const key = deliveryKey(candidate);
    await this.prisma.$transaction([
      this.prisma.telegramTaskDelivery.update({
        where: { taskId: candidate.taskId },
        data: { resultDeliveredAt: new Date() },
      }),
      this.prisma.auditEvent.upsert({
        where: { idempotencyKey: `audit:${key}:sent` },
        create: {
          action: "telegram.result_delivery.sent",
          actor: "SYSTEM",
          correlationId: key,
          idempotencyKey: `audit:${key}:sent`,
          payload: json({ state: candidate.state }),
          projectId: candidate.projectId,
          targetId: candidate.taskId,
          targetType: "task",
          taskId: candidate.taskId,
        },
        update: {},
      }),
    ]);
  }

  async recordFailure(candidate: TelegramResultCandidate, detail: string): Promise<void> {
    const key = deliveryKey(candidate);
    await this.prisma.auditEvent.upsert({
      where: { idempotencyKey: `audit:${key}:failed` },
      create: {
        action: "telegram.result_delivery.failed",
        actor: "SYSTEM",
        correlationId: key,
        idempotencyKey: `audit:${key}:failed`,
        payload: json({ detail: detail.slice(0, 500) }),
        projectId: candidate.projectId,
        targetId: candidate.taskId,
        targetType: "task",
        taskId: candidate.taskId,
      },
      update: {},
    });
  }
}

export class TelegramResultPublisher {
  constructor(
    private readonly store: TelegramResultStore,
    private readonly client?: TelegramClient,
  ) {}

  async poll(): Promise<void> {
    for (const candidate of await this.store.listTerminalCandidates()) {
      const destination = telegramResultDestination(candidate.origin);
      if (destination === undefined) {
        await this.store.recordNoChannel(candidate, "origin_is_not_a_telegram_chat");
        continue;
      }
      if (this.client === undefined) {
        await this.store.recordNoChannel(candidate, "telegram_bot_not_configured");
        continue;
      }
      if (!(await this.store.claim(candidate, destination.chatId, destination.userId))) continue;
      try {
        await this.client.sendResponses(destination.chatId, [
          { text: formatTelegramResult(candidate) },
        ]);
        await this.store.recordSent(candidate);
      } catch (error: unknown) {
        await this.store.recordFailure(
          candidate,
          error instanceof Error ? error.message : "unknown error",
        );
      }
    }
  }
}
