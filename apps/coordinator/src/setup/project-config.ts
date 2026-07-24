import { lstat, readFile, rename, stat, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, resolve } from "node:path";

import { parse, stringify } from "yaml";
import { z } from "zod";

export const projectCommandSchema = z.object({
  executable: z.string().min(1).max(255),
  args: z.array(z.string().min(1).max(255)).max(32),
});

export const requiredToolsSchema = z.object({
  node: z.string().min(1).nullable(),
  git: z.string().min(1).nullable(),
  codex_cli: z.string().min(1).nullable(),
  gnu_tools: z.array(z.string().min(1)).max(32),
});

export const retentionSchema = z.object({
  logs_days: z.number().int().positive(),
  files_days: z.number().int().positive(),
  sensitive_days: z.number().int().positive().nullable(),
  audit_events_expire: z.literal(false),
});

export const projectDefaultsSchema = z.object({
  status: z.string(),
  policy: z.string(),
  autonomy_level: z.number().int().min(0).max(4),
  protected_paths_profile: z.string(),
  allowed_commands: z.array(z.union([z.string().min(1), projectCommandSchema])),
  required_tools: requiredToolsSchema,
  task_cost_limit_usd: z.number().nonnegative().nullable(),
  retention: retentionSchema,
});

export const storedProjectSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    name: z.string().min(1).max(120),
    status: z.enum(["draft", "active", "future", "archived"]).optional(),
    risk: z.enum(["low", "moderate", "high", "critical"]),
    data_classification: z.string().min(1),
    policy: z.string().min(1).optional(),
    autonomy_level: z.number().int().min(0).max(4).optional(),
    repository: z.string().nullable(),
    protected_paths_profile: z.string().min(1).optional(),
    allowed_commands: z.array(z.union([z.string().min(1), projectCommandSchema])).optional(),
    required_tools: requiredToolsSchema.optional(),
    task_cost_limit_usd: z.number().nonnegative().nullable().optional(),
    retention: retentionSchema.optional(),
  })
  .passthrough();

const projectConfigSchema = z
  .object({
    schema: z
      .object({
        defaults: projectDefaultsSchema,
      })
      .passthrough(),
    projects: z.array(storedProjectSchema),
  })
  .passthrough();

export const editableProjectSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name: z.string().min(1).max(120),
  status: z.enum(["draft", "active", "future", "archived"]),
  risk: z.enum(["low", "moderate", "high", "critical"]),
  data_classification: z.string().min(1),
  policy: z.string().min(1),
  autonomy_level: z.number().int().min(0).max(4),
  repository: z.string().nullable(),
  protected_paths_profile: z.string().min(1),
  allowed_commands: z.array(projectCommandSchema).max(32),
  required_tools: requiredToolsSchema,
  task_cost_limit_usd: z.number().nonnegative().nullable(),
  retention: retentionSchema,
});

export const repositorySuggestionRequestSchema = z.object({
  repository: z.string().min(1).max(4096),
});

export const repositorySuggestionSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name: z.string().min(1).max(120),
  command: projectCommandSchema.nullable(),
  source: z.enum(["package.json", "pyproject.toml", "Makefile"]).nullable(),
});

export type EditableProject = z.infer<typeof editableProjectSchema>;
export type RepositorySuggestion = z.infer<typeof repositorySuggestionSchema>;
type ProjectConfig = z.infer<typeof projectConfigSchema>;
type StoredProject = z.infer<typeof storedProjectSchema>;

function command(commandValue: z.infer<typeof projectCommandSchema> | string) {
  return typeof commandValue === "string"
    ? { executable: commandValue, args: [] as string[] }
    : commandValue;
}

function editable(config: ProjectConfig, project: StoredProject): EditableProject {
  const defaults = config.schema.defaults;
  return editableProjectSchema.parse({
    id: project.id,
    name: project.name,
    status: project.status ?? defaults.status,
    risk: project.risk,
    data_classification: project.data_classification,
    policy: project.policy ?? defaults.policy,
    autonomy_level: project.autonomy_level ?? defaults.autonomy_level,
    repository: project.repository,
    protected_paths_profile: project.protected_paths_profile ?? defaults.protected_paths_profile,
    allowed_commands: (project.allowed_commands ?? defaults.allowed_commands).map(command),
    required_tools: project.required_tools ?? defaults.required_tools,
    task_cost_limit_usd: project.task_cost_limit_usd ?? defaults.task_cost_limit_usd,
    retention: project.retention ?? defaults.retention,
  });
}

function sensitiveClassification(value: string): boolean {
  return value.includes("sensitive") || value === "personal_financial";
}

function projectIdFromDirectory(name: string): string {
  const normalized = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized.length > 0 ? normalized : "project";
}

async function validGitRepository(repositoryPath: string): Promise<boolean> {
  if (!isAbsolute(repositoryPath)) return false;
  try {
    const repository = await stat(repositoryPath);
    const gitMetadata = await stat(join(repositoryPath, ".git"));
    return repository.isDirectory() && (gitMetadata.isDirectory() || gitMetadata.isFile());
  } catch {
    return false;
  }
}

async function optionalFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

