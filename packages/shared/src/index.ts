import { createHash } from "node:crypto";

import { z } from "zod";

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

export const specificationContentSchema = z.object({
  objective: z.string().min(1),
  context: z.array(z.string()),
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
