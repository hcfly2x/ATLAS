import { createHash } from "node:crypto";

import { z } from "zod";

export const WORKER_RESULT_CONTRACT_VERSION = "1.0" as const;

export const correlationIdSchema = z.string().min(1).max(128);
export type CorrelationId = z.infer<typeof correlationIdSchema>;

export const serviceNameSchema = z.enum(["coordinator", "worker"]);
export type ServiceName = z.infer<typeof serviceNameSchema>;

export const taskStateSchema = z.enum([
  "NEW",
  "NORMALIZING",
  "ROUTING",
  "SPECIFYING",
  "WAITING_APPROVAL",
  "QUEUED",
  "RUNNING",
  "TESTING",
  "WAITING_RESULT_APPROVAL",
  "FINALIZING",
  "CANCEL_REQUESTED",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
]);
export type TaskState = z.infer<typeof taskStateSchema>;

export const auditActorSchema = z.enum(["user", "agent", "worker", "system"]);
export type AuditActor = z.infer<typeof auditActorSchema>;

export const taskComplexitySchema = z.enum(["simple", "moderate", "critical"]);
export type TaskComplexity = z.infer<typeof taskComplexitySchema>;

export const memoryTypeSchema = z.enum(["decision", "summary", "note"]);
export type MemoryType = z.infer<typeof memoryTypeSchema>;

export const memoryItemSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().min(1).max(128),
  type: memoryTypeSchema,
  content: z.string().min(1).max(8_000),
  taskId: z.string().uuid().optional(),
  agentId: z.string().min(1).max(128).optional(),
  createdAt: z.string().datetime({ offset: true }),
});
export type MemoryItem = z.infer<typeof memoryItemSchema>;

export const createMemoryItemSchema = z
  .object({
    type: memoryTypeSchema,
    content: z.string().trim().min(1).max(8_000),
    taskId: z.string().uuid().optional(),
    agentId: z.string().min(1).max(128).optional(),
    idempotencyKey: z.string().min(1).max(255),
  })
  .superRefine((value, context) => {
    if (value.type === "summary" && value.taskId === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Task summaries require taskId",
        path: ["taskId"],
      });
    }
  });
export type CreateMemoryItem = z.infer<typeof createMemoryItemSchema>;

export const normalizedDemandSchema = z.object({
  objective: z.string().min(1),
  context: z.array(z.string()),
  constraints: z.array(z.string()),
  requested_actions: z.array(z.string()),
});
export type NormalizedDemand = z.infer<typeof normalizedDemandSchema>;

export const complexityClassificationSchema = z.object({
  complexity: taskComplexitySchema,
  reasons: z.array(z.string()).min(1),
});
export type ComplexityClassification = z.infer<typeof complexityClassificationSchema>;

export const specialistOpinionSchema = z.object({
  understanding: z.string().min(1),
  findings: z.array(z.string()),
  recommendation: z.string().min(1),
  risks: z.array(z.string()),
  acceptance_criteria: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  unresolved_questions: z.array(z.string()),
});
export type SpecialistOpinion = z.infer<typeof specialistOpinionSchema>;

export const postExecutionReviewSchema = z.object({
  confidence: z.number().min(0).max(1),
  decision: z.enum(["approved", "rejected"]),
  findings: z.array(z.string()),
  required_actions: z.array(z.string()),
  risks: z.array(z.string()),
  summary: z.string().min(1),
});
export type PostExecutionReview = z.infer<typeof postExecutionReviewSchema>;

export const materialDivergenceSchema = z.object({
  topic: z.string().min(1),
  agent_ids: z.array(z.string().min(1)).min(2),
  description: z.string().min(1),
});
export type MaterialDivergence = z.infer<typeof materialDivergenceSchema>;

export const divergenceAnalysisSchema = z.object({
  material_divergences: z.array(materialDivergenceSchema),
  revision_requests: z.array(
    z.object({
      agent_id: z.string().min(1),
      focus: z.string().min(1),
    }),
  ),
});
export type DivergenceAnalysis = z.infer<typeof divergenceAnalysisSchema>;

export const specificationDeliveryModeSchema = z.enum(["answer_only", "repository_change"]);
export type SpecificationDeliveryMode = z.infer<typeof specificationDeliveryModeSchema>;

