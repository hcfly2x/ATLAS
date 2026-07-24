import { z } from "zod";

export const correlationIdSchema = z.string().min(1).max(128);
export type CorrelationId = z.infer<typeof correlationIdSchema>;

export const serviceNameSchema = z.enum(["coordinator", "worker"]);
export type ServiceName = z.infer<typeof serviceNameSchema>;

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
