import { DeliveryOutboxStatus, TaskState, type PrismaClient } from "@prisma/client";

const TASK_STATES = [
  "NEW",
  "NORMALIZING",
  "ROUTING",
  "SPECIFYING",
  "WAITING_APPROVAL",
  "QUEUED",
  "RUNNING",
  "TESTING",
  "WAITING_RESULT_APPROVAL",
  "FINALIZING",
  "CANCEL_REQUESTED",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;

function jsonSafe(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_key, nested: unknown) =>
      typeof nested === "bigint" ? nested.toString() : nested,
    ),
  ) as unknown;
}

export class DashboardService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly options: {
      readonly deliverySlaMs?: number;
      readonly now?: () => Date;
    } = {},
  ) {
    if (
      options.deliverySlaMs !== undefined &&
      (!Number.isSafeInteger(options.deliverySlaMs) || options.deliverySlaMs <= 0)
    ) {
      throw new Error("dashboard delivery SLA must be a positive safe integer");
    }
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  private deliverySlaMs(): number {
    return this.options.deliverySlaMs ?? 5 * 60_000;
  }

  private async terminalWithoutDeliveryCount(projectId?: string): Promise<number> {
    const tasks = await this.prisma.task.findMany({
      where: {
        ...(projectId === undefined ? {} : { projectId }),
        origin: { startsWith: "telegram:" },
        state: { in: [TaskState.COMPLETED, TaskState.FAILED] },
        updatedAt: { lte: new Date(this.now().getTime() - this.deliverySlaMs()) },
      },
      select: {
        deliveryOutbox: { select: { taskVersion: true } },
        id: true,
        state: true,
        telegramDelivery: { select: { resultDeliveryKey: true } },
        version: true,
      },
    });
    return tasks.filter((task) => {
      const currentVersionHasOutbox = task.deliveryOutbox.some(
        (delivery) => delivery.taskVersion === task.version,
      );
      const currentDeliveryKey = `telegram:result:${task.id}:v${String(task.version)}:${task.state}`;
      const currentVersionWasClaimedByLegacyPublisher =
        task.telegramDelivery?.resultDeliveryKey === currentDeliveryKey;
      return !currentVersionHasOutbox && !currentVersionWasClaimedByLegacyPublisher;
    }).length;
  }

  private async deliverySummary(projectId?: string) {
    const cutoff = new Date(this.now().getTime() - this.deliverySlaMs());
    const [grouped, overdue, missing] = await Promise.all([
      this.prisma.resultDeliveryOutbox.groupBy({
        by: ["status"],
        where: projectId === undefined ? {} : { projectId },
        _count: { _all: true },
      }),
      this.prisma.resultDeliveryOutbox.count({
        where: {
          ...(projectId === undefined ? {} : { projectId }),
          createdAt: { lte: cutoff },
          status: DeliveryOutboxStatus.PENDING,
        },
      }),
      this.terminalWithoutDeliveryCount(projectId),
    ]);
    const counts = new Map(grouped.map((row) => [row.status, row._count._all]));
    return {
      delivered: counts.get(DeliveryOutboxStatus.DELIVERED) ?? 0,
      deliveryFailed: counts.get(DeliveryOutboxStatus.DELIVERY_FAILED) ?? 0,
      missingOutbox: missing,
      pending: counts.get(DeliveryOutboxStatus.PENDING) ?? 0,
      pendingOverdue: overdue,
      slaMs: this.deliverySlaMs(),
    };
  }

  async overview(projectId?: string, periodDays = 30) {
    const since = new Date(Date.now() - periodDays * 86_400_000);
    const [projects, grouped, llm, codex, delivery] = await Promise.all([
      this.prisma.project.findMany({
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      this.prisma.task.groupBy({
        by: ["state"],
        where: projectId === undefined ? {} : { projectId },
        _count: { _all: true },
      }),
      this.prisma.llmCall.aggregate({
        where: {
          createdAt: { gte: since },
          ...(projectId === undefined ? {} : { projectId }),
        },
        _sum: { estimatedCostUsd: true },
      }),
      this.prisma.codexUsage.aggregate({
        where: {
          createdAt: { gte: since },
          ...(projectId === undefined ? {} : { projectId }),
        },
        _sum: { estimatedCostUsd: true },
      }),
      this.deliverySummary(projectId),
    ]);
    const counts = new Map(grouped.map((row) => [row.state, row._count._all]));
    return {
      costs: {
        codex: {
          capUsd: 75,
          spentUsd: Number(codex._sum.estimatedCostUsd ?? 0),
        },
        llm: {
          capUsd: 25,
          spentUsd: Number(llm._sum.estimatedCostUsd ?? 0),
        },
        periodDays,
      },
      delivery,
      projects,
      states: TASK_STATES.map((state) => ({ count: counts.get(state) ?? 0, state })),
    };
  }

  async tasks(projectId?: string) {
    return this.prisma.task.findMany({
      where: projectId === undefined ? {} : { projectId },
      orderBy: { updatedAt: "desc" },
      take: 200,
      select: {
        complexity: true,
        createdAt: true,
        id: true,
        originalMessage: true,
        projectId: true,
        state: true,
        updatedAt: true,
        version: true,
      },
    });
  }

  async task(taskId: string) {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: {
        approvals: { orderBy: { requestedAt: "asc" } },
        deliveryOutbox: {
          orderBy: { createdAt: "asc" },
          select: {
            attempts: true,
            createdAt: true,
            deliveredAt: true,
            id: true,
            lastError: true,
            nextAttemptAt: true,
            status: true,
            taskVersion: true,
            updatedAt: true,
          },
        },
        executions: { orderBy: { attempt: "asc" } },
        specifications: { orderBy: { version: "asc" } },
      },
    });
    return task === null ? null : jsonSafe(task);
  }

  async deliveries(projectId?: string) {
    const cutoff = new Date(this.now().getTime() - this.deliverySlaMs());
    const rows = await this.prisma.resultDeliveryOutbox.findMany({
      where: projectId === undefined ? {} : { projectId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 200,
      select: {
        attempts: true,
        createdAt: true,
        deliveredAt: true,
        id: true,
        lastError: true,
        nextAttemptAt: true,
        projectId: true,
        status: true,
        taskId: true,
        taskVersion: true,
        updatedAt: true,
      },
    });
    return rows.map((row) => ({
      ...row,
      health:
        row.status === DeliveryOutboxStatus.DELIVERY_FAILED
          ? "DELIVERY_FAILED"
          : row.status === DeliveryOutboxStatus.PENDING && row.createdAt <= cutoff
            ? "SLA_EXCEEDED"
            : row.status,
    }));
  }

  async audit(projectId: string) {
    return this.prisma.auditEvent.findMany({
      where: { projectId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 300,
    });
  }

  async memory(projectId: string) {
    return this.prisma.memoryItem.findMany({
      where: { projectId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 200,
    });
  }
}
