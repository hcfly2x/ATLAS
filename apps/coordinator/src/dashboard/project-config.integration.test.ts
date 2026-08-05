import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PrismaClient, ProjectStatus } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { stringify } from "yaml";

import { TaskIdempotencyConflictError } from "@atlas/core";

import { ProjectConfigStore } from "../setup/project-config.js";
import { PrismaDashboardCommandReceiptStore } from "./command-receipt-store.js";
import { DashboardProjectConfigService } from "./project-config-service.js";

const prisma = new PrismaClient();
const directories: string[] = [];

beforeAll(async () => prisma.$connect());
afterAll(async () => {
  await prisma.$disconnect();
  await Promise.all(directories.map((path) => rm(path, { force: true, recursive: true })));
});

async function serviceFixture() {
  const root = await mkdtemp(join(tmpdir(), "atlas-project-management-integration-"));
  directories.push(root);
  const configPath = join(root, "projects.yaml");
  await writeFile(
    configPath,
    stringify({
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
      projects: [],
    }),
  );
  return {
    root,
    service: new DashboardProjectConfigService(
      new ProjectConfigStore(configPath),
      new PrismaDashboardCommandReceiptStore(prisma),
    ),
  };
}

describe("Dashboard project management with PostgreSQL", () => {
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
});
