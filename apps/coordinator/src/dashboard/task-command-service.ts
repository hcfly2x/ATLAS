import type {
  CancelDashboardTaskRequest,
  CancelDashboardTaskResponse,
  CreateDashboardDemandRequest,
  CreateDashboardDemandResponse,
} from "@atlas/contracts";
import {
  InvalidTaskTransitionError,
  TaskIdempotencyConflictError,
  TaskNotFoundError,
  TaskProjectNotEligibleError,
  TaskStateMachine,
  TaskVersionConflictError,
  type TaskCoreStore,
  type TaskSnapshot,
} from "@atlas/core";
import { canonicalPayloadHash, type TaskState } from "@atlas/shared";

import type { TaskIntakeService } from "../tasks/intake.js";

const IMMEDIATE_STATES = new Set<TaskState>([
  "NEW",
  "NORMALIZING",
  "ROUTING",
  "SPECIFYING",
  "WAITING_APPROVAL",
  "QUEUED",
  "FAILED",
]);
const COOPERATIVE_STATES = new Set<TaskState>([
  "RUNNING",
  "TESTING",
  "WAITING_RESULT_APPROVAL",
  "FINALIZING",
]);

export type DashboardTaskCommandErrorCode =
  | "DASHBOARD_IDEMPOTENCY_CONFLICT"
  | "DASHBOARD_PROJECT_NOT_ELIGIBLE"
  | "TASK_CANCEL_CONFLICT"
  | "TASK_NOT_FOUND"
  | "TASK_VERSION_CONFLICT";

export class DashboardTaskCommandError extends Error {
  constructor(readonly code: DashboardTaskCommandErrorCode) {
    super(code);
    this.name = "DashboardTaskCommandError";
  }
}

function publicTask(task: TaskSnapshot): CreateDashboardDemandResponse["task"] {
  return {
    id: task.id,
    projectId: task.projectId,
    state: task.state,
    version: task.version,
  };
}

function mapCoreError(error: unknown): never {
  if (error instanceof TaskIdempotencyConflictError) {
    throw new DashboardTaskCommandError("DASHBOARD_IDEMPOTENCY_CONFLICT");
  }
  if (error instanceof TaskProjectNotEligibleError) {
    throw new DashboardTaskCommandError("DASHBOARD_PROJECT_NOT_ELIGIBLE");
  }
  if (error instanceof TaskNotFoundError) {
    throw new DashboardTaskCommandError("TASK_NOT_FOUND");
  }
  if (error instanceof TaskVersionConflictError) {
    throw new DashboardTaskCommandError("TASK_VERSION_CONFLICT");
  }
  if (error instanceof InvalidTaskTransitionError) {
    throw new DashboardTaskCommandError("TASK_CANCEL_CONFLICT");
  }
  throw error;
}

export class DashboardTaskCommandService {
  private readonly stateMachine: TaskStateMachine;

  constructor(
    private readonly taskIntake: TaskIntakeService,
    private readonly taskStore: TaskCoreStore,
  ) {
    this.stateMachine = new TaskStateMachine(taskStore);
  }

  async createDemand(
    input: CreateDashboardDemandRequest,
    correlationId: string,
  ): Promise<CreateDashboardDemandResponse> {
    const requestHash = canonicalPayloadHash({
      objective: input.objective,
      projectId: input.projectId,
    });
    try {
      const result = await this.taskIntake.create({
        actor: "user",
        correlationId,
        idempotencyKey: `dashboard:demand:${input.idempotencyKey}`,
        origin: "dashboard:owner",
        originalMessage: input.objective,
        projectId: input.projectId,
        requestHash,
        requireActiveProject: true,
      });
      return {
        idempotentReplay: result.idempotentReplay,
        task: publicTask(result.task),
      };
    } catch (error: unknown) {
      return mapCoreError(error);
    }
  }

  async cancelTask(
    taskId: string,
    input: CancelDashboardTaskRequest,
    correlationId: string,
  ): Promise<CancelDashboardTaskResponse> {
    const requestHash = canonicalPayloadHash({
      reason: input.reason ?? null,
      taskId,
      taskVersion: input.taskVersion,
    });
    try {
      const replay = await this.taskStore.findReplay(
        `dashboard:cancel:${input.idempotencyKey}`,
        requestHash,
      );
      if (replay !== undefined) {
        return {
          idempotentReplay: true,
          mode: COOPERATIVE_STATES.has(replay.fromState) ? "cooperative" : "immediate",
          task: publicTask(replay.task),
        };
      }
    } catch (error: unknown) {
      return mapCoreError(error);
    }
    const task = await this.stateMachineStoreTask(taskId);
    const mode = IMMEDIATE_STATES.has(task.state)
      ? ("immediate" as const)
      : COOPERATIVE_STATES.has(task.state)
        ? ("cooperative" as const)
        : undefined;
    if (mode === undefined) {
      throw new DashboardTaskCommandError("TASK_CANCEL_CONFLICT");
    }
    try {
      const result = await this.stateMachine.transition({
        actor: "user",
        correlationId,
        expectedVersion: input.taskVersion,
        idempotencyKey: `dashboard:cancel:${input.idempotencyKey}`,
        reasonCode: input.reason === undefined ? "owner_cancelled" : "owner_cancelled_with_reason",
        requestHash,
        taskId,
        toState: mode === "immediate" ? "CANCELLED" : "CANCEL_REQUESTED",
      });
      return {
        idempotentReplay: result.idempotentReplay,
        mode,
        task: publicTask(result.task),
      };
    } catch (error: unknown) {
      return mapCoreError(error);
    }
  }

  private async stateMachineStoreTask(taskId: string): Promise<TaskSnapshot> {
    try {
      const task = await this.taskStore.getTask(taskId);
      if (task === undefined) throw new TaskNotFoundError(taskId);
      return task;
    } catch (error: unknown) {
      return mapCoreError(error);
    }
  }
}
