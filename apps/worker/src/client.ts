import {
  workerAssignmentSchema,
  workerCapabilitiesSchema,
  workerResultSchema,
  type WorkerAssignment,
  type WorkerCapabilities,
  type WorkerResult,
} from "@atlas/shared";
import { z } from "zod";

const registrationSchema = z.object({ workerId: z.string().uuid() });
const renewalSchema = z.object({
  cancelRequested: z.boolean(),
  leaseExpiresAt: z.string().datetime({ offset: true }),
  readyToFinalize: z.boolean(),
  terminalFailure: z.boolean(),
});

export class WorkerCoordinatorRequestError extends Error {
  constructor(readonly status: number) {
    super(`Coordinator request failed: ${String(status)}`);
    this.name = "WorkerCoordinatorRequestError";
  }
}

export class WorkerCoordinatorClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  register(input: {
    capabilities: WorkerCapabilities;
    concurrencyLimit: number;
    name: string;
    projectScopes: readonly string[];
  }): Promise<{ workerId: string }> {
    return this.request("/internal/worker/register", registrationSchema, {
      ...input,
      capabilities: workerCapabilitiesSchema.parse(input.capabilities),
    });
  }

  heartbeat(workerId: string, capabilities: WorkerCapabilities): Promise<void> {
    return this.requestVoid(`/internal/worker/${workerId}/heartbeat`, { capabilities });
  }

  claim(workerId: string, idempotencyKey: string): Promise<WorkerAssignment | null> {
    return this.request(`/internal/worker/${workerId}/claim`, workerAssignmentSchema.nullable(), {
      idempotencyKey,
    });
  }

  renew(
    workerId: string,
    assignment: WorkerAssignment,
    idempotencyKey: string,
  ): Promise<{
    cancelRequested: boolean;
    leaseExpiresAt: string;
    readyToFinalize: boolean;
    terminalFailure: boolean;
  }> {
    return this.request(`/internal/worker/${workerId}/lease`, renewalSchema, {
      executionId: assignment.execution_id,
      fencingToken: assignment.fencing_token,
      idempotencyKey,
      leaseId: assignment.lease_id,
    });
  }

  appendLog(
    workerId: string,
    assignment: WorkerAssignment,
    input: {
      checksum: string;
      content: string;
      idempotencyKey: string;
      sequence: number;
    },
  ): Promise<void> {
    return this.requestVoid(`/internal/worker/${workerId}/logs`, {
      ...input,
      executionId: assignment.execution_id,
      fencingToken: assignment.fencing_token,
      leaseId: assignment.lease_id,
    });
  }

  submitResult(
    workerId: string,
    assignment: WorkerAssignment,
    result: WorkerResult,
  ): Promise<{
    replayed: boolean;
    state: "CANCELLED" | "FAILED" | "FINALIZING" | "WAITING_RESULT_APPROVAL";
  }> {
    return this.request(
      `/internal/worker/${workerId}/result`,
      z.object({
        replayed: z.boolean(),
        state: z.enum(["CANCELLED", "FAILED", "FINALIZING", "WAITING_RESULT_APPROVAL"]),
      }),
      {
        fencingToken: assignment.fencing_token,
        leaseId: assignment.lease_id,
        result: workerResultSchema.parse(result),
      },
    );
  }

  finalize(
    workerId: string,
    assignment: WorkerAssignment,
    input: {
      commitSha: string | null;
      idempotencyKey: string;
      pullRequestUrl: string | null;
    },
  ): Promise<void> {
    return this.requestVoid(`/internal/worker/${workerId}/finalize`, {
      ...input,
      executionId: assignment.execution_id,
      fencingToken: assignment.fencing_token,
      leaseId: assignment.lease_id,
    });
  }

  private async request<Output>(
    path: string,
    schema: z.ZodType<Output, z.ZodTypeDef, unknown>,
    body: unknown,
  ): Promise<Output> {
    const response = await fetch(new URL(path, this.baseUrl), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new WorkerCoordinatorRequestError(response.status);
    }
    return schema.parse(await response.json());
  }

  private async requestVoid(path: string, body: unknown): Promise<void> {
    await this.request(path, z.unknown(), body);
  }
}