export const specificationContentSchema = z.object({
  objective: z.string().min(1),
  context: z.array(z.string()),
  delivery_mode: specificationDeliveryModeSchema,
  authorized_scope: z.array(z.string()),
  out_of_scope: z.array(z.string()),
  implementation_strategy: z.array(z.string()),
  constraints: z.array(z.string()),
  acceptance_criteria: z.array(z.string()).min(1),
  required_tests: z.array(z.string()).min(1),
  allowed_commands: z.array(z.string()),
  approval_required_for: z.array(z.string()),
  expected_delivery: z.string().min(1),
});
export type SpecificationContent = z.infer<typeof specificationContentSchema>;

export const executableSpecificationPayloadSchema = specificationContentSchema.extend({
  delivery_mode: specificationDeliveryModeSchema.catch("repository_change"),
  task_id: z.string().uuid(),
  project_id: z.string().min(1),
  version: z.number().int().positive(),
  risk_level: taskComplexitySchema,
});
export type ExecutableSpecificationPayload = z.infer<typeof executableSpecificationPayloadSchema>;

export const taskTransitionCommandSchema = z.object({
  actor: auditActorSchema,
  correlationId: correlationIdSchema,
  expectedVersion: z.number().int().nonnegative(),
  failureStage: z.string().min(1).max(128).optional(),
  idempotencyKey: z.string().min(1).max(255),
  toState: taskStateSchema,
});
export type TaskTransitionCommandPayload = z.infer<typeof taskTransitionCommandSchema>;

export interface LogContext {
  readonly correlationId: CorrelationId;
  readonly service: ServiceName;
}

export interface StructuredLog {
  readonly context: LogContext;
  readonly level: "debug" | "info" | "warn" | "error";
  readonly message: string;
  readonly timestamp: string;
}

export function createStructuredLog(
  context: LogContext,
  level: StructuredLog["level"],
  message: string,
  now: Date = new Date(),
): StructuredLog {
  return {
    context,
    level,
    message,
    timestamp: now.toISOString(),
  };
}

function compareUnicodeCodePoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalValue(value: unknown): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalValue);
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => compareUnicodeCodePoints(left, right))
        .map(([key, nested]) => [key, canonicalValue(nested)]),
    );
  }
  throw new TypeError("Canonical JSON accepts only finite JSON values");
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

export function canonicalPayloadHash(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

const utcTimestampSchema = z.string().datetime({ offset: true });
const hashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

export const workerCommandSchema = z.object({
  executable: z.string().min(1),
  args: z.array(z.string()),
  started_at: utcTimestampSchema,
  finished_at: utcTimestampSchema,
  exit_code: z.number().int().nullable(),
  status: z.enum(["passed", "failed", "cancelled"]),
});

export const workerTestSchema = z.object({
  name: z.string().min(1),
  command_index: z.number().int().nonnegative(),
  status: z.enum(["passed", "failed", "skipped"]),
  duration_ms: z.number().int().nonnegative(),
  summary: z.string(),
});

export const workerLogChunkReferenceSchema = z.object({
  sequence: z.number().int().nonnegative(),
  checksum: hashSchema,
  size_bytes: z.number().int().nonnegative(),
  created_at: utcTimestampSchema,
});

const workerResultBaseSchema = z.object({
  contract_version: z.literal(WORKER_RESULT_CONTRACT_VERSION),
  task_id: z.string().uuid(),
  execution_id: z.string().uuid(),
  specification_id: z.string().uuid(),
  specification_version: z.number().int().positive(),
  specification_hash: hashSchema,
  worker_id: z.string().uuid(),
  status: z.enum(["succeeded", "failed", "cancelled"]),
  started_at: utcTimestampSchema,
  finished_at: utcTimestampSchema,
  failure_stage: z.string().min(1).nullable(),
  error: z
    .object({
      code: z.string().min(1),
      message: z.string(),
    })
    .nullable(),
  summary: z.string(),
  changed_paths: z.array(z.string()),
  diff_summary: z.object({
    files_changed: z.number().int().nonnegative(),
    insertions: z.number().int().nonnegative(),
    deletions: z.number().int().nonnegative(),
    description: z.string(),
  }),
  diff_ref: z.string().min(1),
  diff_hash: hashSchema,
  protected_path_matches: z.array(z.string()),
  risks: z.array(z.string()),
  pending_items: z.array(z.string()),
  commands: z.array(workerCommandSchema),
  tests: z.array(workerTestSchema),
  log_chunks: z.array(workerLogChunkReferenceSchema),
  logs_truncated: z.boolean(),
  redaction_applied: z.literal(true),
  codex_estimated_cost_usd: z.number().nonnegative(),
  idempotency_key: z.string().min(1).max(255),
  sequence: z.number().int().positive(),
});

function validateWorkerFailureStage(
  value: {
    commands: readonly unknown[];
    error: unknown;
    failure_stage: string | null;
    log_chunks: readonly { sequence: number }[];
    status: "succeeded" | "failed" | "cancelled";
    tests: readonly { command_index: number }[];
  },
  context: z.RefinementCtx,
): void {
  if (value.status === "failed" && value.failure_stage === null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "failure_stage is required when status=failed",
      path: ["failure_stage"],
    });
  }
  if (value.status === "succeeded" && (value.failure_stage !== null || value.error !== null)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "succeeded result cannot contain failure_stage or error",
      path: ["status"],
    });
  }
  value.tests.forEach((test, index) => {
    if (test.command_index >= value.commands.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "test references a command outside the commands list",
        path: ["tests", index, "command_index"],
      });
    }
  });
  value.log_chunks.forEach((chunk, index) => {
    if (chunk.sequence !== index) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "log chunk sequence must be contiguous and ordered",
        path: ["log_chunks", index, "sequence"],
      });
    }
  });
}

