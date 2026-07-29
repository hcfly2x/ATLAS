import {
  ApprovalActor,
  ApprovalStatus,
  DeliveryOutboxStatus,
  PostExecutionReviewStatus,
  TaskState,
  type PrismaClient,
} from "@prisma/client";

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

const IN_PROGRESS_STATES = [
  TaskState.NORMALIZING,
  TaskState.ROUTING,
  TaskState.SPECIFYING,
  TaskState.QUEUED,
  TaskState.RUNNING,
  TaskState.TESTING,
  TaskState.FINALIZING,
] as const;

const BLOCKED_STATES = [
  TaskState.WAITING_APPROVAL,
  TaskState.WAITING_RESULT_APPROVAL,
  TaskState.CANCEL_REQUESTED,
  TaskState.FAILED,
] as const;

const RECENT_TERMINAL_STATES = [TaskState.COMPLETED] as const;

const RECENT_WINDOW_DAYS = 7;
const RECENT_WINDOW_MS = RECENT_WINDOW_DAYS * 86_400_000;
const INDETERMINATE = "indeterminado" as const;

type DashboardSeverity = "critical" | "high" | "medium" | "info";
type DashboardSignalStatus = "available" | "indeterminate";

interface DashboardBlock<T> {
  readonly count: number | typeof INDETERMINATE;
  readonly items: readonly T[];
  readonly reason?: "signal_unavailable";
  readonly status: DashboardSignalStatus;
}

interface SafeWorkItem {
  readonly complexity: string | null;
  readonly eta: typeof INDETERMINATE;
  readonly progress: {
    readonly methodology: "task_state";
    readonly stage: string;
  };
  readonly projectId: string;
  readonly state: string;
  readonly taskId: string;
  readonly updatedAt: Date;
  readonly version: number;
}

interface ProactiveItem {
  readonly id: string;
  readonly kind:
    | "approval_expired"
    | "approval_pending"
    | "delivery_failed"
    | "delivery_outbox_missing"
    | "delivery_sla_exceeded"
    | "rework_required"
    | "review_unavailable"
    | "task_blocked"
    | "task_cost_limit_exceeded";
  readonly label: string;
  readonly occurredAt: Date;
  readonly projectId: string;
  readonly severity: DashboardSeverity;
  readonly source: {
    readonly id: string;
    readonly type: "approval" | "delivery" | "review" | "task" | "usage";
  };
  readonly taskId: string;
}

const SEVERITY_ORDER: Record<DashboardSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  info: 3,
};

function jsonSafe(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_key, nested: unknown) =>
      typeof nested === "bigint" ? nested.toString() : nested,
    ),
  ) as unknown;
}

function available<T>(items: readonly T[]): DashboardBlock<T> {
  return { count: items.length, items, status: "available" };
}

function indeterminate<T>(): DashboardBlock<T> {
  return {
    count: INDETERMINATE,
    items: [],
    reason: "signal_unavailable",
    status: "indeterminate",
  };
}

function safeWorkItem(task: {
  readonly complexity: string | null;
  readonly id: string;
  readonly projectId: string;
  readonly state: string;
  readonly updatedAt: Date;
  readonly version: number;
}): SafeWorkItem {
  return {
    complexity: task.complexity,
    eta: INDETERMINATE,
    progress: {
      methodology: "task_state",
      stage: task.state,
    },
    projectId: task.projectId,
    state: task.state,
    taskId: task.id,
    updatedAt: task.updatedAt,
    version: task.version,
  };
}

