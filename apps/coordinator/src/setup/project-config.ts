import { lstat, readFile, rename, stat, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, resolve } from "node:path";

import { parse, stringify } from "yaml";
import { z } from "zod";

import { canonicalPayloadHash, workerRuntimeSchema } from "@atlas/shared";

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
    runtime: workerRuntimeSchema.nullable().optional(),
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
  // The pilot wizard does not edit runtime yet. Keep it optional on writes so
  // existing manifests retain their declared runtime instead of requiring it.
  runtime: workerRuntimeSchema.nullable().optional(),
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
export interface ProjectConfigMutation {
  readonly before: EditableProject | null;
  readonly changed: boolean;
  readonly project: EditableProject;
}
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
    runtime: project.runtime ?? null,
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

export class ProjectConfigNotFoundError extends Error {
  constructor() {
    super("project configuration was not found");
    this.name = "ProjectConfigNotFoundError";
  }
}

export class ProjectConfigVersionConflictError extends Error {
  constructor() {
    super("project configuration changed");
    this.name = "ProjectConfigVersionConflictError";
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
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(configPath: string) {
    this.configPath = resolve(configPath);
  }

  async list(): Promise<EditableProject[]> {
    const config = await this.read();
    return config.projects.map((project) => editable(config, project));
  }

  async get(projectId: string): Promise<EditableProject | undefined> {
    const config = await this.read();
    const project = config.projects.find((candidate) => candidate.id === projectId);
    return project === undefined ? undefined : editable(config, project);
  }

  configHash(project: EditableProject): string {
    return canonicalPayloadHash(editableProjectSchema.parse(project));
  }

  async createDraft(input: {
    readonly id: string;
    readonly name: string;
  }): Promise<ProjectConfigMutation> {
    const identity = z
      .object({
        id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
        name: z.string().trim().min(1).max(120),
      })
      .strict()
      .parse(input);
    return this.mutate((config) => {
      const defaults = config.schema.defaults;
      const desired = editableProjectSchema.parse({
        id: identity.id,
        name: identity.name,
        status: "draft",
        risk: "critical",
        data_classification: "internal_sensitive",
        policy: "least_privilege",
        autonomy_level: 2,
        repository: null,
        protected_paths_profile: defaults.protected_paths_profile,
        allowed_commands: [],
        runtime: null,
        required_tools: defaults.required_tools,
        task_cost_limit_usd: defaults.task_cost_limit_usd,
        retention: defaults.retention,
      });
      const existing = config.projects.find((candidate) => candidate.id === identity.id);
      if (existing !== undefined) {
        const current = editable(config, existing);
        if (this.configHash(current) === this.configHash(desired)) {
          return { before: current, changed: false, project: current };
        }
        throw new ProjectConfigConflictError("project id already exists");
      }
      this.assertNameAvailable(config, identity.id, identity.name);
      config.projects.push(storedProjectSchema.parse(desired));
      return { before: null, changed: true, project: desired };
    });
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
    return (
      await this.mutate((config) => {
        this.assertNameAvailable(config, project.id, project.name);
        const existingIndex = config.projects.findIndex((candidate) => candidate.id === project.id);
        const existing = existingIndex === -1 ? undefined : config.projects[existingIndex];
        // Runtime is intentionally not exposed by the pilot wizard. Preserve a
        // manifest already declared outside that UI instead of silently clearing it.
        const runtime = project.runtime ?? existing?.runtime;
        const stored = storedProjectSchema.parse({
          ...(existing ?? {}),
          ...project,
          ...(runtime === undefined || runtime === null ? {} : { runtime }),
        });
        if (existingIndex === -1) config.projects.push(stored);
        else config.projects[existingIndex] = stored;
        return {
          before: existing === undefined ? null : editable(config, existing),
          changed:
            existing === undefined ||
            this.configHash(editable(config, existing)) !== this.configHash(project),
          project: editable(config, stored),
        };
      })
    ).project;
  }

  async put(input: EditableProject, expectedConfigHash: string): Promise<ProjectConfigMutation> {
    const desired = editableProjectSchema.parse(input);
    if (desired.repository !== null && !(await validGitRepository(desired.repository))) {
      throw new ProjectConfigValidationError([
        "O repositório informado precisa existir, usar caminho absoluto e conter .git.",
      ]);
    }
    return this.mutate((config) => {
      const index = config.projects.findIndex((candidate) => candidate.id === desired.id);
      if (index === -1) throw new ProjectConfigNotFoundError();
      const existing = config.projects[index];
      if (existing === undefined) throw new ProjectConfigNotFoundError();
      const before = editable(config, existing);
      const currentHash = this.configHash(before);
      const desiredHash = this.configHash(desired);
      if (currentHash !== expectedConfigHash && currentHash !== desiredHash) {
        throw new ProjectConfigVersionConflictError();
      }
      this.assertNameAvailable(config, desired.id, desired.name);
      const runtime = desired.runtime ?? existing.runtime;
      const stored = storedProjectSchema.parse({
        ...existing,
        ...desired,
        status: before.status,
        ...(runtime === undefined || runtime === null ? {} : { runtime }),
      });
      config.projects[index] = stored;
      return {
        before,
        changed: currentHash !== this.configHash(editable(config, stored)),
        project: editable(config, stored),
      };
    });
  }

  async activate(projectId: string, expectedConfigHash: string): Promise<ProjectConfigMutation> {
    return this.changeStatus(projectId, expectedConfigHash, "active");
  }

  async deactivate(projectId: string, expectedConfigHash: string): Promise<ProjectConfigMutation> {
    return this.changeStatus(projectId, expectedConfigHash, "draft");
  }

  async validate(input: EditableProject): Promise<{ issues: string[]; valid: boolean }> {
    const project = editableProjectSchema.parse(input);
    const issues = await this.activationIssues(project);
    return { issues, valid: issues.length === 0 };
  }

  async activationIssues(project: EditableProject): Promise<string[]> {
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

  private async changeStatus(
    projectId: string,
    expectedConfigHash: string,
    status: "active" | "draft",
  ): Promise<ProjectConfigMutation> {
    return this.mutate(async (config) => {
      const index = config.projects.findIndex((candidate) => candidate.id === projectId);
      if (index === -1) throw new ProjectConfigNotFoundError();
      const existing = config.projects[index];
      if (existing === undefined) throw new ProjectConfigNotFoundError();
      const before = editable(config, existing);
      const desired = editableProjectSchema.parse({ ...before, status });
      const currentHash = this.configHash(before);
      const desiredHash = this.configHash(desired);
      if (currentHash !== expectedConfigHash) {
        const retrySource = editableProjectSchema.parse({
          ...before,
          status: status === "active" ? "draft" : "active",
        });
        if (before.status !== status || this.configHash(retrySource) !== expectedConfigHash) {
          throw new ProjectConfigVersionConflictError();
        }
      }
      if (status === "active") {
        const issues = await this.activationIssues(desired);
        if (issues.length > 0) throw new ProjectConfigValidationError(issues);
      }
      config.projects[index] = storedProjectSchema.parse({ ...existing, status });
      return { before, changed: currentHash !== desiredHash, project: desired };
    });
  }

  private assertNameAvailable(config: ProjectConfig, projectId: string, name: string): void {
    const duplicateName = config.projects.find(
      (candidate) =>
        candidate.id !== projectId &&
        candidate.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
    );
    if (duplicateName !== undefined) {
      throw new ProjectConfigConflictError("another project already uses this name");
    }
  }

  private async mutate(
    operation: (config: ProjectConfig) => ProjectConfigMutation | Promise<ProjectConfigMutation>,
  ): Promise<ProjectConfigMutation> {
    let release!: () => void;
    const previous = this.mutationQueue;
    this.mutationQueue = new Promise<void>((resolveQueue) => {
      release = resolveQueue;
    });
    await previous;
    try {
      const file = await lstat(this.configPath);
      if (file.isSymbolicLink() || !file.isFile()) {
        throw new ProjectConfigConflictError("projects.yaml must be a regular file");
      }
      const config = await this.read();
      const result = await operation(config);
      if (!result.changed) return result;
      const serialized = stringify(config, { lineWidth: 100 });
      projectConfigSchema.parse(parse(serialized));
      const temporaryPath = `${this.configPath}.tmp-${process.pid.toString()}`;
      await writeFile(temporaryPath, serialized, { encoding: "utf8", mode: file.mode });
      await rename(temporaryPath, this.configPath);
      return result;
    } finally {
      release();
    }
  }
}

export { projectConfigSchema };
