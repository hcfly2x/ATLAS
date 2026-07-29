import { Prisma, type PrismaClient } from "@prisma/client";

import { postExecutionReviewSchema } from "@atlas/shared";

import type { TelegramClient } from "./client.js";
import { telegramResultDestination } from "./result-publisher.js";

const TELEGRAM_TEXT_LIMIT = 4096;

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export interface TelegramReworkCandidate {
  readonly origin: string;
  readonly projectId: string;
  readonly requiredActions: readonly string[];
  readonly reviewStatus: "REJECTED" | "FAILED";
  readonly summary: string;
  readonly taskId: string;
  readonly taskVersion: number;
}

export interface TelegramReworkStore {
  claim(candidate: TelegramReworkCandidate, chatId: bigint): Promise<boolean>;
  listCandidates(): Promise<readonly TelegramReworkCandidate[]>;
  recordFailure(candidate: TelegramReworkCandidate, detail: string): Promise<void>;
  recordNoChannel(candidate: TelegramReworkCandidate, reason: string): Promise<void>;
  recordSent(candidate: TelegramReworkCandidate): Promise<void>;
}

export function selectTelegramReworkContent(review: {
  readonly payload: unknown;
  readonly reconciliationReason: string | null;
  readonly reviewerDecision: "APPROVED" | "REJECTED" | null;
  readonly status: "FAILED" | "REJECTED";
}): Pick<TelegramReworkCandidate, "requiredActions" | "summary"> {
  const parsed = postExecutionReviewSchema.safeParse(review.payload);
  const reviewerRejected =
    review.status === "REJECTED" &&
    (review.reviewerDecision === null || review.reviewerDecision === "REJECTED");
  if (reviewerRejected && parsed.success) {
    return {
      requiredActions: parsed.data.required_actions,
      summary: parsed.data.summary,
    };
  }
  if (review.reconciliationReason === "qa_empirical_failed") {
    return {
      requiredActions: [],
      summary:
        "A verificação empírica falhou; o resultado não foi liberado e requer revisão humana.",
    };
  }
  return {
    requiredActions: [],
    summary: "A revisão pós-execução não pôde ser concluída; o resultado não foi liberado.",
  };
}

function deliveryKey(candidate: TelegramReworkCandidate): string {
  return `telegram:qa-rework:${candidate.taskId}:v${String(candidate.taskVersion)}`;
}

export function formatTelegramRework(candidate: TelegramReworkCandidate): string {
  const actions =
    candidate.requiredActions.length === 0
      ? ["Revise a demanda e envie instruções adicionais para uma nova Specification."]
      : candidate.requiredActions;
  const lines = [
    `Task ${candidate.taskId}: retrabalho solicitado pelo QA`,
    `Resumo:\n${candidate.summary.trim()}`,
    `Ações requeridas:\n${actions.map((action) => `- ${action}`).join("\n")}`,
    "Próximo passo:\nEnvie no Telegram as correções ou esclarecimentos necessários. O ATLAS não repetirá a execução automaticamente.",
  ];
  const text = lines.join("\n\n");
  return text.length <= TELEGRAM_TEXT_LIMIT ? text : `${text.slice(0, TELEGRAM_TEXT_LIMIT - 1)}…`;
}

export class PrismaTelegramReworkStore implements TelegramReworkStore {
  constructor(private readonly prisma: PrismaClient) {}

