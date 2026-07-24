import type { PrismaClient, TaskState } from "@prisma/client";

import type { TelegramClient } from "./client.js";

const ACTIVE_STATES = new Set<TaskState>([
  "RUNNING",
  "TESTING",
  "WAITING_RESULT_APPROVAL",
  "FINALIZING",
  "CANCEL_REQUESTED",
]);
const TERMINAL_STATES = new Set<TaskState>(["COMPLETED", "FAILED", "CANCELLED"]);

export interface TelegramProgressCandidate {
  readonly chatId: bigint;
  readonly finalDelivered: boolean;
  readonly lastActivityAt: Date | null;
  readonly lastLogSequence: number;
  readonly lastLogOffset: number;
  readonly lastTaskVersion: number;
  readonly logChunks: readonly { content: string; sequence: number }[];
  readonly projectId: string;
  readonly pullRequestUrl?: string;
  readonly state: TaskState;
  readonly taskId: string;
  readonly taskVersion: number;
  readonly userId: bigint;
  readonly verboseLevel: number;
}

export interface TelegramProgressStore {
  listCandidates(): Promise<readonly TelegramProgressCandidate[]>;
  markActivity(taskId: string, at: Date): Promise<void>;
  markFinal(taskId: string, taskVersion: number): Promise<void>;
  markLogs(taskId: string, sequence: number, offset: number): Promise<void>;
  markMilestone(taskId: string, taskVersion: number): Promise<void>;
}

export class PrismaTelegramProgressStore implements TelegramProgressStore {
  constructor(private readonly prisma: PrismaClient) {}

  async listCandidates(): Promise<readonly TelegramProgressCandidate[]> {
    const sessions = await this.prisma.telegramSession.findMany();
    const candidates: TelegramProgressCandidate[] = [];
    for (const session of sessions) {
      const tasks = await this.prisma.task.findMany({
        where: {
          origin: `telegram:${session.userId.toString()}`,
          OR: [
            { state: { notIn: ["COMPLETED", "FAILED", "CANCELLED"] } },
            { telegramDelivery: { finalDeliveredAt: null } },
            { telegramDelivery: null },
          ],
        },
        include: {
          auditEvents: {
            where: { action: "execution.finalized" },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
          executions: {
            orderBy: { attempt: "desc" },
            take: 1,
            include: { logChunks: { orderBy: { sequence: "asc" } } },
          },
          telegramDelivery: true,
        },
        orderBy: { createdAt: "asc" },
      });
      for (const task of tasks) {
        const execution = task.executions[0];
        const result = task.auditEvents[0]?.payload ?? execution?.resultPayload;
        const pullRequestUrl =
          typeof result === "object" &&
          result !== null &&
          "pull_request_url" in result &&
          typeof result.pull_request_url === "string"
            ? result.pull_request_url
            : undefined;
        candidates.push({
          chatId: session.chatId,
          finalDelivered:
            task.telegramDelivery?.finalDeliveredAt !== null &&
            task.telegramDelivery?.finalDeliveredAt !== undefined,
          lastActivityAt: task.telegramDelivery?.lastActivityAt ?? null,
          lastLogSequence: task.telegramDelivery?.lastLogSequence ?? -1,
          lastLogOffset: task.telegramDelivery?.lastLogOffset ?? 0,
          lastTaskVersion: task.telegramDelivery?.lastTaskVersion ?? -1,
          logChunks: (execution?.logChunks ?? []).map((chunk) => ({
            content: chunk.content,
            sequence: chunk.sequence,
          })),
          projectId: task.projectId,
          ...(pullRequestUrl === undefined ? {} : { pullRequestUrl }),
          state: task.state,
          taskId: task.id,
          taskVersion: task.version,
          userId: session.userId,
          verboseLevel: session.verboseLevel,
        });
      }
    }
    return candidates;
  }

  private async ensure(taskId: string): Promise<void> {
    const task = await this.prisma.task.findUniqueOrThrow({
      where: { id: taskId },
      select: { origin: true, projectId: true },
    });
    const match = /^telegram:(\d+)$/.exec(task.origin);
    if (match?.[1] === undefined) throw new Error("Telegram task origin is invalid");
    const userId = BigInt(match[1]);
    const session = await this.prisma.telegramSession.findUniqueOrThrow({ where: { userId } });
    await this.prisma.telegramTaskDelivery.upsert({
      where: { taskId },
      create: { chatId: session.chatId, projectId: task.projectId, taskId, userId },
      update: { chatId: session.chatId },
    });
  }

  async markActivity(taskId: string, at: Date): Promise<void> {
    await this.ensure(taskId);
    await this.prisma.telegramTaskDelivery.update({
      where: { taskId },
      data: { lastActivityAt: at },
    });
  }

  async markFinal(taskId: string, taskVersion: number): Promise<void> {
    await this.ensure(taskId);
    await this.prisma.telegramTaskDelivery.update({
      where: { taskId },
      data: { finalDeliveredAt: new Date(), lastTaskVersion: taskVersion },
    });
  }

  async markLogs(taskId: string, sequence: number, offset: number): Promise<void> {
    await this.ensure(taskId);
    await this.prisma.telegramTaskDelivery.update({
      where: { taskId },
      data: { lastLogOffset: offset, lastLogSequence: sequence },
    });
  }

  async markMilestone(taskId: string, taskVersion: number): Promise<void> {
    await this.ensure(taskId);
    await this.prisma.telegramTaskDelivery.update({
      where: { taskId },
      data: { lastTaskVersion: taskVersion },
    });
  }
}

export class TelegramProgressPublisher {
  constructor(
    private readonly store: TelegramProgressStore,
    private readonly client: TelegramClient,
    private readonly now: () => Date = () => new Date(),
    private readonly activityIntervalMs = 4_000,
  ) {}

