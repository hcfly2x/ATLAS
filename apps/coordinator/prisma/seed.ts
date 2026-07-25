import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { PrismaClient, ProjectStatus } from "@prisma/client";
import { parse } from "yaml";

import { projectConfigSchema } from "../src/setup/project-config.js";

const statusMap: Record<string, ProjectStatus> = {
  active: ProjectStatus.ACTIVE,
  archived: ProjectStatus.ARCHIVED,
  draft: ProjectStatus.DRAFT,
  future: ProjectStatus.FUTURE,
};

function projectStatus(value: string): ProjectStatus {
  const status = statusMap[value];
  if (status === undefined) {
    throw new Error(`Unsupported project status: ${value}`);
  }
  return status;
}

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const configPath = fileURLToPath(new URL("../../../.atlas/projects.yaml", import.meta.url));
  const config = projectConfigSchema.parse(parse(await readFile(configPath, "utf8")));

  for (const project of config.projects) {
    const data = {
      allowedCommands: project.allowed_commands ?? config.schema.defaults.allowed_commands,
      ...(project.runtime === undefined || project.runtime === null
        ? {}
        : { runtime: project.runtime }),
      autonomyLevel: project.autonomy_level ?? config.schema.defaults.autonomy_level,
      dataClassification: project.data_classification,
      name: project.name,
      policy: project.policy ?? config.schema.defaults.policy,
      protectedPathsProfile:
        project.protected_paths_profile ?? config.schema.defaults.protected_paths_profile,
      repository: project.repository,
      requiredTools: project.required_tools ?? config.schema.defaults.required_tools,
      retention: project.retention ?? config.schema.defaults.retention,
      risk: project.risk,
      status: projectStatus(project.status ?? config.schema.defaults.status),
      taskCostLimitUsd: project.task_cost_limit_usd ?? config.schema.defaults.task_cost_limit_usd,
    };

    await prisma.project.upsert({
      where: { id: project.id },
      create: { id: project.id, ...data },
      update: data,
    });
  }
}

await main()
  .finally(async () => prisma.$disconnect())
  .catch((error: unknown) => {
    process.stderr.write(
      `${JSON.stringify({
        level: "error",
        message: "project seed failed",
        error: error instanceof Error ? error.message : "unknown error",
      })}\n`,
    );
    process.exitCode = 1;
  });
