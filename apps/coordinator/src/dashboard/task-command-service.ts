import type {
  CancelDashboardTaskRequest,
  CancelDashboardTaskResponse,
  CreateDashboardDemandRequest,
  CreateDashboardDemandResponse,
  DashboardTaskOperationalCommandResponse,
  PauseDashboardTaskRequest,
  ResumeDashboardTaskRequest,
  SetDashboardTaskPriorityRequest,
} from "@atlas/contracts";
import {
  cancelDashboardTaskResponseSchema,
  createDashboardDemandResponseSchema,
  dashboardTaskOperationalCommandResponseSchema,
} from "@atlas/contracts";
import {
  InvalidTaskTransitionError,
  TaskIdempotencyConflictError,
  TaskNotFoundError,
  TaskProjectNotEligibleError,
  TaskStateMachine,
  TaskVersionConflictError,
  type TaskSnapshot,
} from "@atlas/core";
import { canonicalPayloadHash, type TaskState } from "@atlas/shared";

import type { TaskIntakeService } from "../tasks/intake.js";
import {
  DashboardCommandOutcomeUnknownError,
  DashboardTaskPriorityConflictError,
  type DashboardCommandReceiptStore,
} from "./command-receipt-store.js";

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
  | "DASHBOARD_COMMAND_OUTCOME_UNKNOWN"
  | "DASHBOARD_PROJECT_NOT_ELIGIBLE"
  | "TASK_CANCEL_CONFLICT"
  | "TASK_NOT_FOUND"
  | "TASK_PAUSE_CONFLICT"
  | "TASK_PRIORITY_CONFLICT"
  | "TASK_RESUME_CONFLICT"
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

function mapCoreError(error: unknown): DashboardTaskCommandError | undefined {
  if (error instanceof TaskIdempotencyConflictError) {
    return new DashboardTaskCommandError("DASHBOARD_IDEMPOTENCY_CONFLICT");
  }
  if (error instanceof TaskProjectNotEligibleError) {
    return new DashboardTaskCommandError("DASHBOARD_PROJECT_NOT_ELIGIBLE");
  }
  if (error instanceof TaskNotFoundError) {
    return new DashboardTaskCommandError("TASK_NOT_FOUND");
  }
  if (error instanceof TaskVersionConflictError) {
    return new DashboardTaskCommandError("TASK_VERSION_CONFLICT");
  }
  if (error instanceof InvalidTaskTransitionError) {
    return new DashboardTaskCommandError("TASK_CANCEL_CONFLICT");
  }
  if (error instanceof DashboardCommandOutcomeUnknownError) {
    return new DashboardTaskCommandError("DASHBOARD_COMMAND_OUTCOME_UNKNOWN");
  }
  if (error instanceof DashboardTaskPriorityConflictError) {
    return new DashboardTaskCommandError("TASK_PRIORITY_CONFLICT");
  }
  return error instanceof DashboardTaskCommandError ? error : undefined;
}

function replayed<T extends { readonly idempotentReplay: boolean }>(value: T): T {
  return { ...value, idempotentReplay: true };
}

function publicOperationalTask(
  task: TaskSnapshot,
): DashboardTaskOperationalCommandResponse["task"] {
  return {
    id: task.id,
    pausedFromState: task.pausedFromState ?? null,
    priority: task.priority ?? 0,
    projectId: task.projectId,
    state: task.state,
    version: task.version,
  };
}

export class DashboardTaskCommandService {
  constructor(
    private readonly taskIntake: TaskIntakeService,
    private readonly receipts: DashboardCommandReceiptStore,
  ) {}

