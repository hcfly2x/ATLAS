import { createHash, randomUUID } from "node:crypto";

import {
  ApprovalActor,
  ApprovalChannel,
  ApprovalStatus,
  ApprovalTargetType,
  ApprovalType,
  ExecutionStatus,
  MemoryType,
  TaskState,
  WorkerStatus,
} from "@prisma/client";
import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";

import {
  canonicalPayloadHash,
  executableSpecificationPayloadSchema,
  workerCapabilitiesSchema,
  workerResultSchema,
  type WorkerAssignment,
  type WorkerCapabilities,
  type WorkerResult,
} from "@atlas/shared";

const allowedCommandsSchema = z.array(
  z.union([
    z
      .string()
      .min(1)
      .transform((executable) => ({ args: [] as string[], executable })),
    z.object({ executable: z.string().min(1), args: z.array(z.string()) }),
  ]),
);
const requiredToolsSchema = z.object({
  node: z.string().nullable(),
  git: z.string().nullable(),
  codex_cli: z.string().nullable(),
  gnu_tools: z.array(z.string()),
});

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export class WorkerAuthenticationError extends Error {
  readonly code = "WORKER_UNAUTHORIZED";
}

export class WorkerConflictError extends Error {
  readonly code = "WORKER_IDEMPOTENCY_CONFLICT";

  constructor(readonly detail: string) {
    super(detail);
  }
}

export class WorkerLeaseError extends Error {
  readonly code = "WORKER_LEASE_INVALID";
}

export class CodexMonthlyBudgetExceededError extends Error {
  readonly code = "CODEX_MONTHLY_BUDGET_EXCEEDED";

  constructor(
    readonly spentUsd: number,
    readonly limitUsd: number,
  ) {
    super("Codex monthly budget reached");
  }
}

export interface WorkerIdentity {
  readonly id: string;
  readonly projectScopes: readonly string[];
}

export interface WorkerServiceOptions {
  readonly codexMonthlyBudgetUsd: number;
  readonly leaseDurationMs: number;
  readonly prisma: PrismaClient;
  readonly protectedGlobsByProject: ReadonlyMap<string, readonly string[]>;
}

export class WorkerService {
  constructor(private readonly options: WorkerServiceOptions) {}

  async register(input: {
    capabilities: WorkerCapabilities;
    concurrencyLimit: number;
    name: string;
    projectScopes: readonly string[];
    token: string;
  }): Promise<{ workerId: string }> {
    if (input.concurrencyLimit !== 1) {
      throw new WorkerConflictError(
        "MVP concurrencyLimit must remain 1 until telemetry authorizes elevation",
      );
    }
    const capabilities = workerCapabilitiesSchema.parse(input.capabilities);
    const hash = tokenHash(input.token);
    const worker = await this.options.prisma.worker.upsert({
      where: { tokenHash: hash },
      create: {
        capabilities,
        concurrencyLimit: input.concurrencyLimit,
        name: input.name,
        projectScopes: [...input.projectScopes],
        status: WorkerStatus.IDLE,
        tokenHash: hash,
      },
      update: {
        capabilities,
        concurrencyLimit: input.concurrencyLimit,
        name: input.name,
        projectScopes: [...input.projectScopes],
        status: WorkerStatus.IDLE,
      },
    });
    return { workerId: worker.id };
  }

  async authenticate(token: string): Promise<WorkerIdentity> {
    const worker = await this.options.prisma.worker.findUnique({
      where: { tokenHash: tokenHash(token) },
    });
    if (worker === null || worker.status === WorkerStatus.DISABLED) {
      throw new WorkerAuthenticationError();
    }
    return {
      id: worker.id,
      projectScopes: z.array(z.string()).parse(worker.projectScopes),
    };
  }

  async heartbeat(workerId: string, capabilities: WorkerCapabilities): Promise<void> {
    await this.options.prisma.worker.update({
      where: { id: workerId },
      data: {
        capabilities: workerCapabilitiesSchema.parse(capabilities),
        lastHeartbeatAt: new Date(),
      },
    });
  }

