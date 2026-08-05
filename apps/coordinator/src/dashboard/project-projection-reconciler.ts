import { AuditActor, Prisma, ProjectStatus, type PrismaClient } from "@prisma/client";

import { canonicalPayloadHash } from "@atlas/shared";

import type { EditableProject, ProjectConfigStore } from "../setup/project-config.js";

const statusMap: Record<EditableProject["status"], ProjectStatus> = {
  active: ProjectStatus.ACTIVE,
  archived: ProjectStatus.ARCHIVED,
  draft: ProjectStatus.DRAFT,
  future: ProjectStatus.FUTURE,
};

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export function safeProjectChange(project: EditableProject | null): Prisma.InputJsonValue | null {
  if (project === null) return null;
  return json({
    allowedExecutables: [...new Set(project.allowed_commands.map(({ executable }) => executable))],
    autonomyLevel: project.autonomy_level,
    repositoryConfigured: project.repository !== null,
    retention: project.retention,
    status: project.status,
  });
}

function projectionData(project: EditableProject) {
  return {
    allowedCommands: json(project.allowed_commands),
    autonomyLevel: project.autonomy_level,
    dataClassification: project.data_classification,
    name: project.name,
    policy: project.policy,
    protectedPathsProfile: project.protected_paths_profile,
    repository: project.repository,
    requiredTools: json(project.required_tools),
    retention: json(project.retention),
    risk: project.risk,
    runtime:
      project.runtime === null || project.runtime === undefined
        ? Prisma.JsonNull
        : json(project.runtime),
    status: statusMap[project.status],
    taskCostLimitUsd: project.task_cost_limit_usd,
  };
}

export interface ProjectProjectionReconciliationResult {
  readonly archivedUndeclaredCount: number;
  readonly declaredCount: number;
}

export class ProjectProjectionReconciliationError extends Error {
  readonly code = "PROJECT_PROJECTION_RECONCILIATION_FAILED";

  constructor() {
    super("Project projection reconciliation failed");
    this.name = "ProjectProjectionReconciliationError";
  }
}

export class ProjectProjectionReconciler {
  constructor(private readonly store: ProjectConfigStore) {}

  async syncProject(
    transaction: Prisma.TransactionClient,
    project: EditableProject,
  ): Promise<void> {
    const data = projectionData(project);
    await transaction.project.upsert({
      where: { id: project.id },
      create: { id: project.id, ...data },
      update: data,
    });
  }

  async reconcileAll(prisma: Pick<PrismaClient, "$transaction">) {
    // Parse and validate the complete source of truth before opening a transaction
    // or changing any projection row.
    const projects = [...(await this.store.list())].sort((left, right) =>
      left.id.localeCompare(right.id),
    );
    return prisma.$transaction(async (transaction) => {
      const declaredIds = projects.map(({ id }) => id);
      const activeUndeclared = await transaction.project.findMany({
        where: {
          status: ProjectStatus.ACTIVE,
          ...(declaredIds.length === 0 ? {} : { id: { notIn: declaredIds } }),
        },
        orderBy: { id: "asc" },
        select: { id: true },
      });

      for (const project of projects) {
        await this.syncProject(transaction, project);
      }

      for (const project of activeUndeclared) {
        await transaction.project.updateMany({
          where: { id: project.id, status: ProjectStatus.ACTIVE },
          data: { status: ProjectStatus.ARCHIVED },
        });
      }

      const auditEvents = [
        ...projects.map((project) => {
          const configHash = this.store.configHash(project);
          return {
            action: "project.projection.reconciled",
            actor: AuditActor.SYSTEM,
            correlationId: "project-projection:startup",
            idempotencyKey: `project-projection:${canonicalPayloadHash({ configHash, projectId: project.id })}`,
            payload: json({
              after: safeProjectChange(project),
              configHash,
              source: "projects_yaml",
            }),
            projectId: project.id,
            targetId: project.id,
            targetType: "project",
          };
        }),
        ...activeUndeclared.map((project) => ({
          action: "project.projection.archived_undeclared",
          actor: AuditActor.SYSTEM,
          correlationId: "project-projection:startup",
          idempotencyKey: `project-projection:${canonicalPayloadHash({ projectId: project.id, status: "archived_undeclared" })}`,
          payload: json({
            after: { status: "archived" },
            before: { status: "active" },
            reason: "absent_from_projects_yaml",
          }),
          projectId: project.id,
          targetId: project.id,
          targetType: "project",
        })),
      ];
      if (auditEvents.length > 0) {
        await transaction.auditEvent.createMany({
          data: auditEvents,
          skipDuplicates: true,
        });
      }

      return {
        archivedUndeclaredCount: activeUndeclared.length,
        declaredCount: projects.length,
      } satisfies ProjectProjectionReconciliationResult;
    });
  }
}

export async function reconcileProjectProjectionAtStartup(
  reconciler: ProjectProjectionReconciler,
  prisma: Pick<PrismaClient, "$transaction">,
  recordFailure: (code: "PROJECT_PROJECTION_RECONCILIATION_FAILED") => void,
): Promise<ProjectProjectionReconciliationResult> {
  try {
    return await reconciler.reconcileAll(prisma);
  } catch {
    recordFailure("PROJECT_PROJECTION_RECONCILIATION_FAILED");
    throw new ProjectProjectionReconciliationError();
  }
}
