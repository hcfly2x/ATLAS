import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";

import {
  ProjectConfigStore,
  ProjectConfigValidationError,
  type EditableProject,
} from "./project-config.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

function config(projects: object[] = []) {
  return {
    schema: {
      marker: "preserved",
      defaults: {
        status: "draft",
        policy: "least_privilege",
        autonomy_level: 2,
        protected_paths_profile: "project_default",
        allowed_commands: [],
        required_tools: { node: null, git: null, codex_cli: null, gnu_tools: [] },
        task_cost_limit_usd: 2,
        retention: {
          logs_days: 30,
          files_days: 30,
          sensitive_days: 7,
          audit_events_expire: false,
        },
      },
    },
    projects,
  };
}

async function fixture(projects: object[] = []) {
  const root = await mkdtemp(join(tmpdir(), "atlas-project-config-"));
  directories.push(root);
  const path = join(root, "projects.yaml");
  await writeFile(path, stringify(config(projects)));
  return { path, root, store: new ProjectConfigStore(path) };
}

function validProject(repository: string): EditableProject {
  return {
    id: "pilot-project",
    name: "Pilot Project",
    status: "active",
    risk: "moderate",
    data_classification: "internal",
    policy: "least_privilege",
    autonomy_level: 2,
    repository,
    protected_paths_profile: "project_default",
    allowed_commands: [{ executable: "pnpm", args: ["test"] }],
    runtime: null,
    required_tools: {
      node: null,
      git: null,
      codex_cli: null,
      gnu_tools: [],
    },
    task_cost_limit_usd: 2,
    retention: {
      logs_days: 30,
      files_days: 30,
      sensitive_days: null,
      audit_events_expire: false,
    },
  };
}

describe("ProjectConfigStore", () => {
  it("resolves defaults without mutating the source file", async () => {
    const { path, store } = await fixture([
      {
        id: "draft-project",
        name: "Draft Project",
        risk: "low",
        data_classification: "internal",
        repository: null,
      },
    ]);
    const before = await readFile(path, "utf8");

    expect(await store.list()).toEqual([
      expect.objectContaining({
        autonomy_level: 2,
        id: "draft-project",
        policy: "least_privilege",
        status: "draft",
      }),
    ]);
    expect(await readFile(path, "utf8")).toBe(before);
  });

  it("refuses active status until all activation requirements pass", async () => {
    const { store } = await fixture();
    const project = validProject("/does/not/exist");

    await expect(store.save(project)).rejects.toBeInstanceOf(ProjectConfigValidationError);
    expect(await store.validate(project)).toEqual({
      issues: ["O repositório informado não existe ou não contém .git."],
      valid: false,
    });
  });

  it("activates without minimum tool versions and suggests name/test from package.json", async () => {
    const { root, store } = await fixture();
    const repository = join(root, "sample-app");
    await mkdir(join(repository, ".git"), { recursive: true });
    await writeFile(
      join(repository, "package.json"),
      JSON.stringify({ packageManager: "pnpm@11.9.0", scripts: { test: "vitest run" } }),
    );

    const project = validProject(repository);
    expect(await store.validate(project)).toEqual({ issues: [], valid: true });
    expect(await store.suggest(repository)).toEqual({
      command: { executable: "pnpm", args: ["test"] },
      id: "sample-app",
      name: "sample-app",
      source: "package.json",
    });
  });

  it("suggests safe commands from pyproject.toml and Makefile without executing them", async () => {
    const { root, store } = await fixture();
    const pythonRepository = join(root, "python-app");
    const makeRepository = join(root, "make-app");
    await mkdir(join(pythonRepository, ".git"), { recursive: true });
    await mkdir(join(makeRepository, ".git"), { recursive: true });
    await writeFile(join(pythonRepository, "pyproject.toml"), "[project]\nname='example'\n");
    await writeFile(join(makeRepository, "Makefile"), "test:\n\t@echo never-executed\n");

    await expect(store.suggest(pythonRepository)).resolves.toMatchObject({
      command: { executable: "python", args: ["-m", "pytest"] },
      source: "pyproject.toml",
    });
    await expect(store.suggest(makeRepository)).resolves.toMatchObject({
      command: { executable: "make", args: ["test"] },
      source: "Makefile",
    });
  });

  it("saves a validated project atomically while preserving unrelated configuration", async () => {
    const { path, root, store } = await fixture([
      {
        id: "pilot-project",
        name: "Old Name",
        risk: "moderate",
        data_classification: "internal",
        repository: null,
        integrations: ["preserve-me"],
      },
    ]);
    const repository = join(root, "repository");
    await mkdir(join(repository, ".git"), { recursive: true });

    const saved = await store.save(validProject(repository));
    const persisted = parse(await readFile(path, "utf8")) as {
      schema: { marker: string };
      projects: { integrations?: string[]; allowed_commands?: object[] }[];
    };

    expect(saved.status).toBe("active");
    expect(persisted.schema.marker).toBe("preserved");
    expect(persisted.projects[0]?.integrations).toEqual(["preserve-me"]);
    expect(persisted.projects[0]?.allowed_commands).toEqual([
      { executable: "pnpm", args: ["test"] },
    ]);
  });

  it("preserves a declared runtime that the pilot wizard does not edit", async () => {
    const { root, store } = await fixture([
      {
        id: "pilot-project",
        name: "Pilot Project",
        risk: "moderate",
        data_classification: "internal",
        repository: null,
        runtime: {
          package_manager: "pnpm",
          bootstrap: [{ executable: "pnpm", args: ["install", "--frozen-lockfile"] }],
          validate: [{ executable: "pnpm", args: ["validate"] }],
          allowed_commands: [
            { executable: "pnpm", args: ["install", "--frozen-lockfile"] },
            { executable: "pnpm", args: ["validate"] },
          ],
          forbidden_commands: [{ executable: "rm", args: [] }],
          timeout_minutes: 10,
        },
      },
    ]);
    const repository = join(root, "repository");
    await mkdir(join(repository, ".git"), { recursive: true });

    const project = validProject(repository);
    project.runtime = null;
    expect((await store.save(project)).runtime).toMatchObject({ package_manager: "pnpm" });
  });
});