async function detectCommand(
  repositoryPath: string,
): Promise<Pick<RepositorySuggestion, "command" | "source">> {
  const packageJson = await optionalFile(join(repositoryPath, "package.json"));
  if (packageJson !== undefined) {
    try {
      const parsed = z
        .object({
          packageManager: z.string().optional(),
          scripts: z.record(z.string(), z.string()).optional(),
        })
        .passthrough()
        .safeParse(JSON.parse(packageJson) as unknown);
      if (parsed.success && parsed.data.scripts?.test !== undefined) {
        const packageManager = parsed.data.packageManager?.split("@")[0];
        const executable =
          packageManager === "pnpm" ||
          packageManager === "yarn" ||
          packageManager === "bun" ||
          packageManager === "npm"
            ? packageManager
            : "npm";
        return { command: { executable, args: ["test"] }, source: "package.json" };
      }
    } catch {
      // A malformed package.json does not prevent suggestions from the other supported files.
    }
  }

  if ((await optionalFile(join(repositoryPath, "pyproject.toml"))) !== undefined) {
    return {
      command: { executable: "python", args: ["-m", "pytest"] },
      source: "pyproject.toml",
    };
  }

  const makefile = await optionalFile(join(repositoryPath, "Makefile"));
  if (makefile !== undefined && /^test\s*:/m.test(makefile)) {
    return { command: { executable: "make", args: ["test"] }, source: "Makefile" };
  }

  return { command: null, source: null };
}

export class ProjectConfigConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectConfigConflictError";
  }
}

export class ProjectConfigValidationError extends Error {
  constructor(readonly issues: readonly string[]) {
    super("Project configuration is not ready for activation");
    this.name = "ProjectConfigValidationError";
  }
}

export class ProjectConfigStore {
  private readonly configPath: string;

  constructor(configPath: string) {
    this.configPath = resolve(configPath);
  }

  async list(): Promise<EditableProject[]> {
    const config = await this.read();
    return config.projects.map((project) => editable(config, project));
  }

  async suggest(repository: string): Promise<RepositorySuggestion> {
    const repositoryPath = repository.trim();
    if (!(await validGitRepository(repositoryPath))) {
      throw new ProjectConfigValidationError([
        "O repositório informado precisa existir, usar caminho absoluto e conter .git.",
      ]);
    }
    const directoryName = basename(repositoryPath);
    return repositorySuggestionSchema.parse({
      id: projectIdFromDirectory(directoryName),
      name: directoryName,
      ...(await detectCommand(repositoryPath)),
    });
  }

  async save(input: EditableProject): Promise<EditableProject> {
    const project = editableProjectSchema.parse(input);
    const issues = await this.activationIssues(project);
    if (project.status === "active" && issues.length > 0) {
      throw new ProjectConfigValidationError(issues);
    }
    const file = await lstat(this.configPath);
    if (file.isSymbolicLink() || !file.isFile()) {
      throw new ProjectConfigConflictError("projects.yaml must be a regular file");
    }
    const config = await this.read();
    const duplicateName = config.projects.find(
      (candidate) =>
        candidate.id !== project.id &&
        candidate.name.toLocaleLowerCase() === project.name.toLocaleLowerCase(),
    );
    if (duplicateName !== undefined) {
      throw new ProjectConfigConflictError("another project already uses this name");
    }
    const existingIndex = config.projects.findIndex((candidate) => candidate.id === project.id);
    const existing = existingIndex === -1 ? {} : config.projects[existingIndex];
    const stored = storedProjectSchema.parse({ ...existing, ...project });
    if (existingIndex === -1) {
      config.projects.push(stored);
    } else {
      config.projects[existingIndex] = stored;
    }
    const serialized = stringify(config, { lineWidth: 100 });
    projectConfigSchema.parse(parse(serialized));
    const temporaryPath = `${this.configPath}.tmp-${process.pid.toString()}`;
    await writeFile(temporaryPath, serialized, { encoding: "utf8", mode: file.mode });
    await rename(temporaryPath, this.configPath);
    return editable(config, stored);
  }

  async validate(input: EditableProject): Promise<{ issues: string[]; valid: boolean }> {
    const project = editableProjectSchema.parse(input);
    const issues = await this.activationIssues(project);
    return { issues, valid: issues.length === 0 };
  }

  private async activationIssues(project: EditableProject): Promise<string[]> {
    const issues: string[] = [];
    if (project.autonomy_level === 4) issues.push("Nível 4 não está habilitado no MVP.");
    if (project.repository === null || project.repository.trim().length === 0) {
      issues.push("Informe o caminho absoluto do repositório.");
    } else if (!isAbsolute(project.repository)) {
      issues.push("O caminho do repositório precisa ser absoluto.");
    } else if (!(await validGitRepository(project.repository))) {
      issues.push("O repositório informado não existe ou não contém .git.");
    }
    if (project.allowed_commands.length === 0) {
      issues.push("Adicione ao menos um comando de teste permitido.");
    }
    if (
      sensitiveClassification(project.data_classification) &&
      project.retention.sensitive_days === null
    ) {
      issues.push("Dados sensíveis exigem prazo de retenção específico.");
    }
    return issues;
  }

  private async read(): Promise<ProjectConfig> {
    return projectConfigSchema.parse(parse(await readFile(this.configPath, "utf8")));
  }
}

export { projectConfigSchema };