  async listCandidates(): Promise<readonly TelegramReworkCandidate[]> {
    const tasks = await this.prisma.task.findMany({
      where: {
        state: "SPECIFYING",
        postExecutionReviews: {
          some: {
            status: { in: ["REJECTED", "FAILED"] },
            execution: { failureStage: "post_execution_qa" },
          },
        },
      },
      include: {
        postExecutionReviews: {
          where: {
            status: { in: ["REJECTED", "FAILED"] },
            execution: { failureStage: "post_execution_qa" },
          },
          orderBy: { updatedAt: "desc" },
          take: 1,
        },
      },
      orderBy: { updatedAt: "asc" },
    });

    return tasks.flatMap((task) => {
      const review = task.postExecutionReviews[0];
      if (review === undefined) return [];
      const content = selectTelegramReworkContent({
        payload: review.payload,
        reconciliationReason: review.reconciliationReason,
        reviewerDecision: review.reviewerDecision,
        status: review.status as "FAILED" | "REJECTED",
      });
      return [
        {
          origin: task.origin,
          projectId: task.projectId,
          requiredActions: content.requiredActions,
          reviewStatus: review.status as "REJECTED" | "FAILED",
          summary: content.summary,
          taskId: task.id,
          taskVersion: task.version,
        },
      ];
    });
  }

  async claim(candidate: TelegramReworkCandidate, chatId: bigint): Promise<boolean> {
    const key = deliveryKey(candidate);
    try {
      await this.prisma.auditEvent.create({
        data: {
          action: "telegram.qa_rework_delivery.claimed",
          actor: "SYSTEM",
          correlationId: key,
          idempotencyKey: `audit:${key}:claimed`,
          payload: json({
            chatId: chatId.toString(),
            reviewStatus: candidate.reviewStatus,
            taskVersion: candidate.taskVersion,
          }),
          projectId: candidate.projectId,
          targetId: candidate.taskId,
          targetType: "task",
          taskId: candidate.taskId,
        },
      });
      return true;
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return false;
      }
      throw error;
    }
  }

  async recordNoChannel(candidate: TelegramReworkCandidate, reason: string): Promise<void> {
    const key = deliveryKey(candidate);
    await this.prisma.auditEvent.upsert({
      where: { idempotencyKey: `audit:${key}:no-channel` },
      create: {
        action: "telegram.qa_rework_delivery.no_channel",
        actor: "SYSTEM",
        correlationId: key,
        idempotencyKey: `audit:${key}:no-channel`,
        payload: json({ reason }),
        projectId: candidate.projectId,
        targetId: candidate.taskId,
        targetType: "task",
        taskId: candidate.taskId,
      },
      update: {},
    });
  }

  async recordSent(candidate: TelegramReworkCandidate): Promise<void> {
    const key = deliveryKey(candidate);
    await this.prisma.auditEvent.upsert({
      where: { idempotencyKey: `audit:${key}:sent` },
      create: {
        action: "telegram.qa_rework_delivery.sent",
        actor: "SYSTEM",
        correlationId: key,
        idempotencyKey: `audit:${key}:sent`,
        payload: json({ reviewStatus: candidate.reviewStatus }),
        projectId: candidate.projectId,
        targetId: candidate.taskId,
        targetType: "task",
        taskId: candidate.taskId,
      },
      update: {},
    });
  }

  async recordFailure(candidate: TelegramReworkCandidate, detail: string): Promise<void> {
    const key = deliveryKey(candidate);
    await this.prisma.auditEvent.upsert({
      where: { idempotencyKey: `audit:${key}:failed` },
      create: {
        action: "telegram.qa_rework_delivery.failed",
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

export class TelegramReworkPublisher {
  constructor(
    private readonly store: TelegramReworkStore,
    private readonly client?: TelegramClient,
  ) {}

  async poll(): Promise<void> {
    for (const candidate of await this.store.listCandidates()) {
      const destination = telegramResultDestination(candidate.origin);
      if (destination === undefined) {
        await this.store.recordNoChannel(candidate, "origin_is_not_a_telegram_chat");
        continue;
      }
      if (this.client === undefined) {
        await this.store.recordNoChannel(candidate, "telegram_bot_not_configured");
        continue;
      }
      if (!(await this.store.claim(candidate, destination.chatId))) continue;
      try {
        await this.client.sendResponses(destination.chatId, [
          { text: formatTelegramRework(candidate) },
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