function sortProactiveItems(items: readonly ProactiveItem[]): ProactiveItem[] {
  return [...items].sort(
    (left, right) =>
      SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity] ||
      left.occurredAt.getTime() - right.occurredAt.getTime() ||
      left.id.localeCompare(right.id),
  );
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

  private async safeBlock<T>(loader: () => Promise<readonly T[]>): Promise<DashboardBlock<T>> {
    try {
      return available(await loader());
    } catch {
      return indeterminate();
    }
  }

  private async terminalWithoutDelivery(projectId?: string) {
    const tasks = await this.prisma.task.findMany({
      where: {
        ...(projectId === undefined ? {} : { projectId }),
        origin: { startsWith: "telegram:" },
        state: { in: [TaskState.COMPLETED, TaskState.FAILED] },
        updatedAt: { lte: new Date(this.now().getTime() - this.deliverySlaMs()) },
      },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      select: {
        deliveryOutbox: { select: { taskVersion: true } },
        id: true,
        projectId: true,
        state: true,
        telegramDelivery: { select: { resultDeliveryKey: true } },
        updatedAt: true,
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
    });
  }

  private async terminalWithoutDeliveryCount(projectId?: string): Promise<number> {
    return (await this.terminalWithoutDelivery(projectId)).length;
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

  private attention(
    projectId: string | undefined,
    now: Date,
  ): Promise<DashboardBlock<ProactiveItem>> {
    return this.safeBlock(async () => {
      const approvals = await this.prisma.approval.findMany({
        where: {
          actor: ApprovalActor.USER,
          status: ApprovalStatus.PENDING,
          ...(projectId === undefined ? {} : { task: { projectId } }),
        },
        orderBy: [{ requestedAt: "asc" }, { id: "asc" }],
        take: 200,
        select: {
          expiresAt: true,
          id: true,
          requestedAt: true,
          task: {
            select: {
              id: true,
              projectId: true,
            },
          },
        },
      });
      return approvals.map((approval): ProactiveItem => {
        const expired = approval.expiresAt !== null && approval.expiresAt <= now;
        return {
          id: `approval:${approval.id}`,
          kind: expired ? "approval_expired" : "approval_pending",
          label: expired ? "Aprovação pendente vencida" : "Aprovação pendente",
          occurredAt: approval.requestedAt,
          projectId: approval.task.projectId,
          severity: expired ? "high" : "medium",
          source: { id: approval.id, type: "approval" },
          taskId: approval.task.id,
        };
      });
    });
  }

  private work(
    projectId: string | undefined,
    states: readonly TaskState[],
    extraWhere: Record<string, unknown> = {},
  ): Promise<DashboardBlock<SafeWorkItem>> {
    return this.safeBlock(async () => {
      const tasks = await this.prisma.task.findMany({
        where: {
          ...(projectId === undefined ? {} : { projectId }),
          ...extraWhere,
          state: { in: [...states] },
        },
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
        take: 200,
        select: {
          complexity: true,
          id: true,
          projectId: true,
          state: true,
          updatedAt: true,
          version: true,
        },
      });
      return tasks.map(safeWorkItem);
    });
  }

  private deliveryRisks(
    projectId: string | undefined,
    now: Date,
  ): Promise<DashboardBlock<ProactiveItem>> {
    return this.safeBlock(async () => {
      const cutoff = new Date(now.getTime() - this.deliverySlaMs());
      const [deliveries, missingTasks] = await Promise.all([
        this.prisma.resultDeliveryOutbox.findMany({
          where: {
            ...(projectId === undefined ? {} : { projectId }),
            OR: [
              { status: DeliveryOutboxStatus.DELIVERY_FAILED },
              {
                createdAt: { lte: cutoff },
                status: DeliveryOutboxStatus.PENDING,
              },
            ],
          },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          take: 200,
          select: {
            createdAt: true,
            id: true,
            projectId: true,
            status: true,
            taskId: true,
          },
        }),
        this.terminalWithoutDelivery(projectId),
      ]);
      return [
        ...deliveries.map((delivery): ProactiveItem => {
          const failed = delivery.status === DeliveryOutboxStatus.DELIVERY_FAILED;
          return {
            id: `delivery:${delivery.id}`,
            kind: failed ? "delivery_failed" : "delivery_sla_exceeded",
            label: failed ? "Entrega terminal falhou" : "Entrega terminal excedeu o SLA",
            occurredAt: delivery.createdAt,
            projectId: delivery.projectId,
            severity: failed ? "high" : "medium",
            source: { id: delivery.id, type: "delivery" },
            taskId: delivery.taskId,
          };
        }),
        ...missingTasks.map((task): ProactiveItem => ({
          id: `delivery-missing:${task.id}:v${String(task.version)}`,
          kind: "delivery_outbox_missing",
          label: "Resultado terminal sem registro de entrega",
          occurredAt: task.updatedAt,
          projectId: task.projectId,
          severity: "high",
          source: { id: task.id, type: "task" },
          taskId: task.id,
        })),
      ];
    });
  }

  private reviewRisks(projectId?: string): Promise<DashboardBlock<ProactiveItem>> {
    return this.safeBlock(async () => {
      const reviews = await this.prisma.postExecutionReview.findMany({
        where: {
          status: {
            in: [PostExecutionReviewStatus.REJECTED, PostExecutionReviewStatus.FAILED],
          },
          task: {
            ...(projectId === undefined ? {} : { projectId }),
            state: TaskState.SPECIFYING,
          },
        },
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
        take: 200,
        select: {
          id: true,
          reviewedAt: true,
          status: true,
          task: {
            select: {
              id: true,
              projectId: true,
            },
          },
          updatedAt: true,
        },
      });
      const newestByTask = new Map<string, (typeof reviews)[number]>();
      for (const review of reviews) {
        if (!newestByTask.has(review.task.id)) newestByTask.set(review.task.id, review);
      }
      return [...newestByTask.values()].map((review): ProactiveItem => {
        const unavailable = review.status === PostExecutionReviewStatus.FAILED;
        return {
          id: `review:${review.id}`,
          kind: unavailable ? "review_unavailable" : "rework_required",
          label: unavailable ? "Revisão pós-execução indisponível" : "Retrabalho requerido",
          occurredAt: review.reviewedAt ?? review.updatedAt,
          projectId: review.task.projectId,
          severity: unavailable ? "high" : "medium",
          source: { id: review.id, type: "review" },
          taskId: review.task.id,
        };
      });
    });
  }

  private costRisks(projectId?: string): Promise<DashboardBlock<ProactiveItem>> {
    return this.safeBlock(async () => {
      const projectWhere =
        projectId === undefined ? { taskCostLimitUsd: { not: null } } : { id: projectId };
      const [projects, llmCosts, codexCosts] = await Promise.all([
        this.prisma.project.findMany({
          where: projectWhere,
          select: {
            id: true,
            taskCostLimitUsd: true,
          },
        }),
        this.prisma.llmCall.groupBy({
          by: ["projectId", "taskId"],
          where: projectId === undefined ? {} : { projectId },
          _max: { createdAt: true },
          _sum: { estimatedCostUsd: true },
        }),
        this.prisma.codexUsage.groupBy({
          by: ["projectId", "taskId"],
          where: projectId === undefined ? {} : { projectId },
          _max: { createdAt: true },
          _sum: { estimatedCostUsd: true },
        }),
      ]);
      const limits = new Map(
        projects
          .filter((project) => project.taskCostLimitUsd !== null)
          .map((project) => [project.id, Number(project.taskCostLimitUsd)]),
      );
      const totals = new Map<string, { lastAt: Date; projectId: string; total: number }>();
      for (const row of [...llmCosts, ...codexCosts]) {
        if (row._max.createdAt === null) continue;
        const previous = totals.get(row.taskId);
        const rowLastAt = row._max.createdAt;
        totals.set(row.taskId, {
          lastAt:
            previous === undefined || rowLastAt > previous.lastAt ? rowLastAt : previous.lastAt,
          projectId: row.projectId,
          total: (previous?.total ?? 0) + Number(row._sum.estimatedCostUsd ?? 0),
        });
      }
      return [...totals.entries()]
        .filter(([, value]) => {
          const limit = limits.get(value.projectId);
          return limit !== undefined && value.total > limit;
        })
        .map(([taskId, value]): ProactiveItem => ({
          id: `usage:${taskId}`,
          kind: "task_cost_limit_exceeded",
          label: "Custo registrado excedeu o teto declarado da tarefa",
          occurredAt: value.lastAt,
          projectId: value.projectId,
          severity: "high",
          source: { id: taskId, type: "usage" },
          taskId,
        }));
    });
  }

  async missionControl(projectId?: string) {
    const now = this.now();
    const [attention, inProgress, blocked, recentlyCompleted, delivery, review, cost] =
      await Promise.all([
        this.attention(projectId, now),
        this.work(projectId, IN_PROGRESS_STATES),
        this.work(projectId, BLOCKED_STATES),
        this.work(projectId, RECENT_TERMINAL_STATES, {
          updatedAt: { gte: new Date(now.getTime() - RECENT_WINDOW_MS) },
        }),
        this.deliveryRisks(projectId, now),
        this.reviewRisks(projectId),
        this.costRisks(projectId),
      ]);

    const blockedRisks =
      blocked.status === "available"
        ? blocked.items.map((task): ProactiveItem => ({
            id: `blocked:${task.taskId}:v${String(task.version)}`,
            kind: "task_blocked",
            label: task.state === TaskState.FAILED ? "Tarefa falhou" : "Tarefa aguarda decisão",
            occurredAt: task.updatedAt,
            projectId: task.projectId,
            severity: task.state === TaskState.FAILED ? "high" : "medium",
            source: { id: task.taskId, type: "task" },
            taskId: task.taskId,
          }))
        : [];
    const riskItems = sortProactiveItems([
      ...(attention.status === "available"
        ? attention.items.filter((item) => item.kind === "approval_expired")
        : []),
      ...(delivery.status === "available" ? delivery.items : []),
      ...(review.status === "available" ? review.items : []),
      ...(cost.status === "available" ? cost.items : []),
      ...blockedRisks,
    ]);
    const riskSignals = { cost, delivery, review };
    const unavailableSignals = Object.entries({
      attention,
      blocked,
      cost,
      delivery,
      inProgress,
      recentlyCompleted,
      review,
    })
      .filter(([, block]) => block.status === "indeterminate")
      .map(([name]) => name);
    const risks: DashboardBlock<ProactiveItem> =
      Object.values(riskSignals).every((block) => block.status === "indeterminate") &&
      blocked.status === "indeterminate"
        ? indeterminate()
        : available(riskItems);
    const priorityCandidates = sortProactiveItems([
      ...new Map(
        [...(attention.status === "available" ? attention.items : []), ...riskItems].map((item) => [
          item.id,
          item,
        ]),
      ).values(),
    ]);
    const firstPriority = priorityCandidates[0];
    const priorityNow =
      firstPriority !== undefined
        ? {
            item: firstPriority,
            status: "available" as const,
          }
        : unavailableSignals.length === 7
          ? {
              item: null,
              status: "indeterminate" as const,
              value: INDETERMINATE,
            }
          : {
              item: null,
              status: "available" as const,
            };
    const fact = (code: string, label: string, block: DashboardBlock<unknown>) => ({
      code,
      label,
      value: block.count,
    });
    const intelligenceStatus =
      unavailableSignals.length === 0
        ? "available"
        : unavailableSignals.length === 7
          ? "indeterminate"
          : "partial";

    return {
      generatedAt: now,
      intelligence: {
        facts: [
          fact("needs_attention", "Precisam de você", attention),
          fact("in_progress", "Em execução", inProgress),
          fact("blocked", "Paradas ou bloqueadas", blocked),
          fact("recently_completed", "Concluídas recentemente", recentlyCompleted),
          fact("risks", "Riscos ativos", risks),
          {
            code: "pending_questions",
            label: "Dúvidas pendentes",
            value: INDETERMINATE,
          },
        ],
        headline:
          priorityNow.item !== null
            ? priorityNow.item.label
            : priorityNow.status === "available"
              ? "Nenhuma prioridade derivada dos sinais disponíveis"
              : INDETERMINATE,
        generatedBy: "deterministic_rules",
        status: intelligenceStatus,
      },
      methodology: {
        cost: "declared_task_cost_limit",
        eta: INDETERMINATE,
        pendingQuestions: INDETERMINATE,
        progress: "task_state",
        recentWindowDays: RECENT_WINDOW_DAYS,
      },
      needsAttention: attention,
      inProgress,
      blocked,
      recentlyCompleted,
      risks,
      priorityNow,
      projectId: projectId ?? null,
      unavailableSignals,
    };
  }

  async overview(projectId?: string, periodDays = 30) {
    const since = new Date(this.now().getTime() - periodDays * 86_400_000);
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
        failureStage: true,
        id: true,
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
      select: {
        approvals: {
          orderBy: { requestedAt: "asc" },
          select: {
            actor: true,
            channel: true,
            expiresAt: true,
            id: true,
            requestedAt: true,
            respondedAt: true,
            status: true,
            targetHash: true,
            targetId: true,
            targetType: true,
            targetVersion: true,
            type: true,
          },
        },
        complexity: true,
        createdAt: true,
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
        empiricalReviews: {
          orderBy: { createdAt: "asc" },
          select: {
            createdAt: true,
            executionId: true,
            id: true,
            payloadHash: true,
            reviewedAt: true,
            reviewerId: true,
            specificationId: true,
            verdict: true,
            version: true,
          },
        },
        executions: {
          orderBy: { attempt: "asc" },
          select: {
            attempt: true,
            createdAt: true,
            diffHash: true,
            failureStage: true,
            fencingToken: true,
            id: true,
            reconciledAt: true,
            resultHash: true,
            specificationId: true,
            status: true,
            updatedAt: true,
            workerId: true,
          },
        },
        failureStage: true,
        id: true,
        postExecutionReviews: {
          orderBy: { createdAt: "asc" },
          select: {
            createdAt: true,
            empiricalVerdict: true,
            executionId: true,
            failureReason: true,
            id: true,
            payloadHash: true,
            reconciliationReason: true,
            reviewedAt: true,
            reviewerDecision: true,
            reviewerId: true,
            specificationId: true,
            status: true,
            updatedAt: true,
            version: true,
          },
        },
        projectId: true,
        specifications: {
          orderBy: { version: "asc" },
          select: {
            createdAt: true,
            deliveryMode: true,
            id: true,
            payloadHash: true,
            version: true,
          },
        },
        state: true,
        updatedAt: true,
        version: true,
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
      select: {
        action: true,
        actor: true,
        correlationId: true,
        createdAt: true,
        id: true,
        projectId: true,
        targetId: true,
        targetType: true,
        taskId: true,
      },
    });
  }

  async memory(projectId: string) {
    return this.prisma.memoryItem.findMany({
      where: { projectId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 200,
      select: {
        agentId: true,
        createdAt: true,
        id: true,
        payloadHash: true,
        projectId: true,
        taskId: true,
        type: true,
      },
    });
  }
}
