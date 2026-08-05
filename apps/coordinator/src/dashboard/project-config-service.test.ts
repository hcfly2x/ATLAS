import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Prisma } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stringify } from "yaml";

import { ProjectConfigStore } from "../setup/project-config.js";
import type {
  DashboardCommandOperationResult,
  DashboardCommandReceiptClaim,
  DashboardCommandReceiptResult,
  DashboardCommandReceiptStore,
  DashboardCommandTaskStore,
} from "./command-receipt-store.js";
import {
  DashboardProjectConfigService,
  type DashboardProjectConfigError,
} from "./project-config-service.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

async function harness() {
  const root = await mkdtemp(join(tmpdir(), "atlas-dashboard-project-"));
  directories.push(root);
  const path = join(root, "projects.yaml");
  await writeFile(
    path,
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
  const upsert = vi.fn().mockResolvedValue(undefined);
  const audit = vi.fn().mockResolvedValue(undefined);
  const transaction = {
    auditEvent: { create: audit },
    project: { upsert },
  } as unknown as Prisma.TransactionClient;
  class FakeReceiptStore implements DashboardCommandReceiptStore {
    async execute<Result>(
      input: DashboardCommandReceiptClaim,
      operation: (
        taskStore: DashboardCommandTaskStore,
      ) => Promise<DashboardCommandOperationResult<Result>>,
    ): Promise<DashboardCommandReceiptResult<Result>> {
      void input;
      void operation;
      return await Promise.reject(new Error("task command is outside this test"));
    }

    async executeProject<Result>(
      _input: DashboardCommandReceiptClaim,
      operation: (
        transaction: Prisma.TransactionClient,
      ) => Promise<DashboardCommandOperationResult<Result>>,
    ): Promise<DashboardCommandReceiptResult<Result>> {
      const result = await operation(transaction);
      return { ...result, idempotentReplay: false };
    }
  }
  const receipts = new FakeReceiptStore();
  return {
    audit,
    service: new DashboardProjectConfigService(new ProjectConfigStore(path), receipts),
    upsert,
  };
}

describe("DashboardProjectConfigService", () => {
  it("creates an audited safe draft without exposing a repository or command arguments", async () => {
    const { audit, service, upsert } = await harness();

    const result = await service.create(
      {
        confirmed: true,
        id: "new-project",
        idempotencyKey: "10000000-0000-4000-8000-000000000001",
        name: "New Project",
      },
      "correlation-1",
    );

    expect(result.project).toMatchObject({
      allowedExecutables: [],
      autonomyLevel: 2,
      repositoryConfigured: false,
      status: "draft",
    });
    expect(upsert).toHaveBeenCalledOnce();
    expect(audit).toHaveBeenCalledOnce();
    expect(JSON.stringify({ result, audit: audit.mock.calls })).not.toContain("repository:");
  });

  it("binds activation rejection when required fields are absent", async () => {
    const { service } = await harness();
    const created = await service.create(
      {
        confirmed: true,
        id: "new-project",
        idempotencyKey: "10000000-0000-4000-8000-000000000001",
        name: "New Project",
      },
      "correlation-1",
    );

    await expect(
      service.activate(
        "new-project",
        {
          configHash: created.project.configHash,
          confirmed: true,
          idempotencyKey: "10000000-0000-4000-8000-000000000002",
        },
        "correlation-2",
      ),
    ).rejects.toEqual(
      expect.objectContaining<Partial<DashboardProjectConfigError>>({
        code: "DASHBOARD_PROJECT_CONFIG_INVALID",
      }),
    );
  });
});