  async claim(
    worker: WorkerIdentity,
    idempotencyKey: string,
    now = new Date(),
  ): Promise<WorkerAssignment | null> {
    const existingClaim = await this.options.prisma.execution.findUnique({
      where: { claimIdempotencyKey: idempotencyKey },
      include: { specification: true, task: { include: { project: true } } },
    });
    if (existingClaim !== null) {
      if (existingClaim.workerId !== worker.id) {
        throw new WorkerConflictError("claim key belongs to another worker");
      }
      return this.assignment(existingClaim, worker.projectScopes);
    }
    const workerCapacity = await this.options.prisma.worker.findUniqueOrThrow({
      where: { id: worker.id },
      select: {
        concurrencyLimit: true,
        _count: {
          select: {
            executions: {
              where: {
                status: {
                  in: [
                    ExecutionStatus.RUNNING,
                    ExecutionStatus.TESTING,
                    ExecutionStatus.AWAITING_RESULT_APPROVAL,
                    ExecutionStatus.FINALIZING,
                    ExecutionStatus.CANCEL_REQUESTED,
                  ],
                },
              },
            },
          },
        },
      },
    });
    if (workerCapacity._count.executions >= workerCapacity.concurrencyLimit) {
      return null;
    }
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const spend = await this.options.prisma.codexUsage.aggregate({
      where: { createdAt: { gte: monthStart } },
      _sum: { estimatedCostUsd: true },
    });
    const spentUsd = Number(spend._sum.estimatedCostUsd ?? 0);
    if (spentUsd >= this.options.codexMonthlyBudgetUsd) {
      await this.auditBudgetBlock(worker.id, worker.projectScopes, spentUsd, idempotencyKey);
      throw new CodexMonthlyBudgetExceededError(spentUsd, this.options.codexMonthlyBudgetUsd);
    }

    return this.options.prisma.$transaction(async (transaction) => {
      const replay = await transaction.execution.findUnique({
        where: { claimIdempotencyKey: idempotencyKey },
        include: { specification: true, task: { include: { project: true } } },
      });
      if (replay !== null) {
        if (replay.workerId !== worker.id) {
          throw new WorkerConflictError("claim key belongs to another worker");
        }
        return this.assignment(replay, worker.projectScopes);
      }

      const queuedExecution = await transaction.execution.findFirst({
        where: {
          status: ExecutionStatus.QUEUED,
          task: {
            project: { status: "ACTIVE" },
            projectId: { in: [...worker.projectScopes] },
            state: TaskState.QUEUED,
          },
        },
        include: { specification: true, task: { include: { project: true } } },
        orderBy: { createdAt: "asc" },
      });
      if (queuedExecution !== null) {
        const leaseId = randomUUID();
        const leaseExpiresAt = new Date(now.getTime() + this.options.leaseDurationMs);
        const claimed = await transaction.execution.update({
          where: { id: queuedExecution.id },
          data: {
            claimIdempotencyKey: idempotencyKey,
            leaseExpiresAt,
            leaseId,
            status: ExecutionStatus.RUNNING,
            workerId: worker.id,
          },
          include: { specification: true, task: { include: { project: true } } },
        });
        await transaction.task.update({
          where: { id: claimed.taskId },
          data: { state: TaskState.RUNNING, version: { increment: 1 } },
        });
        await transaction.worker.update({
          where: { id: worker.id },
          data: { status: WorkerStatus.BUSY },
        });
        await transaction.codexUsage.create({
          data: {
            estimatedCostUsd: 0,
            executionId: claimed.id,
            projectId: claimed.task.projectId,
            startedAt: now,
            taskId: claimed.taskId,
          },
        });
        await transaction.auditEvent.create({
          data: {
            action: "execution.claimed",
            actor: "WORKER",
            correlationId: idempotencyKey,
            idempotencyKey: `audit:${idempotencyKey}`,
            payload: json({
              executionId: claimed.id,
              fencingToken: claimed.fencingToken.toString(),
              leaseExpiresAt: leaseExpiresAt.toISOString(),
              leaseId,
              workerId: worker.id,
            }),
            projectId: claimed.task.projectId,
            targetId: claimed.id,
            targetType: "EXECUTION",
            taskId: claimed.taskId,
          },
        });
        await transaction.auditEvent.create({
          data: {
            action: "task.transition.accepted",
            actor: "WORKER",
            correlationId: idempotencyKey,
            idempotencyKey: `audit:${idempotencyKey}:task-transition`,
            payload: json({
              fromState: "QUEUED",
              task: {
                failureStage: claimed.task.failureStage,
                id: claimed.task.id,
                projectId: claimed.task.projectId,
                state: "RUNNING",
                version: claimed.task.version + 1,
              },
            }),
            projectId: claimed.task.projectId,
            targetId: claimed.taskId,
            targetType: "task",
            taskId: claimed.taskId,
          },
        });
        return this.assignment(claimed, worker.projectScopes);
      }

      const task = await transaction.task.findFirst({
        where: {
          state: TaskState.QUEUED,
          project: { status: "ACTIVE" },
          projectId: { in: [...worker.projectScopes] },
          activeSpecificationId: { not: null },
        },
        include: { activeSpecification: true, project: true },
        orderBy: { createdAt: "asc" },
      });
      if (task === null) {
        return null;
      }
      if (task.activeSpecification === null) {
        return null;
      }
      const attempt = (await transaction.execution.count({ where: { taskId: task.id } })) + 1;
      const leaseId = randomUUID();
      const leaseExpiresAt = new Date(now.getTime() + this.options.leaseDurationMs);
      const execution = await transaction.execution.create({
        data: {
          attempt,
          claimIdempotencyKey: idempotencyKey,
          fencingToken: 1,
          idempotencyKey: `execution:${task.id}:${String(attempt)}`,
          leaseExpiresAt,
          leaseId,
          specificationId: task.activeSpecification.id,
          status: ExecutionStatus.RUNNING,
          taskId: task.id,
          workerId: worker.id,
        },
        include: { specification: true, task: { include: { project: true } } },
      });
      const updated = await transaction.task.updateMany({
        where: { id: task.id, state: TaskState.QUEUED, version: task.version },
        data: { state: TaskState.RUNNING, version: { increment: 1 } },
      });
      if (updated.count !== 1) {
        throw new WorkerConflictError("task was claimed concurrently");
      }
      await transaction.worker.update({
        where: { id: worker.id },
        data: { status: WorkerStatus.BUSY },
      });
      await transaction.codexUsage.create({
        data: {
          estimatedCostUsd: 0,
          executionId: execution.id,
          projectId: task.projectId,
          startedAt: now,
          taskId: task.id,
        },
      });
      await transaction.auditEvent.create({
        data: {
          action: "execution.claimed",
          actor: "WORKER",
          correlationId: idempotencyKey,
          idempotencyKey: `audit:${idempotencyKey}`,
          payload: json({
            executionId: execution.id,
            fencingToken: "1",
            leaseExpiresAt: leaseExpiresAt.toISOString(),
            leaseId,
            workerId: worker.id,
          }),
          projectId: task.projectId,
          targetId: execution.id,
          targetType: "EXECUTION",
          taskId: task.id,
        },
      });
      await transaction.auditEvent.create({
        data: {
          action: "task.transition.accepted",
          actor: "WORKER",
          correlationId: idempotencyKey,
          idempotencyKey: `audit:${idempotencyKey}:task-transition`,
          payload: json({
            fromState: "QUEUED",
            task: {
              failureStage: task.failureStage,
              id: task.id,
              projectId: task.projectId,
              state: "RUNNING",
              version: task.version + 1,
            },
          }),
          projectId: task.projectId,
          targetId: task.id,
          targetType: "task",
          taskId: task.id,
        },
      });
      return this.assignment(execution, worker.projectScopes);
    });
  }