  async poll(): Promise<void> {
    const candidates = await this.store.listCandidates();
    for (const candidate of candidates) {
      await this.publish(candidate);
    }
  }

  private async publish(candidate: TelegramProgressCandidate): Promise<void> {
    const now = this.now();
    if (
      ACTIVE_STATES.has(candidate.state) &&
      (candidate.lastActivityAt === null ||
        now.getTime() - candidate.lastActivityAt.getTime() >= this.activityIntervalMs)
    ) {
      await this.client.sendActivity(candidate.chatId);
      await this.store.markActivity(candidate.taskId, now);
    }

    if (candidate.verboseLevel >= 1 && candidate.taskVersion > candidate.lastTaskVersion) {
      await this.client.sendResponses(candidate.chatId, [
        { text: `Task ${candidate.taskId}\nMarco: ${candidate.state}` },
      ]);
      await this.store.markMilestone(candidate.taskId, candidate.taskVersion);
    }

    if (candidate.verboseLevel >= 2) {
      const pending = candidate.logChunks.filter(
        (chunk) => chunk.sequence > candidate.lastLogSequence,
      );
      const next = pending[0];
      if (next !== undefined) {
        const content = next.content.slice(candidate.lastLogOffset, candidate.lastLogOffset + 3500);
        const nextOffset = candidate.lastLogOffset + content.length;
        const completed = nextOffset >= next.content.length;
        await this.client.sendResponses(candidate.chatId, [
          { text: `Log ${candidate.taskId}\n${content}` },
        ]);
        await this.store.markLogs(
          candidate.taskId,
          completed ? next.sequence : candidate.lastLogSequence,
          completed ? 0 : nextOffset,
        );
      }
    }

    if (TERMINAL_STATES.has(candidate.state) && !candidate.finalDelivered) {
      await this.client.sendResponses(candidate.chatId, [
        {
          text: `Resultado final da Task ${candidate.taskId}: ${candidate.state}${
            candidate.pullRequestUrl === undefined ? "" : `\nPR: ${candidate.pullRequestUrl}`
          }`,
        },
      ]);
      await this.store.markFinal(candidate.taskId, candidate.taskVersion);
    }
  }
}
