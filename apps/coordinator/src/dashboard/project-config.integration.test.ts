import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PrismaClient, ProjectStatus } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { stringify } from "yaml";

import { TaskIdempotencyConflictError } from "@atlas/core";

import { PrismaTaskCoreStore } from "../core/prisma-task-core-store.js";
import { ProjectConfigStore, type EditableProject } from "../setup/project-config.js";
import { TaskIntakeService } from "../tasks/intake.js";
import { PrismaDashboardCommandReceiptStore } from "./command-receipt-store.js";
import {
  DashboardProjectConfigService,
  type DashboardProjectConfigError,
} from "./project-config-service.js";
import {
  ProjectProjectionReconciler,
  ProjectProjectionReconciliationError,
  reconcileProjectProjectionAtStartup,
} from "./project-projection-reconciler.js";
import { DashboardService } from "./service.js";
import {
  DashboardTaskCommandService,
  type DashboardTaskCommandError,
} from "./task-command-service.js";

const prisma = new PrismaClient();
const directories: string[] = [];

beforeAll(async () => prisma.$connect());
afterAll(async () => {
  await prisma.$disconnect();
  await Promise.all(directories.map((path) => rm(path, { force: true, recursive: true })));
});

function manifest(projects: object[] = []) {
  return {
    schema: {
      defaults: {
        allowed_commands: [],
        autonomy_level: 2,
        policy: "least_privilege",
        protected_paths_profile: "project_default",
        required_tools: { codex_cli: null, git: null, gnu_tools: [], node: null },
        retention: {
          audit_events_expire: false,
          files_days: 30,
          logs_days: 30,
          sensitive_days: 7,
        },
        status: "draft",
        task_cost_limit_usd: 2,
      },
    },
    projects,
  };
}

async function serviceFixture(projects: object[] = []) {
  const root = await mkdtemp(join(tmpdir(), "atlas-project-management-integration-"));
  directories.push(root);
  const configPath = join(root, "projects.yaml");
  await writeFile(configPath, stringify(manifest(projects)));
  const store = new ProjectConfigStore(configPath);
  const reconciler = new ProjectProjectionReconciler(store);
  return {
    configPath,
    reconciler,
    root,
    service: new DashboardProjectConfigService(
      store,
      new PrismaDashboardCommandReceiptStore(prisma),
      reconciler,
    ),
    store,
  };
}

function configuredProject(input: {
  id: string;
  name: string;
  repository: string;
  status: "active" | "draft";
}): EditableProject {
  return {
    allowed_commands: [{ args: ["test-sensitive-value"], executable: "pnpm" }],
    autonomy_level: 2,
    data_classification: "internal",
    id: input.id,
    name: input.name,
    policy: "least_privilege",
    protected_paths_profile: "project_default",
    repository: input.repository,
    required_tools: { codex_cli: null, git: null, gnu_tools: [], node: null },
    retention: {
      audit_events_expire: false,
      files_days: 30,
      logs_days: 30,
      sensitive_days: null,
    },
    risk: "moderate",
    runtime: null,
    status: input.status,
    task_cost_limit_usd: 2,
  };
}

