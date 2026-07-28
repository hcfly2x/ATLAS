import { DeliveryOutboxStatus, Prisma, TaskState, type PrismaClient } from "@prisma/client";

const TERMINAL_STATES = [TaskState.COMPLETED, TaskState.FAILED] as const;
const DEFAULT_DELIVERY_SLA_MS = 5 * 60_000;

export type DeliveryWatchdogReason =
  "delivery_failed" | "delivery_sla_exceeded" | "result_delivery_outbox_missing";

export interface DeliveryWatchdogIssue {
  readonly deliveryId?: string;
  readonly deliveryKey?: string;
  readonly projectId: string;
  readonly reason: DeliveryWatchdogReason;
  readonly status?: "DELIVERY_FAILED" | "PENDING";
  readonly taskId: string;
  readonly taskVersion: number;
}

export interface DeliveryWatchdogStore {
  listIssues(slaCutoff: Date): Promise<readonly DeliveryWatchdogIssue[]>;
  recordAlert(issue: DeliveryWatchdogIssue): Promise<boolean>;
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function isUniqueConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function issueKey(issue: DeliveryWatchdogIssue): string {
  const target = issue.deliveryId ?? `${issue.taskId}:v${String(issue.taskVersion)}`;
  return `delivery-watchdog:${target}:${issue.reason}`;
}

export function parseDeliveryWatchdogSlaMs(value: string | undefined): number {
  if (value === undefined) return DEFAULT_DELIVERY_SLA_MS;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error("ATLAS_DELIVERY_SLA_MS must be a positive safe integer");
  }
  return parsed;
}

export class PrismaDeliveryWatchdogStore implements DeliveryWatchdogStore {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly options: {
      readonly projectId?: string;
    } = {},
  ) {}

  async listIssues(slaCutoff: Date): Promise<readonly DeliveryWatchdogIssue[]> {
    const projectWhere =
      this.options.projectId === undefined ? {} : { projectId: this.options.projectId };
    const [outboxIssues, terminalTasks] = await Promise.all([
      this.prisma.resultDeliveryOutbox.findMany({
        where: {
          ...projectWhere,
          OR: [
            { status: DeliveryOutboxStatus.DELIVERY_FAILED },
            {
              createdAt: { lte: slaCutoff },
              status: DeliveryOutboxStatus.PENDING,
            },
          ],
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          deliveryKey: true,
          id: true,
          projectId: true,
          status: true,
          taskId: true,
          taskVersion: true,
        },
      }),
      this.prisma.task.findMany({
        where: {
          ...projectWhere,
          origin: { startsWith: "telegram:" },
          state: { in: [...TERMINAL_STATES] },
          updatedAt: { lte: slaCutoff },
        },
        orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
        select: {
          deliveryOutbox: { select: { taskVersion: true } },
          id: true,
          projectId: true,
          state: true,
          telegramDelivery: { select: { resultDeliveryKey: true } },
          version: true,
        },
      }),
    ]);
    const issues: DeliveryWatchdogIssue[] = outboxIssues.map((record) => {
      const failed = record.status === DeliveryOutboxStatus.DELIVERY_FAILED;
      return {
        deliveryId: record.id,
        deliveryKey: record.deliveryKey,
        projectId: record.projectId,
        reason: failed ? "delivery_failed" : "delivery_sla_exceeded",
        status: failed ? "DELIVERY_FAILED" : "PENDING",
        taskId: record.taskId,
        taskVersion: record.taskVersion,
      };
    });
    for (const task of terminalTasks) {
      const currentVersionHasOutbox = task.deliveryOutbox.some(
        (delivery) => delivery.taskVersion === task.version,
      );
      const currentDeliveryKey = `telegram:result:${task.id}:v${String(task.version)}:${task.state}`;
      const currentVersionWasClaimedByLegacyPublisher =
        task.telegramDelivery?.resultDeliveryKey === currentDeliveryKey;
      if (!currentVersionHasOutbox && !currentVersionWasClaimedByLegacyPublisher) {
        issues.push({
          projectId: task.projectId,
          reason: "result_delivery_outbox_missing",
          taskId: task.id,
          taskVersion: task.version,
        });
      }
    }
    if (issues.length === 0) return issues;
    const keys = issues.map((issue) => `audit:${issueKey(issue)}`);
    const existing = await this.prisma.auditEvent.findMany({
      where: { idempotencyKey: { in: keys } },
      select: { idempotencyKey: true },
    });
    const existingKeys = new Set(existing.map((event) => event.idempotencyKey));
    return issues.filter((issue) => !existingKeys.has(`audit:${issueKey(issue)}`));
  }

  async recordAlert(issue: DeliveryWatchdogIssue): Promise<boolean> {
    const key = issueKey(issue);
    try {
      await this.prisma.auditEvent.create({
        data: {
          action: "telegram.result_delivery.watchdog_alerted",
          actor: "SYSTEM",
          correlationId: issue.deliveryKey ?? key,
          idempotencyKey: `audit:${key}`,
          payload: json({
            reason: issue.reason,
            status: issue.status ?? null,
            taskVersion: issue.taskVersion,
          }),
          projectId: issue.projectId,
          targetId: issue.deliveryId ?? issue.taskId,
          targetType: issue.deliveryId === undefined ? "task" : "result_delivery_outbox",
          taskId: issue.taskId,
        },
      });
      return true;
    } catch (error: unknown) {
      if (isUniqueConflict(error)) return false;
      throw error;
    }
  }
}

export interface DeliveryWatchdogPollResult {
  readonly alertsCreated: number;
  readonly issuesObserved: number;
}

export class DeliveryWatchdog {
  private polling = false;

  constructor(
    private readonly store: DeliveryWatchdogStore,
    private readonly slaMs = DEFAULT_DELIVERY_SLA_MS,
  ) {
    if (!Number.isSafeInteger(slaMs) || slaMs <= 0) {
      throw new Error("delivery watchdog SLA must be a positive safe integer");
    }
  }

  async poll(now = new Date()): Promise<DeliveryWatchdogPollResult> {
    if (this.polling) return { alertsCreated: 0, issuesObserved: 0 };
    this.polling = true;
    try {
      const issues = await this.store.listIssues(new Date(now.getTime() - this.slaMs));
      let alertsCreated = 0;
      for (const issue of issues) {
        if (await this.store.recordAlert(issue)) alertsCreated += 1;
      }
      return { alertsCreated, issuesObserved: issues.length };
    } finally {
      this.polling = false;
    }
  }
}