  async renewLease(input: {
    executionId: string;
    fencingToken: bigint;
    idempotencyKey: string;
    leaseId: string;
    workerId: string;
  }): Promise<{
    cancelRequested: boolean;
    leaseExpiresAt: string;
    readyToFinalize: boolean;
    terminalFailure: boolean;
  }> {
    const renewalAuditKey = `worker:lease:${input.idempotencyKey}`;
    const payloadHash = canonicalPayloadHash({
      executionId: input.executionId,
      fencingToken: input.fencingToken.toString(),
      leaseId: input.leaseId,
      workerId: input.workerId,
    });
    const replay = await this.options.prisma.auditEvent.findUnique({
      where: { idempotencyKey: renewalAuditKey },
    });
    if (replay !== null) {
      const payload = z
        .object({
          cancelRequested: z.boolean(),
          leaseExpiresAt: z.string(),
          payloadHash: z.string(),
          readyToFinalize: z.boolean(),
          terminalFailure: z.boolean(),
        })
        .parse(replay.payload);
      if (payload.payloadHash !== payloadHash) {
        await this.auditConflict(input.executionId, input.idempotencyKey, payloadHash);
        throw new WorkerConflictError("lease renewal payload changed");
      }
      return {
        cancelRequested: payload.cancelRequested,
        leaseExpiresAt: payload.leaseExpiresAt,
        readyToFinalize: payload.readyToFinalize,
        terminalFailure: payload.terminalFailure,
      };
    }
    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + this.options.leaseDurationMs);
    const execution = await this.options.prisma.execution.findFirst({
      where: {
        fencingToken: input.fencingToken,
        id: input.executionId,
        leaseExpiresAt: { gt: now },
        leaseId: input.leaseId,
        workerId: input.workerId,
      },
      include: { task: true },
    });
    if (execution === null) {
      throw new WorkerLeaseError();
    }
    const result = {
      cancelRequested: execution.task.state === TaskState.CANCEL_REQUESTED,
      leaseExpiresAt: leaseExpiresAt.toISOString(),
      readyToFinalize: execution.task.state === TaskState.FINALIZING,
      terminalFailure: execution.status === ExecutionStatus.FAILED,
    };
    await this.options.prisma.$transaction([
      this.options.prisma.execution.update({
        where: { id: execution.id },
        data: { leaseExpiresAt },
      }),
      this.options.prisma.auditEvent.create({
        data: {
          action: "execution.lease_renewed",
          actor: "WORKER",
          correlationId: input.idempotencyKey,
          idempotencyKey: renewalAuditKey,
          payload: json({ ...result, payloadHash }),
          projectId: execution.task.projectId,
          targetId: execution.id,
          targetType: "EXECUTION",
          taskId: execution.taskId,
        },
      }),
    ]);
    return result;
  }

  async appendLog(input: {
    checksum: string;
    content: string;
    executionId: string;
    fencingToken: bigint;
    idempotencyKey: string;
    leaseId: string;
    sequence: number;
    workerId: string;
  }): Promise<{ replayed: boolean }> {
    const expectedChecksum = `sha256:${createHash("sha256").update(input.content).digest("hex")}`;
    if (input.checksum !== expectedChecksum) {
      throw new WorkerConflictError("log chunk checksum does not match content");
    }
    const payloadHash = canonicalPayloadHash({
      checksum: input.checksum,
      content: input.content,
      executionId: input.executionId,
      sequence: input.sequence,
    });
    const existing = await this.options.prisma.workerLogChunk.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existing !== null) {
      if (existing.payloadHash !== payloadHash) {
        await this.auditConflict(input.executionId, input.idempotencyKey, payloadHash);
        throw new WorkerConflictError("log chunk payload changed");
      }
      return { replayed: true };
    }
    const sequenceOwner = await this.options.prisma.workerLogChunk.findUnique({
      where: {
        executionId_sequence: {
          executionId: input.executionId,
          sequence: input.sequence,
        },
      },
    });
    if (sequenceOwner !== null) {
      await this.auditConflict(input.executionId, input.idempotencyKey, payloadHash);
      throw new WorkerConflictError("log sequence already contains another payload");
    }
    await this.assertLease(input);
    await this.options.prisma.workerLogChunk.create({
      data: {
        checksum: input.checksum,
        content: input.content,
        executionId: input.executionId,
        idempotencyKey: input.idempotencyKey,
        payloadHash,
        sequence: input.sequence,
        sizeBytes: Buffer.byteLength(input.content),
      },
    });
    return { replayed: false };
  }

  async submitResult(input: {
    fencingToken: bigint;
    leaseId: string;
    result: WorkerResult;
    workerId: string;
  }): Promise<{
    replayed: boolean;
    state: "CANCELLED" | "FAILED" | "FINALIZING" | "WAITING_RESULT_APPROVAL";
  }> {
    const result = workerResultSchema.parse(input.result);
    const { result_hash: resultHash, ...resultContent } = result;
    const canonicalResultHash = canonicalPayloadHash(resultContent);
    if (canonicalResultHash !== resultHash) {
      throw new WorkerConflictError("result_hash is not canonical");
    }
    const existing = await this.options.prisma.execution.findUnique({
      where: { resultIdempotencyKey: result.idempotency_key },
    });
    if (existing !== null) {
      if (existing.resultHash !== result.result_hash) {
        await this.auditConflict(existing.id, result.idempotency_key, result.result_hash);
        throw new WorkerConflictError("result payload changed");
      }
      return {
        replayed: true,
        state:
          existing.status === ExecutionStatus.CANCELLED
            ? "CANCELLED"
            : existing.status === ExecutionStatus.FAILED
              ? "FAILED"
              : existing.status === ExecutionStatus.FINALIZING
                ? "FINALIZING"
                : "WAITING_RESULT_APPROVAL",
      };
    }
    const execution = await this.assertLease({
      executionId: result.execution_id,
      fencingToken: input.fencingToken,
      leaseId: input.leaseId,
      workerId: input.workerId,
    });
    if (execution.resultHash !== null) {
      await this.auditConflict(execution.id, result.idempotency_key, result.result_hash);
      throw new WorkerConflictError("execution already has a submitted result");
    }
    const persistedChunks = await this.options.prisma.workerLogChunk.findMany({
      where: { executionId: execution.id },
      orderBy: { sequence: "asc" },
    });
    const chunkReferencesMatch =
      persistedChunks.length === result.log_chunks.length &&
      persistedChunks.every((chunk, index) => {
        const reference = result.log_chunks[index];
        return (
          reference?.sequence === chunk.sequence &&
          reference.checksum === chunk.checksum &&
          reference.size_bytes === chunk.sizeBytes
        );
      });
    if (!chunkReferencesMatch) {
      throw new WorkerConflictError("result log chunk references do not match persisted chunks");
    }
    if (
      execution.specificationId !== result.specification_id ||
      execution.specification.version !== result.specification_version ||
      execution.specification.payloadHash !== result.specification_hash
    ) {
      throw new WorkerConflictError("result does not match the claimed Specification");
    }
    if (result.status !== "succeeded") {
      const cancelled = result.status === "cancelled";
      await this.options.prisma.$transaction([
        this.options.prisma.execution.update({
          where: { id: execution.id },
          data: {
            commands: json(result.commands),
            diffHash: result.diff_hash,
            diffSummary: json(result.diff_summary),
            failureStage: result.failure_stage,
            leaseExpiresAt: null,
            leaseId: null,
            resultHash: result.result_hash,
            resultIdempotencyKey: result.idempotency_key,
            resultPayload: json(result),
            resultSequence: result.sequence,
            status: cancelled ? ExecutionStatus.CANCELLED : ExecutionStatus.FAILED,
            testResult: json(result.tests),
          },
        }),
        this.options.prisma.task.update({
          where: { id: execution.taskId },
          data: {
            failureStage: cancelled ? null : (result.failure_stage ?? "worker"),
            state: cancelled ? TaskState.CANCELLED : TaskState.FAILED,
            version: { increment: 1 },
          },
        }),
        this.options.prisma.worker.update({
          where: { id: input.workerId },
          data: { status: WorkerStatus.IDLE },
        }),
        this.options.prisma.codexUsage.update({
          where: { executionId: execution.id },
          data: {
            estimatedCostUsd: result.codex_estimated_cost_usd,
            finishedAt: new Date(),
          },
        }),
        this.options.prisma.auditEvent.create({
          data: {
            action: cancelled ? "execution.cancelled" : "execution.failed",
            actor: "WORKER",
            correlationId: result.idempotency_key,
            idempotencyKey: `audit:${result.idempotency_key}`,
            payload: json({
              failureStage: result.failure_stage,
              fromState: execution.task.state,
              resultHash: result.result_hash,
              toState: cancelled ? "CANCELLED" : "FAILED",
            }),
            projectId: execution.task.projectId,
            targetId: execution.id,
            targetType: "EXECUTION",
            taskId: execution.taskId,
          },
        }),
      ]);
      return { replayed: false, state: cancelled ? "CANCELLED" : "FAILED" };
    }
    const testsGreen =
      result.tests.length > 0 && result.tests.every((test) => test.status === "passed");
    const autoFinalize =
      testsGreen &&
      result.protected_path_matches.length === 0 &&
      execution.task.project.autonomyLevel >= 2;
    const taskState = autoFinalize ? TaskState.FINALIZING : TaskState.WAITING_RESULT_APPROVAL;
    const executionStatus = autoFinalize
      ? ExecutionStatus.FINALIZING
      : ExecutionStatus.AWAITING_RESULT_APPROVAL;
    const transitioned = await this.options.prisma.$transaction(async (transaction) => {
      const testingTransition = await transaction.task.updateMany({
        where: {
          id: execution.taskId,
          state: TaskState.RUNNING,
          version: execution.task.version,
        },
        data: { state: TaskState.TESTING, version: { increment: 1 } },
      });
      if (testingTransition.count !== 1) {
        const current = await transaction.task.findUniqueOrThrow({
          where: { id: execution.taskId },
        });
        await transaction.auditEvent.create({
          data: {
            action: "task.transition.rejected",
            actor: "WORKER",
            correlationId: result.idempotency_key,
            idempotencyKey: `audit:${result.idempotency_key}:transition-rejected`,
            payload: json({
              actualState: current.state,
              actualVersion: current.version,
              expectedState: TaskState.RUNNING,
              expectedVersion: execution.task.version,
              reason: "state_or_version_conflict",
              toState: TaskState.TESTING,
            }),
            projectId: execution.task.projectId,
            targetId: execution.taskId,
            targetType: "task",
            taskId: execution.taskId,
          },
        });
        return false;
      }
      const testingTask = await transaction.task.findUniqueOrThrow({
        where: { id: execution.taskId },
      });
      const policyTransition = await transaction.task.updateMany({
        where: {
          id: execution.taskId,
          state: TaskState.TESTING,
          version: testingTask.version,
        },
        data: { state: taskState, version: { increment: 1 } },
      });
      if (policyTransition.count !== 1) {
        throw new WorkerConflictError("task changed while applying result policy");
      }
      const policyTask = await transaction.task.findUniqueOrThrow({
        where: { id: execution.taskId },
      });
      await transaction.execution.update({
        where: { id: execution.id },
        data: {
          commands: json(result.commands),
          diffHash: result.diff_hash,
          diffSummary: json(result.diff_summary),
          failureStage: result.failure_stage,
          logsRef: result.diff_ref,
          resultHash: result.result_hash,
          resultIdempotencyKey: result.idempotency_key,
          resultPayload: json(result),
          resultSequence: result.sequence,
          status: executionStatus,
          testResult: json(result.tests),
        },
      });
      await transaction.approval.create({
        data: {
          actor: autoFinalize ? ApprovalActor.SYSTEM : ApprovalActor.USER,
          channel: autoFinalize ? ApprovalChannel.POLICY : ApprovalChannel.TELEGRAM,
          decidedBy: autoFinalize ? "autonomy-policy" : null,
          idempotencyKey: `execution:${execution.id}:result-approval`,
          presentedPayload: json({
            diffHash: result.diff_hash,
            resultHash: result.result_hash,
          }),
          requestedBy: "worker",
          respondedAt: autoFinalize ? new Date() : null,
          status: autoFinalize ? ApprovalStatus.APPROVED : ApprovalStatus.PENDING,
          targetHash: result.result_hash,
          targetId: execution.id,
          targetType: ApprovalTargetType.EXECUTION_RESULT,
          targetVersion: execution.attempt,
          taskId: execution.taskId,
          type: ApprovalType.RESULT,
        },
      });
      await transaction.codexUsage.update({
        where: { executionId: execution.id },
        data: {
          estimatedCostUsd: result.codex_estimated_cost_usd,
          finishedAt: new Date(),
        },
      });
      await transaction.auditEvent.create({
        data: {
          action: autoFinalize ? "approval.auto_approved" : "approval.requested",
          actor: "SYSTEM",
          correlationId: result.idempotency_key,
          idempotencyKey: `audit:${result.idempotency_key}`,
          payload: json({
            diffHash: result.diff_hash,
            resultHash: result.result_hash,
            targetState: taskState,
          }),
          projectId: execution.task.projectId,
          targetId: execution.id,
          targetType: "EXECUTION_RESULT",
          taskId: execution.taskId,
        },
      });
      await transaction.auditEvent.create({
        data: {
          action: "task.transition.accepted",
          actor: "WORKER",
          correlationId: result.idempotency_key,
          idempotencyKey: `audit:${result.idempotency_key}:testing`,
          payload: json({
            fromState: "RUNNING",
            task: {
              failureStage: testingTask.failureStage,
              id: testingTask.id,
              projectId: testingTask.projectId,
              state: testingTask.state,
              version: testingTask.version,
            },
          }),
          projectId: execution.task.projectId,
          targetId: execution.taskId,
          targetType: "task",
          taskId: execution.taskId,
        },
      });
      await transaction.auditEvent.create({
        data: {
          action: "task.transition.accepted",
          actor: "SYSTEM",
          correlationId: result.idempotency_key,
          idempotencyKey: `audit:${result.idempotency_key}:result-policy`,
          payload: json({
            fromState: "TESTING",
            task: {
              failureStage: policyTask.failureStage,
              id: policyTask.id,
              projectId: policyTask.projectId,
              state: policyTask.state,
              version: policyTask.version,
            },
          }),
          projectId: execution.task.projectId,
          targetId: execution.taskId,
          targetType: "task",
          taskId: execution.taskId,
        },
      });
      return true;
    });
    if (!transitioned) {
      throw new WorkerConflictError("task is no longer RUNNING");
    }
    return { replayed: false, state: taskState };
  }

  async finalize(input: {
    commitSha: string;
    executionId: string;
    fencingToken: bigint;
    idempotencyKey: string;
    leaseId: string;
    pullRequestUrl: string;
    workerId: string;
  }): Promise<{ replayed: boolean }> {
    const finalizationHash = canonicalPayloadHash({
      commitSha: input.commitSha,
      pullRequestUrl: input.pullRequestUrl,
    });
    const replay = await this.options.prisma.execution.findUnique({
      where: { finalizationIdempotencyKey: input.idempotencyKey },
    });
    if (replay !== null) {
      if (replay.finalizationHash !== finalizationHash) {
        await this.auditConflict(replay.id, input.idempotencyKey, finalizationHash);
        throw new WorkerConflictError("finalization payload changed");
      }
      return { replayed: true };
    }
    const execution = await this.assertLease(input);
    if (execution.status !== ExecutionStatus.FINALIZING) {
      throw new WorkerConflictError("execution is not ready for finalization");
    }
    const result = workerResultSchema.parse(execution.resultPayload);
    const summaryContent = result.summary.slice(0, 8_000);
    const summaryIdempotencyKey = `task-summary:${execution.id}`;
    const summaryPayloadHash = canonicalPayloadHash({
      content: summaryContent,
      projectId: execution.task.projectId,
      taskId: execution.taskId,
      type: "summary",
    });
    const transitioned = await this.options.prisma.$transaction(async (transaction) => {
      const completedTransition = await transaction.task.updateMany({
        where: {
          id: execution.taskId,
          state: TaskState.FINALIZING,
          version: execution.task.version,
        },
        data: { state: TaskState.COMPLETED, version: { increment: 1 } },
      });
      if (completedTransition.count !== 1) {
        const current = await transaction.task.findUniqueOrThrow({
          where: { id: execution.taskId },
        });
        await transaction.auditEvent.create({
          data: {
            action: "task.transition.rejected",
            actor: "WORKER",
            correlationId: input.idempotencyKey,
            idempotencyKey: `audit:${input.idempotencyKey}:transition-rejected`,
            payload: json({
              actualState: current.state,
              actualVersion: current.version,
              expectedState: TaskState.FINALIZING,
              expectedVersion: execution.task.version,
              reason: "state_or_version_conflict",
              toState: TaskState.COMPLETED,
            }),
            projectId: execution.task.projectId,
            targetId: execution.taskId,
            targetType: "task",
            taskId: execution.taskId,
          },
        });
        return false;
      }
      const completedTask = await transaction.task.findUniqueOrThrow({
        where: { id: execution.taskId },
      });
      await transaction.execution.update({
        where: { id: execution.id },
        data: {
          finalizationHash,
          finalizationIdempotencyKey: input.idempotencyKey,
          leaseExpiresAt: null,
          leaseId: null,
          status: ExecutionStatus.SUCCEEDED,
        },
      });
      await transaction.worker.update({
        where: { id: input.workerId },
        data: { status: WorkerStatus.IDLE },
      });
      const memory = await transaction.memoryItem.create({
        data: {
          content: summaryContent,
          idempotencyKey: summaryIdempotencyKey,
          payloadHash: summaryPayloadHash,
          projectId: execution.task.projectId,
          taskId: execution.taskId,
          type: MemoryType.SUMMARY,
        },
      });
      await transaction.auditEvent.create({
        data: {
          action: "memory.task_summary.created",
          actor: "SYSTEM",
          correlationId: input.idempotencyKey,
          idempotencyKey: `audit:${summaryIdempotencyKey}`,
          payload: json({
            executionId: execution.id,
            payloadHash: summaryPayloadHash,
          }),
          projectId: execution.task.projectId,
          targetId: memory.id,
          targetType: "memory_item",
          taskId: execution.taskId,
        },
      });
      await transaction.auditEvent.create({
        data: {
          action: "execution.finalized",
          actor: "WORKER",
          correlationId: input.idempotencyKey,
          idempotencyKey: `audit:${input.idempotencyKey}`,
          payload: json({
            commitSha: input.commitSha,
            fromState: "FINALIZING",
            pullRequestUrl: input.pullRequestUrl,
            toState: "COMPLETED",
          }),
          projectId: execution.task.projectId,
          targetId: execution.id,
          targetType: "EXECUTION",
          taskId: execution.taskId,
        },
      });
      await transaction.auditEvent.create({
        data: {
          action: "task.transition.accepted",
          actor: "WORKER",
          correlationId: input.idempotencyKey,
          idempotencyKey: `audit:${input.idempotencyKey}:task-transition`,
          payload: json({
            fromState: "FINALIZING",
            task: {
              failureStage: completedTask.failureStage,
              id: completedTask.id,
              projectId: completedTask.projectId,
              state: completedTask.state,
              version: completedTask.version,
            },
          }),
          projectId: execution.task.projectId,
          targetId: execution.taskId,
          targetType: "task",
          taskId: execution.taskId,
        },
      });
      return true;
    });
    if (!transitioned) {
      throw new WorkerConflictError("task is no longer FINALIZING");
    }
    return { replayed: false };
  }

  async reconcileTechnicalFailure(input: {
    confirmedStopped: boolean;
    executionId: string;
    idempotencyKey: string;
  }): Promise<{ newExecutionId: string; replayed: boolean }> {
    return this.options.prisma.$transaction(async (transaction) => {
      const replay = await transaction.auditEvent.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (replay !== null) {
        const payload = z.object({ newExecutionId: z.string().uuid() }).parse(replay.payload);
        return { newExecutionId: payload.newExecutionId, replayed: true };
      }
      const execution = await transaction.execution.findUniqueOrThrow({
        where: { id: input.executionId },
        include: { task: { include: { project: true } } },
      });
      const technicalStages = new Set(["network", "timeout", "lease_expired"]);
      const leaseIsUnambiguous =
        execution.leaseExpiresAt === null || execution.leaseExpiresAt.getTime() <= Date.now();
      if (
        execution.status !== ExecutionStatus.FAILED ||
        execution.task.project.autonomyLevel < 3 ||
        execution.failureStage === null ||
        !technicalStages.has(execution.failureStage) ||
        !leaseIsUnambiguous ||
        !input.confirmedStopped
      ) {
        throw new WorkerConflictError(
          "technical retry requires level 3, reconciled stop and an eligible failed Execution",
        );
      }
      const nextAttempt =
        (await transaction.execution.count({ where: { taskId: execution.taskId } })) + 1;
      const retried = await transaction.execution.create({
        data: {
          attempt: nextAttempt,
          fencingToken: execution.fencingToken + 1n,
          idempotencyKey: `execution:${execution.taskId}:${String(nextAttempt)}`,
          specificationId: execution.specificationId,
          status: ExecutionStatus.QUEUED,
          taskId: execution.taskId,
        },
      });
      await transaction.execution.update({
        where: { id: execution.id },
        data: { reconciledAt: new Date() },
      });
      await transaction.task.update({
        where: { id: execution.taskId },
        data: { failureStage: null, state: TaskState.QUEUED, version: { increment: 1 } },
      });
      await transaction.auditEvent.create({
        data: {
          action: "execution.technical_retry_scheduled",
          actor: "SYSTEM",
          correlationId: input.idempotencyKey,
          idempotencyKey: input.idempotencyKey,
          payload: json({
            newExecutionId: retried.id,
            previousExecutionId: execution.id,
            previousFencingToken: execution.fencingToken.toString(),
            newFencingToken: retried.fencingToken.toString(),
          }),
          projectId: execution.task.projectId,
          targetId: retried.id,
          targetType: "EXECUTION",
          taskId: execution.taskId,
        },
      });
      return { newExecutionId: retried.id, replayed: false };
    });
  }

  async retryEligibleTechnicalFailures(): Promise<number> {
    const eligible = await this.options.prisma.execution.findMany({
      where: {
        failureStage: { in: ["network", "timeout"] },
        leaseId: null,
        reconciledAt: null,
        status: ExecutionStatus.FAILED,
        task: { project: { autonomyLevel: { gte: 3 } } },
      },
      select: { id: true },
    });
    let scheduled = 0;
    for (const execution of eligible) {
      try {
        await this.reconcileTechnicalFailure({
          confirmedStopped: true,
          executionId: execution.id,
          idempotencyKey: `execution:${execution.id}:automatic-technical-retry`,
        });
        scheduled += 1;
      } catch (error: unknown) {
        if (!(error instanceof WorkerConflictError)) throw error;
      }
    }
    return scheduled;
  }

  private async assertLease(input: {
    executionId: string;
    fencingToken: bigint;
    leaseId: string;
    workerId: string;
  }) {
    const execution = await this.options.prisma.execution.findFirst({
      where: {
        fencingToken: input.fencingToken,
        id: input.executionId,
        leaseExpiresAt: { gt: new Date() },
        leaseId: input.leaseId,
        workerId: input.workerId,
      },
      include: {
        specification: true,
        task: { include: { project: true } },
      },
    });
    if (execution === null) {
      throw new WorkerLeaseError();
    }
    return execution;
  }

  private assignment(
    execution: {
      fencingToken: bigint;
      id: string;
      leaseExpiresAt: Date | null;
      leaseId: string | null;
      specification: {
        id: string;
        payload: Prisma.JsonValue;
        payloadHash: string;
        version: number;
      };
      task: {
        id: string;
        projectId: string;
        project: {
          allowedCommands: Prisma.JsonValue;
          autonomyLevel: number;
          repository: string | null;
          requiredTools: Prisma.JsonValue;
        };
      };
    },
    scopes: readonly string[],
  ): WorkerAssignment {
    if (
      execution.leaseId === null ||
      execution.leaseExpiresAt === null ||
      execution.task.project.repository === null ||
      !scopes.includes(execution.task.projectId)
    ) {
      throw new WorkerConflictError("claimed project is not executable by this worker");
    }
    const protectedGlobs = this.options.protectedGlobsByProject.get(execution.task.projectId);
    if (protectedGlobs === undefined) {
      throw new WorkerConflictError("active project has no protected-paths mapping");
    }
    return {
      allowed_commands: allowedCommandsSchema.parse(execution.task.project.allowedCommands),
      autonomy_level: execution.task.project.autonomyLevel,
      execution_id: execution.id,
      fencing_token: execution.fencingToken.toString(),
      lease_expires_at: execution.leaseExpiresAt.toISOString(),
      lease_id: execution.leaseId,
      project_id: execution.task.projectId,
      protected_globs: [...protectedGlobs],
      repository_path: execution.task.project.repository,
      required_tools: requiredToolsSchema.parse(execution.task.project.requiredTools),
      specification: executableSpecificationPayloadSchema.parse(execution.specification.payload),
      specification_hash: execution.specification.payloadHash,
      specification_id: execution.specification.id,
      specification_version: execution.specification.version,
      task_id: execution.task.id,
    };
  }

  private async auditBudgetBlock(
    workerId: string,
    projectScopes: readonly string[],
    spentUsd: number,
    idempotencyKey: string,
  ): Promise<void> {
    const project = await this.options.prisma.project.findFirst({
      where: {
        id: { in: [...projectScopes] },
        tasks: { some: { state: TaskState.QUEUED } },
      },
    });
    if (project === null) return;
    await this.options.prisma.auditEvent.upsert({
      where: { idempotencyKey: `audit:${idempotencyKey}:budget` },
      create: {
        action: "codex.budget_blocked",
        actor: "SYSTEM",
        correlationId: idempotencyKey,
        idempotencyKey: `audit:${idempotencyKey}:budget`,
        payload: json({ limitUsd: this.options.codexMonthlyBudgetUsd, spentUsd, workerId }),
        projectId: project.id,
      },
      update: {},
    });
  }

  private async auditConflict(
    executionId: string,
    idempotencyKey: string,
    receivedHash: string,
  ): Promise<void> {
    const execution = await this.options.prisma.execution.findUniqueOrThrow({
      where: { id: executionId },
      include: { task: true },
    });
    await this.options.prisma.auditEvent.upsert({
      where: { idempotencyKey: `audit:${idempotencyKey}:conflict` },
      create: {
        action: "worker.idempotency_conflict",
        actor: "WORKER",
        correlationId: idempotencyKey,
        idempotencyKey: `audit:${idempotencyKey}:conflict`,
        payload: json({ executionId, receivedHash }),
        projectId: execution.task.projectId,
        targetId: executionId,
        targetType: "EXECUTION",
        taskId: execution.taskId,
      },
      update: {},
    });
  }
}
