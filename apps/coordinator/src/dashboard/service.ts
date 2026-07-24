import type { PrismaClient } from "@prisma/client";

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
  constructor(private readonly prisma: PrismaClient) {}

  async overview(projectId?: string, periodDays = 30) {
    const since = new Date(Date.now() - periodDays * 86_400_000);
    const [projects, grouped, llm, codex] = await Promise.all([
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
        executions: { orderBy: { attempt: "asc" } },
        specifications: { orderBy: { version: "asc" } },
      },
    });
    return task === null ? null : jsonSafe(task);
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