export const workerResultContentSchema = workerResultBaseSchema.superRefine(
  validateWorkerFailureStage,
);
export type WorkerResultContent = z.infer<typeof workerResultContentSchema>;

export const workerResultSchema = workerResultBaseSchema
  .extend({ result_hash: hashSchema })
  .superRefine(validateWorkerFailureStage);
export type WorkerResult = z.infer<typeof workerResultSchema>;

export function createWorkerResult(content: WorkerResultContent): WorkerResult {
  const parsed = workerResultContentSchema.parse(content);
  return workerResultSchema.parse({
    ...parsed,
    result_hash: canonicalPayloadHash(parsed),
  });
}

export const workerCapabilitiesSchema = z.object({
  platform: z.string(),
  architecture: z.string(),
  node_version: z.string(),
  git_version: z.string(),
  codex_version: z.string(),
  tools: z.record(z.string()),
});
export type WorkerCapabilities = z.infer<typeof workerCapabilitiesSchema>;

export const runtimeCommandSchema = z.object({
  executable: z.string().min(1),
  args: z.array(z.string()),
});
export const workerRuntimeSchema = z.object({
  package_manager: z.enum(["npm", "pnpm", "yarn", "bun", "pip", "poetry", "uv", "make", "custom"]),
  bootstrap: z.array(runtimeCommandSchema).max(16),
  validate: z.array(runtimeCommandSchema).min(1).max(16),
  allowed_commands: z.array(runtimeCommandSchema).min(1).max(32),
  forbidden_commands: z.array(runtimeCommandSchema).max(32),
  timeout_minutes: z.number().int().min(1).max(60),
});
export type WorkerRuntime = z.infer<typeof workerRuntimeSchema>;

export const workerAssignmentSchema = z.object({
  execution_id: z.string().uuid(),
  task_id: z.string().uuid(),
  project_id: z.string().min(1),
  repository_path: z.string().min(1),
  autonomy_level: z.number().int().min(0).max(3),
  specification_id: z.string().uuid(),
  specification_version: z.number().int().positive(),
  specification_hash: hashSchema,
  specification: executableSpecificationPayloadSchema,
  lease_id: z.string().uuid(),
  lease_expires_at: utcTimestampSchema,
  fencing_token: z.string().regex(/^\d+$/),
  allowed_commands: z.array(
    z.object({
      executable: z.string().min(1),
      args: z.array(z.string()),
    }),
  ),
  runtime: workerRuntimeSchema.nullable(),
  required_tools: z.object({
    node: z.string().nullable(),
    git: z.string().nullable(),
    codex_cli: z.string().nullable(),
    gnu_tools: z.array(z.string()),
  }),
  protected_globs: z.array(z.string()),
});
export type WorkerAssignment = z.infer<typeof workerAssignmentSchema>;
