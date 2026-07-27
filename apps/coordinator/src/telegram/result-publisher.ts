import { DeliveryOutboxStatus, Prisma, type PrismaClient, type TaskState } from "@prisma/client";

import {
  canonicalPayloadHash,
  executableSpecificationPayloadSchema,
  workerResultSchema,
  type SpecificationDeliveryMode,
} from "@atlas/shared";

import { TelegramDispatchError, type TelegramClient } from "./client.js";
export { telegramResultDestination } from "./origin.js";
import { telegramResultDestination } from "./origin.js";

const TERMINAL_STATES: TaskState[] = ["COMPLETED", "FAILED"];
const TELEGRAM_TEXT_LIMIT = 4096;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BACKOFF_MS = 2_000;
const DEFAULT_CLAIM_TTL_MS = 5 * 60_000;
const MAX_BACKOFF_MS = 5 * 60_000;
const DEFAULT_BATCH_SIZE = 25;
const SAFE_DISPATCH_CODES = new Set([
  "telegram_api_rejected_before_dispatch",
  "telegram_dispatch_outcome_ambiguous",
  "telegram_response_outcome_ambiguous",
  "telegram_transport_outcome_ambiguous",
]);

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function isUniqueConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export interface TelegramResultCandidate {
  readonly changedPaths: readonly string[];
  readonly contentHash: string;
  readonly contentReference: string;
  readonly deliveryMode: SpecificationDeliveryMode;
  readonly failureStage?: string;
  readonly origin: string;
  readonly projectId: string;
  readonly pullRequestUrl?: string;
  readonly state: "COMPLETED" | "FAILED" | "CANCELLED";
  readonly summary?: string;
  readonly taskId: string;
  readonly taskVersion: number;
}

export interface TelegramResultOutboxClaim {
  readonly attempt: number;
  readonly chatId: bigint;
  readonly deliveryKey: string;
  readonly id: string;
  readonly messageText: string;
  readonly projectId: string;
  readonly taskId: string;
  readonly taskVersion: number;
}

export interface TelegramResultStore {
  claimNext(now: Date, claimExpiresAt: Date): Promise<TelegramResultOutboxClaim | undefined>;
  enqueue(candidate: TelegramResultCandidate, chatId: bigint, userId: bigint): Promise<boolean>;
  listTerminalCandidates(): Promise<readonly TelegramResultCandidate[]>;
  reconcileExpiredClaims(now: Date): Promise<number>;
  recordAmbiguousFailure(claim: TelegramResultOutboxClaim, safeCode: string): Promise<void>;
  recordDelivered(claim: TelegramResultOutboxClaim): Promise<void>;
  recordNoChannel(candidate: TelegramResultCandidate, reason: string): Promise<void>;
  recordNotDispatched(
    claim: TelegramResultOutboxClaim,
    safeCode: string,
    nextAttemptAt: Date | undefined,
  ): Promise<void>;
}

