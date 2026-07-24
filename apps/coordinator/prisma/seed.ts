import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { PrismaClient, ProjectStatus } from "@prisma/client";
import { parse } from "yaml";
import { z } from "zod";

const requiredToolsSchema = z.object({
  node: z.string().nullable(),
  git: z.string().nullable(),
  codex_cli: z.string().nullable(),
  gnu_tools: z.array(z.string()),
});

const retentionSchema = z.object({
  logs_days: z.number().int().positive(),
  files_days: z.number().int().positive(),
  sensitive_days: z.number().int().positive().nullable(),
  audit_events_expire: z.literal(false),
});

const projectDefaultsSchema = z.object({
  status: z.string(),
  policy: z.string(),
  protected_paths_profile: z.string(),
  allowed_commands: z.array(z.string()),
  required_tools: requiredToolsSchema,
  task_cost_limit_usd: z.number().nonnegative().nullable(),
  retention: retentionSchema,
});

const projectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  status: z.string().optional(),
  risk: z.string().min(1),
  data_classification: z.string().min(1),
  policy: z.string().optional(),
  repository: z.string().nullable(),
  protected_paths_profile: z.string().optional(),
  allowed_commands: z.array(z.string()).optional(),
  required_tools: requiredToolsSchema.optional(),
  task_cost_limit_usd: z.number().nonnegative().nullable().optional(),
  retention: retentionSchema.optional(),
});

const configSchema = z.object({
  schema: z.object({
    defaults: projectDefaultsSchema,
  }),
  projects: z.array(projectSchema),
});

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
  const config = configSchema.parse(parse(await readFile(configPath, "utf8")));

  for (const project of config.projects) {
    const data = {
      allowedCommands: project.allowed_commands ?? config.schema.defaults.allowed_commands,
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
