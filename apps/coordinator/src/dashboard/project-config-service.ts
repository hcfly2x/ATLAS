import { AuditActor, type Prisma } from "@prisma/client";

import {
  createDashboardProjectRequestSchema,
  dashboardProjectCommandResponseSchema,
  dashboardProjectConfigSchema,
  dashboardProjectConfigsResponseSchema,
  dashboardProjectRepositorySuggestionSchema,
  dashboardProjectStatusRequestSchema,
  detectDashboardProjectRepositoryRequestSchema,
  updateDashboardProjectRequestSchema,
  type DashboardProjectConfig,
} from "@atlas/contracts";
import { canonicalPayloadHash } from "@atlas/shared";

import {
  ProjectConfigConflictError,
  ProjectConfigNotFoundError,
  ProjectConfigValidationError,
  ProjectConfigVersionConflictError,
  type EditableProject,
  type ProjectConfigMutation,
  type ProjectConfigStore,
} from "../setup/project-config.js";
import type {
  DashboardCommandKind,
  DashboardCommandReceiptStore,
} from "./command-receipt-store.js";
import { ProjectProjectionReconciler, safeProjectChange } from "./project-projection-reconciler.js";

export type DashboardProjectConfigErrorCode =
  | "DASHBOARD_PROJECT_CONFIG_CONFLICT"
  | "DASHBOARD_PROJECT_CONFIG_INVALID"
  | "DASHBOARD_PROJECT_CONFIG_NOT_FOUND"
  | "DASHBOARD_PROJECT_CONFIG_VERSION_CONFLICT";

export class DashboardProjectConfigError extends Error {
  constructor(readonly code: DashboardProjectConfigErrorCode) {
    super(code);
    this.name = "DashboardProjectConfigError";
  }
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

async function publicProject(
  store: ProjectConfigStore,
  project: EditableProject,
): Promise<DashboardProjectConfig> {
  const issues = await store.activationIssues(project);
  return dashboardProjectConfigSchema.parse({
    activationIssues: issues,
    activationReady: issues.length === 0,
    allowedExecutables: [...new Set(project.allowed_commands.map(({ executable }) => executable))],
    autonomyLevel: project.autonomy_level,
    configHash: store.configHash(project),
    id: project.id,
    name: project.name,
    repositoryConfigured: project.repository !== null,
    retention: project.retention,
    status: project.status,
  });
}

function errorCode(error: unknown): DashboardProjectConfigErrorCode | undefined {
  if (error instanceof ProjectConfigNotFoundError) return "DASHBOARD_PROJECT_CONFIG_NOT_FOUND";
  if (error instanceof ProjectConfigVersionConflictError) {
    return "DASHBOARD_PROJECT_CONFIG_VERSION_CONFLICT";
  }
  if (error instanceof ProjectConfigValidationError) return "DASHBOARD_PROJECT_CONFIG_INVALID";
  if (error instanceof ProjectConfigConflictError) return "DASHBOARD_PROJECT_CONFIG_CONFLICT";
  return undefined;
}

export class DashboardProjectConfigService {
  constructor(
    private readonly store: ProjectConfigStore,
    private readonly receipts: DashboardCommandReceiptStore,
    private readonly projection = new ProjectProjectionReconciler(store),
  ) {}

  async list() {
    const projects = await Promise.all(
      (await this.store.list()).map((project) => publicProject(this.store, project)),
    );
    return dashboardProjectConfigsResponseSchema.parse({ projects });
  }

  async detect(input: unknown) {
    const parsed = detectDashboardProjectRepositoryRequestSchema.parse(input);
    const suggestion = await this.store.suggest(parsed.repository);
    return dashboardProjectRepositorySuggestionSchema.parse({
      command: suggestion.command,
      source: suggestion.source,
    });
  }

  async create(input: unknown, correlationId: string) {
    const parsed = createDashboardProjectRequestSchema.parse(input);
    return this.command(
      "create_project",
      parsed.id,
      parsed.idempotencyKey,
      canonicalPayloadHash(parsed),
      correlationId,
      () => this.store.createDraft({ id: parsed.id, name: parsed.name }),
    );
  }

  async update(projectId: string, input: unknown, correlationId: string) {
    const parsed = updateDashboardProjectRequestSchema.parse(input);
    const current = await this.store.get(projectId);
    if (current === undefined)
      throw new DashboardProjectConfigError("DASHBOARD_PROJECT_CONFIG_NOT_FOUND");
    const desired: EditableProject = {
      ...current,
      allowed_commands: parsed.allowedCommands ?? current.allowed_commands,
      autonomy_level: parsed.autonomyLevel,
      name: parsed.name,
      repository: parsed.repository === undefined ? current.repository : parsed.repository,
      retention: parsed.retention,
    };
    return this.command(
      "update_project_config",
      projectId,
      parsed.idempotencyKey,
      canonicalPayloadHash(parsed),
      correlationId,
      () => this.store.put(desired, parsed.configHash),
    );
  }

  async activate(projectId: string, input: unknown, correlationId: string) {
    const parsed = dashboardProjectStatusRequestSchema.parse(input);
    return this.command(
      "activate_project",
      projectId,
      parsed.idempotencyKey,
      canonicalPayloadHash(parsed),
      correlationId,
      () => this.store.activate(projectId, parsed.configHash),
    );
  }

  async deactivate(projectId: string, input: unknown, correlationId: string) {
    const parsed = dashboardProjectStatusRequestSchema.parse(input);
    return this.command(
      "deactivate_project",
      projectId,
      parsed.idempotencyKey,
      canonicalPayloadHash(parsed),
      correlationId,
      () => this.store.deactivate(projectId, parsed.configHash),
    );
  }

  private async command(
    command: Extract<
      DashboardCommandKind,
      "activate_project" | "create_project" | "deactivate_project" | "update_project_config"
    >,
    projectId: string,
    idempotencyKey: string,
    requestHash: string,
    correlationId: string,
    mutate: () => Promise<ProjectConfigMutation>,
  ) {
    let yamlReplay = false;
    const result = await this.receipts.executeProject<DashboardProjectConfig>(
      {
        actor: "user",
        command,
        correlationId,
        idempotencyKey,
        requestHash,
        requestedProject: projectId,
      },
      async (transaction) => {
        let mutation: ProjectConfigMutation;
        try {
          mutation = await mutate();
        } catch (error: unknown) {
          const code = errorCode(error);
          if (code === undefined) throw error;
          return { resultCode: code, status: "rejected" };
        }
        yamlReplay = !mutation.changed;
        await this.projection.syncProject(transaction, mutation.project);
        await transaction.auditEvent.create({
          data: {
            action: `dashboard.project.${command}`,
            actor: AuditActor.USER,
            correlationId,
            idempotencyKey: `${idempotencyKey}:audit`,
            payload: json({
              after: safeProjectChange(mutation.project),
              before: safeProjectChange(mutation.before),
              changed: mutation.changed,
              requestHash,
            }),
            projectId,
            targetId: projectId,
            targetType: "project",
          },
        });
        return {
          resultCode: "DASHBOARD_PROJECT_CONFIG_UPDATED",
          resultPayload: await publicProject(this.store, mutation.project),
          status: "accepted",
        };
      },
    );
    if (result.status === "rejected") {
      throw new DashboardProjectConfigError(result.resultCode as DashboardProjectConfigErrorCode);
    }
    return dashboardProjectCommandResponseSchema.parse({
      idempotentReplay: result.idempotentReplay || yamlReplay,
      project: result.resultPayload,
    });
  }
}