export function formatTelegramResult(candidate: TelegramResultCandidate): string {
  const lines = [
    `${candidate.deliveryMode === "answer_only" ? "Resposta" : "Resultado"} da Task ${candidate.taskId}: ${candidate.state}`,
  ];
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

export function telegramResultDeliveryKey(candidate: TelegramResultCandidate): string {
  return `telegram:result:${candidate.taskId}:v${String(candidate.taskVersion)}:${candidate.state}`;
}

function candidateContentHash(
  candidate: Omit<TelegramResultCandidate, "contentHash" | "contentReference" | "origin">,
): string {
  return canonicalPayloadHash({
    changedPaths: candidate.changedPaths,
    deliveryMode: candidate.deliveryMode,
    failureStage: candidate.failureStage ?? null,
    pullRequestUrl: candidate.pullRequestUrl ?? null,
    state: candidate.state,
    summary: candidate.summary ?? null,
    taskId: candidate.taskId,
    taskVersion: candidate.taskVersion,
  });
}

export class PrismaTelegramResultStore implements TelegramResultStore {
  constructor(private readonly prisma: PrismaClient) {}

  async listTerminalCandidates(): Promise<readonly TelegramResultCandidate[]> {
    const terminalTasks = await this.prisma.task.findMany({
      where: {
        state: { in: TERMINAL_STATES },
      },
      orderBy: { updatedAt: "desc" },
      select: {
        deliveryOutbox: { select: { taskVersion: true } },
        id: true,
        state: true,
        telegramDelivery: { select: { resultDeliveryKey: true } },
        version: true,
      },
    });
    const candidateIds = terminalTasks
      .filter((task) => {
        const currentVersionHasOutbox = task.deliveryOutbox.some(
          (delivery) => delivery.taskVersion === task.version,
        );
        const currentDeliveryKey = `telegram:result:${task.id}:v${String(task.version)}:${task.state}`;
        const currentVersionWasClaimedByLegacyPublisher =
          task.telegramDelivery?.resultDeliveryKey === currentDeliveryKey;
        return !currentVersionHasOutbox && !currentVersionWasClaimedByLegacyPublisher;
      })
      .slice(0, 500)
      .map((task) => task.id);
    if (candidateIds.length === 0) return [];
    const tasks = await this.prisma.task.findMany({
      where: { id: { in: candidateIds } },
      include: {
        activeSpecification: true,
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
      const specification =
        task.activeSpecification === null
          ? undefined
          : executableSpecificationPayloadSchema.safeParse(task.activeSpecification.payload);
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
      const content = {
        changedPaths: result?.success === true ? result.data.changed_paths : [],
        deliveryMode:
          specification?.success === true ? specification.data.delivery_mode : "repository_change",
        ...(task.failureStage === null ? {} : { failureStage: task.failureStage }),
        projectId: task.projectId,
        ...(pullRequestUrl === undefined ? {} : { pullRequestUrl }),
        state: task.state as "COMPLETED" | "FAILED" | "CANCELLED",
        ...(result?.success === true ? { summary: result.data.summary } : {}),
        taskId: task.id,
        taskVersion: task.version,
      };
      return {
        ...content,
        contentHash: candidateContentHash(content),
        contentReference:
          execution === undefined || result?.success !== true
            ? `task:${task.id}:v${String(task.version)}:${task.state}`
            : `execution:${execution.id}:result:${result.data.result_hash}`,
        origin: task.origin,
      };
    });
  }

  async enqueue(
    candidate: TelegramResultCandidate,
    chatId: bigint,
    userId: bigint,
  ): Promise<boolean> {
    const deliveryKey = telegramResultDeliveryKey(candidate);
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const existing = await transaction.resultDeliveryOutbox.findUnique({
          where: {
            taskId_taskVersion: {
              taskId: candidate.taskId,
              taskVersion: candidate.taskVersion,
            },
          },
        });
        if (existing !== null) return false;
        const legacy = await transaction.telegramTaskDelivery.findUnique({
          where: { taskId: candidate.taskId },
        });
        if (legacy?.resultDeliveryKey === deliveryKey) {
          return false;
        }
        const outbox = await transaction.resultDeliveryOutbox.create({
          data: {
            contentHash: candidate.contentHash,
            contentReference: candidate.contentReference,
            deliveryKey,
            destinationChatId: chatId,
            destinationUserId: userId,
            messageText: formatTelegramResult(candidate),
            projectId: candidate.projectId,
            taskId: candidate.taskId,
            taskVersion: candidate.taskVersion,
          },
        });
        if (legacy === null) {
          await transaction.telegramTaskDelivery.create({
            data: {
              chatId,
              projectId: candidate.projectId,
              resultClaimedAt: new Date(),
              resultDeliveryKey: deliveryKey,
              taskId: candidate.taskId,
              userId,
            },
          });
        } else {
          await transaction.telegramTaskDelivery.update({
            where: { taskId: candidate.taskId },
            data: {
              chatId,
              resultClaimedAt: new Date(),
              resultDeliveryKey: deliveryKey,
              userId,
            },
          });
        }
        await transaction.auditEvent.create({
          data: {
            action: "telegram.result_delivery.enqueued",
            actor: "SYSTEM",
            correlationId: deliveryKey,
            idempotencyKey: `audit:${deliveryKey}:enqueued`,
            payload: json({
              contentHash: candidate.contentHash,
              contentReference: candidate.contentReference,
              status: DeliveryOutboxStatus.PENDING,
              taskVersion: candidate.taskVersion,
            }),
            projectId: candidate.projectId,
            targetId: outbox.id,
            targetType: "result_delivery_outbox",
            taskId: candidate.taskId,
          },
        });
        return true;
      });
    } catch (error: unknown) {
      if (isUniqueConflict(error)) return false;
      throw error;
    }
  }

  async claimNext(now: Date, claimExpiresAt: Date): Promise<TelegramResultOutboxClaim | undefined> {
    return this.prisma.$transaction(async (transaction) => {
      const candidate = await transaction.resultDeliveryOutbox.findFirst({
        where: {
          dispatchStartedAt: null,
          nextAttemptAt: { lte: now },
          status: DeliveryOutboxStatus.PENDING,
        },
        orderBy: [{ nextAttemptAt: "asc" }, { createdAt: "asc" }],
      });
      if (candidate === null) return undefined;
      const claimed = await transaction.resultDeliveryOutbox.updateMany({
        where: {
          attempts: candidate.attempts,
          dispatchStartedAt: null,
          id: candidate.id,
          status: DeliveryOutboxStatus.PENDING,
        },
        data: {
          attempts: { increment: 1 },
          dispatchClaimExpiresAt: claimExpiresAt,
          dispatchStartedAt: now,
        },
      });
      if (claimed.count !== 1) return undefined;
      const record = await transaction.resultDeliveryOutbox.findUniqueOrThrow({
        where: { id: candidate.id },
      });
      await transaction.auditEvent.create({
        data: {
          action: "telegram.result_delivery.attempted",
          actor: "SYSTEM",
          correlationId: record.deliveryKey,
          idempotencyKey: `audit:${record.deliveryKey}:attempt:${String(record.attempts)}:started`,
          payload: json({ attempt: record.attempts, status: record.status }),
          projectId: record.projectId,
          targetId: record.id,
          targetType: "result_delivery_outbox",
          taskId: record.taskId,
        },
      });
      return {
        attempt: record.attempts,
        chatId: record.destinationChatId,
        deliveryKey: record.deliveryKey,
        id: record.id,
        messageText: record.messageText,
        projectId: record.projectId,
        taskId: record.taskId,
        taskVersion: record.taskVersion,
      };
    });
  }

  async recordDelivered(claim: TelegramResultOutboxClaim): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.resultDeliveryOutbox.updateMany({
        where: {
          attempts: claim.attempt,
          id: claim.id,
          status: DeliveryOutboxStatus.PENDING,
        },
        data: {
          deliveredAt: new Date(),
          dispatchClaimExpiresAt: null,
          lastError: null,
          status: DeliveryOutboxStatus.DELIVERED,
        },
      });
      if (updated.count !== 1) {
        throw new Error("result delivery claim is no longer current");
      }
      await transaction.telegramTaskDelivery.update({
        where: { taskId: claim.taskId },
        data: { resultDeliveredAt: new Date() },
      });
      await transaction.auditEvent.upsert({
        where: {
          idempotencyKey: `audit:${claim.deliveryKey}:attempt:${String(claim.attempt)}:delivered`,
        },
        create: {
          action: "telegram.result_delivery.delivered",
          actor: "SYSTEM",
          correlationId: claim.deliveryKey,
          idempotencyKey: `audit:${claim.deliveryKey}:attempt:${String(claim.attempt)}:delivered`,
          payload: json({
            attempt: claim.attempt,
            status: DeliveryOutboxStatus.DELIVERED,
            taskVersion: claim.taskVersion,
          }),
          projectId: claim.projectId,
          targetId: claim.id,
          targetType: "result_delivery_outbox",
          taskId: claim.taskId,
        },
        update: {},
      });
    });
  }

  async recordNotDispatched(
    claim: TelegramResultOutboxClaim,
    safeCode: string,
    nextAttemptAt: Date | undefined,
  ): Promise<void> {
    const terminal = nextAttemptAt === undefined;
    await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.resultDeliveryOutbox.updateMany({
        where: {
          attempts: claim.attempt,
          id: claim.id,
          status: DeliveryOutboxStatus.PENDING,
        },
        data: {
          dispatchClaimExpiresAt: null,
          dispatchStartedAt: null,
          lastError: safeCode,
          ...(terminal ? { status: DeliveryOutboxStatus.DELIVERY_FAILED } : { nextAttemptAt }),
        },
      });
      if (updated.count !== 1) return;
      await transaction.auditEvent.upsert({
        where: {
          idempotencyKey: `audit:${claim.deliveryKey}:attempt:${String(claim.attempt)}:not-dispatched`,
        },
        create: {
          action: terminal
            ? "telegram.result_delivery.delivery_failed"
            : "telegram.result_delivery.retry_scheduled",
          actor: "SYSTEM",
          correlationId: claim.deliveryKey,
          idempotencyKey: `audit:${claim.deliveryKey}:attempt:${String(claim.attempt)}:not-dispatched`,
          payload: json({
            attempt: claim.attempt,
            outcome: "not_dispatched",
            safeCode,
            status: terminal ? DeliveryOutboxStatus.DELIVERY_FAILED : DeliveryOutboxStatus.PENDING,
            taskVersion: claim.taskVersion,
          }),
          projectId: claim.projectId,
          targetId: claim.id,
          targetType: "result_delivery_outbox",
          taskId: claim.taskId,
        },
        update: {},
      });
    });
  }

  async recordAmbiguousFailure(claim: TelegramResultOutboxClaim, safeCode: string): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.resultDeliveryOutbox.updateMany({
        where: {
          attempts: claim.attempt,
          id: claim.id,
          status: DeliveryOutboxStatus.PENDING,
        },
        data: {
          dispatchClaimExpiresAt: null,
          lastError: safeCode,
          status: DeliveryOutboxStatus.DELIVERY_FAILED,
        },
      });
      if (updated.count !== 1) return;
      await transaction.auditEvent.upsert({
        where: {
          idempotencyKey: `audit:${claim.deliveryKey}:attempt:${String(claim.attempt)}:ambiguous`,
        },
        create: {
          action: "telegram.result_delivery.delivery_failed",
          actor: "SYSTEM",
          correlationId: claim.deliveryKey,
          idempotencyKey: `audit:${claim.deliveryKey}:attempt:${String(claim.attempt)}:ambiguous`,
          payload: json({
            attempt: claim.attempt,
            outcome: "ambiguous",
            safeCode,
            status: DeliveryOutboxStatus.DELIVERY_FAILED,
            taskVersion: claim.taskVersion,
          }),
          projectId: claim.projectId,
          targetId: claim.id,
          targetType: "result_delivery_outbox",
          taskId: claim.taskId,
        },
        update: {},
      });
    });
  }

  async reconcileExpiredClaims(now: Date): Promise<number> {
    const expired = await this.prisma.resultDeliveryOutbox.findMany({
      where: {
        dispatchClaimExpiresAt: { lte: now },
        dispatchStartedAt: { not: null },
        status: DeliveryOutboxStatus.PENDING,
      },
      orderBy: { createdAt: "asc" },
    });
    let reconciled = 0;
    for (const record of expired) {
      await this.recordAmbiguousFailure(
        {
          attempt: record.attempts,
          chatId: record.destinationChatId,
          deliveryKey: record.deliveryKey,
          id: record.id,
          messageText: record.messageText,
          projectId: record.projectId,
          taskId: record.taskId,
          taskVersion: record.taskVersion,
        },
        "dispatch_confirmation_missing_after_claim_expiry",
      );
      reconciled += 1;
    }
    return reconciled;
  }

  async recordNoChannel(candidate: TelegramResultCandidate, reason: string): Promise<void> {
    const key = `${telegramResultDeliveryKey(candidate)}:no-channel`;
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
}