  async createDemand(
    input: CreateDashboardDemandRequest,
    correlationId: string,
  ): Promise<CreateDashboardDemandResponse> {
    const requestHash = canonicalPayloadHash({
      objective: input.objective,
      projectId: input.projectId,
    });
    const receiptKey = `dashboard:command:${input.idempotencyKey}`;
    let outcome;
    try {
      outcome = await this.receipts.execute<CreateDashboardDemandResponse>(
        {
          actor: "user",
          command: "create_demand",
          correlationId,
          idempotencyKey: receiptKey,
          requestHash,
          requestedProject: input.projectId,
        },
        async (taskStore) => {
          try {
            const result = await taskStore.createTask({
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
              resultCode: "TASK_CREATED",
              resultPayload: {
                idempotentReplay: result.idempotentReplay,
                task: publicTask(result.task),
              },
              status: "accepted",
            };
          } catch (error: unknown) {
            const mapped = mapCoreError(error);
            if (mapped === undefined) throw error;
            return { resultCode: mapped.code, status: "rejected" };
          }
        },
      );
    } catch (error: unknown) {
      throw mapCoreError(error) ?? error;
    }
    if (outcome.status === "rejected") {
      throw new DashboardTaskCommandError(
        this.rejectedCode(outcome.resultCode, "DASHBOARD_PROJECT_NOT_ELIGIBLE"),
      );
    }
    const response = createDashboardDemandResponseSchema.parse(outcome.resultPayload);
    if (!outcome.idempotentReplay && !response.idempotentReplay) {
      this.taskIntake.notifyTaskCreated(response.task.id, correlationId);
    }
    return outcome.idempotentReplay ? replayed(response) : response;
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
    const receiptKey = `dashboard:command:${input.idempotencyKey}`;
    let outcome;
    try {
      outcome = await this.receipts.execute<CancelDashboardTaskResponse>(
        {
          actor: "user",
          command: "cancel_task",
          correlationId,
          expectedVersion: input.taskVersion,
          idempotencyKey: receiptKey,
          requestHash,
          targetTaskId: taskId,
        },
        async (taskStore) => {
          try {
            const task = await this.stateMachineStoreTask(taskStore, taskId);
            const mode = IMMEDIATE_STATES.has(task.state)
              ? ("immediate" as const)
              : COOPERATIVE_STATES.has(task.state)
                ? ("cooperative" as const)
                : undefined;
            if (mode === undefined) {
              return { resultCode: "TASK_CANCEL_CONFLICT", status: "rejected" };
            }
            const result = await new TaskStateMachine(taskStore).transition({
              actor: "user",
              correlationId,
              expectedVersion: input.taskVersion,
              idempotencyKey: `dashboard:cancel:${input.idempotencyKey}`,
              reasonCode:
                input.reason === undefined ? "owner_cancelled" : "owner_cancelled_with_reason",
              requestHash,
              taskId,
              toState: mode === "immediate" ? "CANCELLED" : "CANCEL_REQUESTED",
            });
            return {
              resultCode: mode === "immediate" ? "TASK_CANCELLED" : "TASK_CANCEL_REQUESTED",
              resultPayload: {
                idempotentReplay: result.idempotentReplay,
                mode,
                task: publicTask(result.task),
              },
              status: "accepted",
            };
          } catch (error: unknown) {
            const mapped = mapCoreError(error);
            if (mapped === undefined) throw error;
            return { resultCode: mapped.code, status: "rejected" };
          }
        },
      );
    } catch (error: unknown) {
      throw mapCoreError(error) ?? error;
    }
    if (outcome.status === "rejected") {
      throw new DashboardTaskCommandError(
        this.rejectedCode(outcome.resultCode, "TASK_CANCEL_CONFLICT"),
      );
    }
    const response = cancelDashboardTaskResponseSchema.parse(outcome.resultPayload);
    return outcome.idempotentReplay ? replayed(response) : response;
  }

  async pauseTask(
    taskId: string,
    input: PauseDashboardTaskRequest,
    correlationId: string,
  ): Promise<DashboardTaskOperationalCommandResponse> {
    const requestHash = canonicalPayloadHash({
      action: "pause_task",
      taskId,
      taskVersion: input.taskVersion,
    });
    let outcome;
    try {
      outcome = await this.receipts.execute<DashboardTaskOperationalCommandResponse>(
        {
          actor: "user",
          command: "pause_task",
          correlationId,
          expectedVersion: input.taskVersion,
          idempotencyKey: `dashboard:command:${input.idempotencyKey}`,
          requestHash,
          targetTaskId: taskId,
        },
        async (taskStore) => {
          try {
            const result = await new TaskStateMachine(taskStore).transition({
              actor: "user",
              correlationId,
              expectedVersion: input.taskVersion,
              idempotencyKey: `dashboard:pause:${input.idempotencyKey}`,
              reasonCode: "owner_paused",
              requestHash,
              taskId,
              toState: "PAUSED",
            });
            return {
              resultCode: "TASK_PAUSED",
              resultPayload: {
                idempotentReplay: result.idempotentReplay,
                task: publicOperationalTask(result.task),
              },
              status: "accepted",
            };
          } catch (error: unknown) {
            const mapped = mapCoreError(error);
            if (mapped === undefined) throw error;
            return {
              resultCode:
                mapped.code === "TASK_CANCEL_CONFLICT" ? "TASK_PAUSE_CONFLICT" : mapped.code,
              status: "rejected",
            };
          }
        },
      );
    } catch (error: unknown) {
      throw mapCoreError(error) ?? error;
    }
    return this.operationalOutcome(outcome, "TASK_PAUSE_CONFLICT");
  }

  async resumeTask(
    taskId: string,
    input: ResumeDashboardTaskRequest,
    correlationId: string,
  ): Promise<DashboardTaskOperationalCommandResponse> {
    const requestHash = canonicalPayloadHash({
      action: "resume_task",
      taskId,
      taskVersion: input.taskVersion,
    });
    let outcome;
    try {
      outcome = await this.receipts.execute<DashboardTaskOperationalCommandResponse>(
        {
          actor: "user",
          command: "resume_task",
          correlationId,
          expectedVersion: input.taskVersion,
          idempotencyKey: `dashboard:command:${input.idempotencyKey}`,
          requestHash,
          targetTaskId: taskId,
        },
        async (taskStore) => {
          try {
            const task = await this.stateMachineStoreTask(taskStore, taskId);
            if (
              task.state !== "PAUSED" ||
              task.pausedFromState === undefined ||
              !(await taskStore.canResumeTask(task))
            ) {
              return { resultCode: "TASK_RESUME_CONFLICT", status: "rejected" };
            }
            const result = await new TaskStateMachine(taskStore).transition({
              actor: "user",
              correlationId,
              expectedVersion: input.taskVersion,
              idempotencyKey: `dashboard:resume:${input.idempotencyKey}`,
              reasonCode: "owner_resumed",
              requestHash,
              taskId,
              toState: task.pausedFromState,
            });
            return {
              resultCode: "TASK_RESUMED",
              resultPayload: {
                idempotentReplay: result.idempotentReplay,
                task: publicOperationalTask(result.task),
              },
              status: "accepted",
            };
          } catch (error: unknown) {
            const mapped = mapCoreError(error);
            if (mapped === undefined) throw error;
            return { resultCode: mapped.code, status: "rejected" };
          }
        },
      );
    } catch (error: unknown) {
      throw mapCoreError(error) ?? error;
    }
    return this.operationalOutcome(outcome, "TASK_RESUME_CONFLICT");
  }

  async setTaskPriority(
    taskId: string,
    input: SetDashboardTaskPriorityRequest,
    correlationId: string,
  ): Promise<DashboardTaskOperationalCommandResponse> {
    const requestHash = canonicalPayloadHash({
      action: "set_task_priority",
      priority: input.priority,
      taskId,
      taskVersion: input.taskVersion,
    });
    let outcome;
    try {
      outcome = await this.receipts.execute<DashboardTaskOperationalCommandResponse>(
        {
          actor: "user",
          command: "set_task_priority",
          correlationId,
          expectedVersion: input.taskVersion,
          idempotencyKey: `dashboard:command:${input.idempotencyKey}`,
          requestHash,
          targetTaskId: taskId,
        },
        async (taskStore) => {
          try {
            const task = await taskStore.setTaskPriority({
              correlationId,
              expectedVersion: input.taskVersion,
              idempotencyKey: `dashboard:priority:${input.idempotencyKey}`,
              priority: input.priority,
              requestHash,
              taskId,
            });
            return {
              resultCode: "TASK_PRIORITY_UPDATED",
              resultPayload: {
                idempotentReplay: false,
                task: publicOperationalTask(task),
              },
              status: "accepted",
            };
          } catch (error: unknown) {
            const mapped = mapCoreError(error);
            if (mapped === undefined) throw error;
            return { resultCode: mapped.code, status: "rejected" };
          }
        },
      );
    } catch (error: unknown) {
      throw mapCoreError(error) ?? error;
    }
    return this.operationalOutcome(outcome, "TASK_PRIORITY_CONFLICT");
  }

  private operationalOutcome(
    outcome:
      | {
          readonly idempotentReplay: boolean;
          readonly resultCode: string;
          readonly resultPayload: DashboardTaskOperationalCommandResponse;
          readonly status: "accepted";
        }
      | {
          readonly idempotentReplay: boolean;
          readonly resultCode: string;
          readonly status: "rejected";
        },
    fallback: DashboardTaskCommandErrorCode,
  ): DashboardTaskOperationalCommandResponse {
    if (outcome.status === "rejected") {
      throw new DashboardTaskCommandError(this.rejectedCode(outcome.resultCode, fallback));
    }
    const response = dashboardTaskOperationalCommandResponseSchema.parse(outcome.resultPayload);
    return outcome.idempotentReplay ? replayed(response) : response;
  }

  private rejectedCode(
    resultCode: string,
    fallback: DashboardTaskCommandErrorCode,
  ): DashboardTaskCommandErrorCode {
    const codes = new Set<DashboardTaskCommandErrorCode>([
      "DASHBOARD_IDEMPOTENCY_CONFLICT",
      "DASHBOARD_PROJECT_NOT_ELIGIBLE",
      "TASK_CANCEL_CONFLICT",
      "TASK_NOT_FOUND",
      "TASK_PAUSE_CONFLICT",
      "TASK_PRIORITY_CONFLICT",
      "TASK_RESUME_CONFLICT",
      "TASK_VERSION_CONFLICT",
    ]);
    return codes.has(resultCode as DashboardTaskCommandErrorCode)
      ? (resultCode as DashboardTaskCommandErrorCode)
      : fallback;
  }

  private async stateMachineStoreTask(
    taskStore: { getTask(taskId: string): Promise<TaskSnapshot | undefined> },
    taskId: string,
  ): Promise<TaskSnapshot> {
    const task = await taskStore.getTask(taskId);
    if (task === undefined) throw new TaskNotFoundError(taskId);
    return task;
  }
}
