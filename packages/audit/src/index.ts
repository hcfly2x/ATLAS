import type { CorrelationId } from "@atlas/shared";

export interface AuditRecord {
  readonly correlationId: CorrelationId;
  readonly action: string;
  readonly actor: "user" | "agent" | "worker" | "system";
  readonly occurredAt: string;
}

export interface AuditSink {
  append(record: AuditRecord): Promise<void>;
}