function classifyDispatchError(error: unknown): {
  readonly outcome: "ambiguous" | "not_dispatched";
  readonly safeCode: string;
} {
  if (error instanceof TelegramDispatchError) {
    return {
      outcome: error.outcome,
      safeCode: SAFE_DISPATCH_CODES.has(error.safeCode)
        ? error.safeCode
        : error.outcome === "not_dispatched"
          ? "telegram_api_rejected_before_dispatch"
          : "telegram_dispatch_outcome_ambiguous",
    };
  }
  return { outcome: "ambiguous", safeCode: "telegram_dispatch_outcome_ambiguous" };
}

export interface TelegramResultPublisherOptions {
  readonly backoffMs?: number;
  readonly batchSize?: number;
  readonly claimTtlMs?: number;
  readonly maxAttempts?: number;
}

export class TelegramResultPublisher {
  private polling = false;
  private readonly backoffMs: number;
  private readonly batchSize: number;
  private readonly claimTtlMs: number;
  private readonly maxAttempts: number;

  constructor(
    private readonly store: TelegramResultStore,
    private readonly client?: TelegramClient,
    options: TelegramResultPublisherOptions = {},
  ) {
    this.backoffMs = options.backoffMs ?? DEFAULT_BACKOFF_MS;
    this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    this.claimTtlMs = options.claimTtlMs ?? DEFAULT_CLAIM_TTL_MS;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    if (
      this.backoffMs <= 0 ||
      this.batchSize <= 0 ||
      this.claimTtlMs <= 0 ||
      this.maxAttempts <= 0
    ) {
      throw new Error("telegram result publisher options must be positive");
    }
  }

