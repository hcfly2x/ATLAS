import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { stringify } from "yaml";
import { z } from "zod";

import { createSetupApp } from "./app.js";
import { editableProjectSchema, ProjectConfigStore } from "./project-config.js";

const directories: string[] = [];
const apps: ReturnType<typeof createSetupApp>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

async function appFixture() {
  const root = await mkdtemp(join(tmpdir(), "atlas-setup-routes-"));
  directories.push(root);
  const path = join(root, "projects.yaml");
  await writeFile(
    path,
    stringify({
      schema: {
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
      projects: [
        {
          id: "atlas",
          name: "ATLAS",
          risk: "critical",
          data_classification: "internal_sensitive",
          repository: null,
        },
      ],
    }),
  );
  const app = createSetupApp(new ProjectConfigStore(path), { logger: false });
  apps.push(app);
  return { app, root };
}

describe("Pilot Setup Wizard routes", () => {
  it("serves the local setup page with restrictive browser headers", async () => {
    const { app } = await appFixture();
    const response = await app.inject({ method: "GET", url: "/setup" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(response.body).toContain("Configuração do piloto");
    expect(response.body).toContain("Este assistente configura projetos, não agentes.");
    expect(response.body).toContain("<summary>Opções avançadas</summary>");
  });

  it("lists projects but refuses writes without the setup confirmation header", async () => {
    const { app } = await appFixture();
    const listed = await app.inject({ method: "GET", url: "/setup/api/projects" });
    const listedProjects = editableProjectSchema.array().parse(listed.json());
    const listedProject = editableProjectSchema.parse(listedProjects[0]);
    const refused = await app.inject({
      method: "POST",
      url: "/setup/api/projects/validate",
      payload: listedProject,
    });
    const refusedBody = z.object({ code: z.string() }).parse(JSON.parse(refused.body) as unknown);

    expect(listed.statusCode).toBe(200);
    expect(listedProjects).toEqual([expect.objectContaining({ id: "atlas", status: "draft" })]);
    expect(refused.statusCode).toBe(403);
    expect(refusedBody).toMatchObject({ code: "SETUP_WRITE_HEADER_REQUIRED" });
  });

  it("is unavailable to non-loopback clients", async () => {
    const { app } = await appFixture();
    const response = await app.inject({
      method: "GET",
      url: "/setup",
      remoteAddress: "192.0.2.10",
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: "SETUP_LOCAL_ONLY" });
  });

  it("autodetects an editable project suggestion behind the write-intent header", async () => {
    const { app, root } = await appFixture();
    const repository = join(root, "detected-project");
    await mkdir(join(repository, ".git"), { recursive: true });
    await writeFile(
      join(repository, "package.json"),
      JSON.stringify({ scripts: { test: "node --test" } }),
    );

    const response = await app.inject({
      method: "POST",
      url: "/setup/api/projects/detect",
      headers: { "x-atlas-setup": "1" },
      payload: { repository },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      command: { executable: "npm", args: ["test"] },
      id: "detected-project",
      name: "detected-project",
      source: "package.json",
    });
  });
});
