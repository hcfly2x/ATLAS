import { createStructuredLog, type StructuredLog } from "@atlas/shared";

export interface WorkerFoundationStatus {
  readonly architecture: NodeJS.Architecture;
  readonly concurrency: 1;
  readonly database: false;
  readonly docker: false;
  readonly log: StructuredLog;
  readonly platform: NodeJS.Platform;
}

export function getWorkerFoundationStatus(
  correlationId: string,
  platform: NodeJS.Platform = process.platform,
  architecture: NodeJS.Architecture = process.arch,
): WorkerFoundationStatus {
  return {
    architecture,
    concurrency: 1,
    database: false,
    docker: false,
    log: createStructuredLog(
      { correlationId, service: "worker" },
      "info",
      "worker foundation ready",
    ),
    platform,
  };
}
