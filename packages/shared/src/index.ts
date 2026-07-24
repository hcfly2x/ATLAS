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