  async poll(now = new Date()): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      for (const candidate of await this.store.listTerminalCandidates()) {
        const destination = telegramResultDestination(candidate.origin);
        if (destination === undefined) {
          await this.store.recordNoChannel(candidate, "origin_is_not_a_telegram_chat");
          continue;
        }
        await this.store.enqueue(candidate, destination.chatId, destination.userId);
      }
      await this.store.reconcileExpiredClaims(now);
      if (this.client === undefined) return;
      for (let index = 0; index < this.batchSize; index += 1) {
        const claim = await this.store.claimNext(now, new Date(now.getTime() + this.claimTtlMs));
        if (claim === undefined) return;
        try {
          await this.client.sendResponses(claim.chatId, [{ text: claim.messageText }]);
        } catch (error: unknown) {
          const failure = classifyDispatchError(error);
          if (failure.outcome === "ambiguous") {
            await this.store.recordAmbiguousFailure(claim, failure.safeCode);
            continue;
          }
          const exhausted = claim.attempt >= this.maxAttempts;
          const delay = Math.min(
            this.backoffMs * 2 ** Math.max(0, claim.attempt - 1),
            MAX_BACKOFF_MS,
          );
          await this.store.recordNotDispatched(
            claim,
            failure.safeCode,
            exhausted ? undefined : new Date(now.getTime() + delay),
          );
          continue;
        }
        await this.store.recordDelivered(claim);
      }
    } finally {
      this.polling = false;
    }
  }
}