describe("Dashboard project management with PostgreSQL", () => {
  it("projects a newly created YAML draft immediately and excludes it after archival", async () => {
    const { service, store } = await serviceFixture();
    const projectId = `project-${randomUUID()}`;
    const dashboard = new DashboardService(prisma);

    await service.create(
      {
        confirmed: true,
        id: projectId,
        idempotencyKey: randomUUID(),
        name: "Runtime YAML Project",
      },
      randomUUID(),
    );

    expect((await store.get(projectId))?.status).toBe("draft");
    expect((await dashboard.projectsBoard()).projects.map(({ id }) => id)).toContain(projectId);
    expect((await dashboard.overview()).projects.map(({ id }) => id)).toContain(projectId);
    expect((await dashboard.projects()).projects.map(({ id }) => id)).toContain(projectId);

    await prisma.project.update({
      where: { id: projectId },
      data: { status: ProjectStatus.ARCHIVED },
    });

    expect((await dashboard.projectsBoard()).projects.map(({ id }) => id)).not.toContain(projectId);
    expect((await dashboard.overview()).projects.map(({ id }) => id)).not.toContain(projectId);
    expect((await dashboard.projects()).projects.map(({ id }) => id)).not.toContain(projectId);
  });

  it("repairs a missing projection when create is retried after YAML already committed", async () => {
    const { service, store } = await serviceFixture();
    const projectId = `project-${randomUUID()}`;
    const idempotencyKey = randomUUID();
    await store.createDraft({ id: projectId, name: "YAML Ahead Project" });
    expect(await prisma.project.findUnique({ where: { id: projectId } })).toBeNull();

    const repaired = await service.create(
      {
        confirmed: true,
        id: projectId,
        idempotencyKey,
        name: "YAML Ahead Project",
      },
      randomUUID(),
    );
    const replay = await service.create(
      {
        confirmed: true,
        id: projectId,
        idempotencyKey,
        name: "YAML Ahead Project",
      },
      randomUUID(),
    );

    expect(repaired.idempotentReplay).toBe(true);
    expect(replay.idempotentReplay).toBe(true);
    expect(await prisma.project.findUniqueOrThrow({ where: { id: projectId } })).toMatchObject({
      autonomyLevel: 2,
      status: ProjectStatus.DRAFT,
    });
    await expect(
      service.create(
        {
          confirmed: true,
          id: projectId,
          idempotencyKey,
          name: "Divergent Project",
        },
        randomUUID(),
      ),
    ).rejects.toBeInstanceOf(TaskIdempotencyConflictError);
  });

  it("repairs update and activation projections but rejects a divergent completed request", async () => {
    const { root, service, store } = await serviceFixture();
    const projectId = `project-${randomUUID()}`;
    const created = await service.create(
      {
        confirmed: true,
        id: projectId,
        idempotencyKey: randomUUID(),
        name: "Retry Project",
      },
      randomUUID(),
    );
    const repository = join(root, "retry-repository-sensitive-value");
    await mkdir(join(repository, ".git"), { recursive: true });
    const desired = configuredProject({
      id: projectId,
      name: "Retry Project",
      repository,
      status: "draft",
    });
    const yamlUpdate = await store.put(desired, created.project.configHash);

    const repairedUpdate = await service.update(
      projectId,
      {
        allowedCommands: desired.allowed_commands,
        autonomyLevel: desired.autonomy_level,
        configHash: created.project.configHash,
        confirmed: true,
        idempotencyKey: randomUUID(),
        name: desired.name,
        repository,
        retention: desired.retention,
      },
      randomUUID(),
    );
    expect(repairedUpdate.idempotentReplay).toBe(true);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: projectId } })).repository).toBe(
      repository,
    );

    const activationSourceHash = store.configHash(yamlUpdate.project);
    await store.activate(projectId, activationSourceHash);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: projectId } })).status).toBe(
      ProjectStatus.DRAFT,
    );
    const repairedActivation = await service.activate(
      projectId,
      {
        configHash: activationSourceHash,
        confirmed: true,
        idempotencyKey: randomUUID(),
      },
      randomUUID(),
    );
    expect(repairedActivation).toMatchObject({
      idempotentReplay: true,
      project: { status: "active" },
    });
    expect((await prisma.project.findUniqueOrThrow({ where: { id: projectId } })).status).toBe(
      ProjectStatus.ACTIVE,
    );

    await expect(
      service.activate(
        projectId,
        {
          configHash: `sha256:${"0".repeat(64)}`,
          confirmed: true,
          idempotencyKey: randomUUID(),
        },
        randomUUID(),
      ),
    ).rejects.toEqual(
      expect.objectContaining<Partial<DashboardProjectConfigError>>({
        code: "DASHBOARD_PROJECT_CONFIG_VERSION_CONFLICT",
      }),
    );
  });

  it("persists, replays, activates and audits without leaking the repository path", async () => {
    const { root, service } = await serviceFixture();
    const projectId = `project-${randomUUID()}`;
    const createKey = randomUUID();
    const created = await service.create(
      {
        confirmed: true,
        id: projectId,
        idempotencyKey: createKey,
        name: "Integration Project",
      },
      randomUUID(),
    );
    const replay = await service.create(
      {
        confirmed: true,
        id: projectId,
        idempotencyKey: createKey,
        name: "Integration Project",
      },
      randomUUID(),
    );
    expect(replay.idempotentReplay).toBe(true);
    expect(await prisma.project.findUniqueOrThrow({ where: { id: projectId } })).toMatchObject({
      autonomyLevel: 2,
      repository: null,
      status: ProjectStatus.DRAFT,
    });

    const repository = join(root, "repository-sensitive-value");
    await mkdir(join(repository, ".git"), { recursive: true });
    const updated = await service.update(
      projectId,
      {
        allowedCommands: [{ args: ["test"], executable: "pnpm" }],
        autonomyLevel: 2,
        configHash: created.project.configHash,
        confirmed: true,
        idempotencyKey: randomUUID(),
        name: "Integration Project",
        repository,
        retention: created.project.retention,
      },
      randomUUID(),
    );
    const activated = await service.activate(
      projectId,
      {
        configHash: updated.project.configHash,
        confirmed: true,
        idempotencyKey: randomUUID(),
      },
      randomUUID(),
    );
    expect(activated.project.status).toBe("active");
    expect((await prisma.project.findUniqueOrThrow({ where: { id: projectId } })).status).toBe(
      ProjectStatus.ACTIVE,
    );

    await expect(
      service.create(
        {
          confirmed: true,
          id: projectId,
          idempotencyKey: createKey,
          name: "Divergent Project",
        },
        randomUUID(),
      ),
    ).rejects.toBeInstanceOf(TaskIdempotencyConflictError);
    const audit = await prisma.auditEvent.findMany({ where: { projectId } });
    expect(audit).toHaveLength(3);
    expect(JSON.stringify({ activated, audit })).not.toContain(repository);
    expect(JSON.stringify(audit)).not.toContain('"args"');
  });

  it("reconciles the complete YAML projection and archives every undeclared status without deleting rows", async () => {
    const existingProjection = await prisma.project.findMany({
      where: { status: { not: ProjectStatus.ARCHIVED } },
      select: { id: true, status: true },
    });
    const root = await mkdtemp(join(tmpdir(), "atlas-project-boot-integration-"));
    directories.push(root);
    const repository = join(root, "boot-repository-sensitive-value");
    await mkdir(join(repository, ".git"), { recursive: true });
    const declaredActiveId = `project-${randomUUID()}`;
    const declaredDraftId = `project-${randomUUID()}`;
    const undeclaredIds = [
      { id: `project-${randomUUID()}`, status: ProjectStatus.DRAFT },
      { id: `project-${randomUUID()}`, status: ProjectStatus.ACTIVE },
      { id: `project-${randomUUID()}`, status: ProjectStatus.FUTURE },
    ] as const;
    const desiredActive = configuredProject({
      id: declaredActiveId,
      name: "Declared Active Project",
      repository,
      status: "active",
    });
    const desiredDraft = configuredProject({
      id: declaredDraftId,
      name: "Declared Draft Project",
      repository,
      status: "draft",
    });
    const declaredIds = new Set([declaredActiveId, declaredDraftId]);
    const { reconciler } = await serviceFixture([desiredActive, desiredDraft]);
    await prisma.project.upsert({
      where: { id: declaredActiveId },
      create: {
        allowedCommands: [],
        autonomyLevel: 0,
        dataClassification: "internal",
        id: declaredActiveId,
        name: "Stale Projection",
        policy: "least_privilege",
        protectedPathsProfile: "project_default",
        repository: null,
        requiredTools: {},
        retention: {},
        risk: "low",
        status: ProjectStatus.DRAFT,
      },
      update: { autonomyLevel: 0, repository: null, status: ProjectStatus.DRAFT },
    });
    await prisma.project.upsert({
      where: { id: declaredDraftId },
      create: {
        allowedCommands: [],
        autonomyLevel: 0,
        dataClassification: "internal",
        id: declaredDraftId,
        name: "Stale Declared Draft",
        policy: "least_privilege",
        protectedPathsProfile: "project_default",
        repository: null,
        requiredTools: {},
        retention: {},
        risk: "low",
        status: ProjectStatus.ACTIVE,
      },
      update: { autonomyLevel: 0, repository: null, status: ProjectStatus.ACTIVE },
    });
    for (const project of undeclaredIds) {
      await prisma.project.create({
        data: {
          allowedCommands: [{ args: ["SECRET_ARGUMENT"], executable: "pnpm" }],
          autonomyLevel: 4,
          dataClassification: "internal",
          id: project.id,
          name: `Undeclared ${project.status}`,
          policy: "least_privilege",
          protectedPathsProfile: "project_default",
          repository: "/tmp/SECRET_REPOSITORY_PATH",
          requiredTools: {},
          retention: {
            audit_events_expire: false,
            files_days: 30,
            logs_days: 30,
            sensitive_days: 7,
          },
          risk: "critical",
          status: project.status,
        },
      });
    }
    const retainedTask = await prisma.task.create({
      data: {
        idempotencyKey: `projection-retained-${randomUUID()}`,
        origin: "integration-test",
        originalMessage: "synthetic projection retention fixture",
        projectId: undeclaredIds[0].id,
      },
    });
    const beforeCounts = {
      audits: await prisma.auditEvent.count(),
      projects: await prisma.project.count(),
      tasks: await prisma.task.count(),
    };

    try {
      const first = await reconcileProjectProjectionAtStartup(reconciler, prisma, () => undefined);
      const trackedAuditCount = await prisma.auditEvent.count({
        where: { projectId: { in: [...declaredIds, ...undeclaredIds.map(({ id }) => id)] } },
      });
      const second = await reconcileProjectProjectionAtStartup(reconciler, prisma, () => undefined);

      expect(first.archivedUndeclaredCount).toBeGreaterThanOrEqual(undeclaredIds.length);
      expect(second.archivedUndeclaredCount).toBe(0);
      expect(
        await prisma.auditEvent.count({
          where: { projectId: { in: [...declaredIds, ...undeclaredIds.map(({ id }) => id)] } },
        }),
      ).toBe(trackedAuditCount);
      expect(
        await prisma.project.findUniqueOrThrow({ where: { id: declaredActiveId } }),
      ).toMatchObject({
        allowedCommands: desiredActive.allowed_commands,
        autonomyLevel: 2,
        repository,
        status: ProjectStatus.ACTIVE,
      });
      expect(
        await prisma.project.findUniqueOrThrow({ where: { id: declaredDraftId } }),
      ).toMatchObject({ status: ProjectStatus.DRAFT });
      for (const project of undeclaredIds) {
        expect((await prisma.project.findUniqueOrThrow({ where: { id: project.id } })).status).toBe(
          ProjectStatus.ARCHIVED,
        );
      }

      const board = await new DashboardService(prisma).projectsBoard();
      expect(board.projects.map(({ id }) => id)).toEqual(expect.arrayContaining([...declaredIds]));
      expect(board.projects.map(({ id }) => id)).not.toEqual(
        expect.arrayContaining(undeclaredIds.map(({ id }) => id)),
      );
      expect(await prisma.project.count()).toBe(beforeCounts.projects);
      expect(await prisma.task.count()).toBe(beforeCounts.tasks);
      expect(await prisma.task.findUnique({ where: { id: retainedTask.id } })).not.toBeNull();
      expect(await prisma.auditEvent.count()).toBeGreaterThanOrEqual(beforeCounts.audits);

      const taskCommands = new DashboardTaskCommandService(
        new TaskIntakeService({ taskStore: new PrismaTaskCoreStore(prisma) }),
        new PrismaDashboardCommandReceiptStore(prisma),
      );
      await expect(
        taskCommands.createDemand(
          {
            idempotencyKey: randomUUID(),
            objective: "Synthetic integration objective",
            projectId: undeclaredIds[1].id,
          },
          randomUUID(),
        ),
      ).rejects.toEqual(
        expect.objectContaining<Partial<DashboardTaskCommandError>>({
          code: "DASHBOARD_PROJECT_NOT_ELIGIBLE",
        }),
      );
      const audit = await prisma.auditEvent.findMany({
        where: { projectId: { in: undeclaredIds.map(({ id }) => id) } },
      });
      expect(JSON.stringify(audit)).not.toContain(repository);
      expect(JSON.stringify(audit)).not.toContain("SECRET_ARGUMENT");
      expect(JSON.stringify(audit)).not.toContain("SECRET_REPOSITORY_PATH");
      expect(
        audit.some(
          (event) =>
            event.action === "project.projection.archived_undeclared" &&
            JSON.stringify(event.payload).includes("absent_from_projects_yaml"),
        ),
      ).toBe(true);
    } finally {
      await Promise.all(
        existingProjection.map((project) =>
          prisma.project.updateMany({
            where: { id: project.id },
            data: { status: project.status },
          }),
        ),
      );
    }
  });

  it.each(["invalid", "missing"] as const)(
    "fails startup safely for %s YAML without changing an active projection",
    async (kind) => {
      const root = await mkdtemp(join(tmpdir(), "atlas-project-invalid-boot-"));
      directories.push(root);
      const configPath = join(root, "projects-sensitive-name.yaml");
      if (kind === "invalid") await writeFile(configPath, "projects: [SECRET_INVALID_YAML");
      const preservedProjects = [ProjectStatus.ACTIVE, ProjectStatus.DRAFT].map((status) => ({
        id: `project-${randomUUID()}`,
        status,
      }));
      for (const project of preservedProjects) {
        await prisma.project.create({
          data: {
            allowedCommands: [],
            autonomyLevel: 2,
            dataClassification: "internal",
            id: project.id,
            name: `Preserved ${project.status} Project`,
            policy: "least_privilege",
            protectedPathsProfile: "project_default",
            repository: null,
            requiredTools: {},
            retention: {},
            risk: "moderate",
            status: project.status,
          },
        });
      }
      const beforeAuditCount = await prisma.auditEvent.count({
        where: { projectId: { in: preservedProjects.map(({ id }) => id) } },
      });
      const failures: string[] = [];

      let failure: unknown;
      try {
        await reconcileProjectProjectionAtStartup(
          new ProjectProjectionReconciler(new ProjectConfigStore(configPath)),
          prisma,
          (code) => failures.push(code),
        );
      } catch (error: unknown) {
        failure = error;
      }

      expect(failure).toBeInstanceOf(ProjectProjectionReconciliationError);
      expect(failures).toEqual(["PROJECT_PROJECTION_RECONCILIATION_FAILED"]);
      for (const project of preservedProjects) {
        expect((await prisma.project.findUniqueOrThrow({ where: { id: project.id } })).status).toBe(
          project.status,
        );
      }
      expect(
        await prisma.auditEvent.count({
          where: { projectId: { in: preservedProjects.map(({ id }) => id) } },
        }),
      ).toBe(beforeAuditCount);
      expect(JSON.stringify({ failure, failures })).not.toContain(configPath);
      expect(JSON.stringify({ failure, failures })).not.toContain("SECRET_INVALID_YAML");
    },
  );
});
