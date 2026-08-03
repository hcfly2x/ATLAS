import type { AuditActor, TaskPauseOrigin, TaskPriority, TaskState } from "@atlas/shared";

export * from "./enforcement.js";

export interface TaskSnapshot {
  readonly id: string;
  readonly projectId: string;
  readonly pausedFromState?: TaskPauseOrigin;
  readonly priority?: TaskPriority;
  readonly state: TaskState;
  readonly version: number;
  readonly failureStage?: string;
}

export interface TransitionTaskCommand {
  readonly actor: AuditActor;
  readonly correlationId: string;
  readonly expectedVersion: number;
  readonly failureStage?: string;
  readonly idempotencyKey: string;
  readonly reasonCode?: string;
  readonly requestHash?: string;
  readonly taskId: string;
  readonly toState: TaskState;
}

export interface TaskTransitionResult {
  readonly auditEventId: string;
  readonly fromState: TaskState;
  readonly idempotentReplay: boolean;
  readonly task: TaskSnapshot;
}

export interface CreateTaskInput {
  readonly actor?: AuditActor;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly origin: string;
  readonly originalMessage: string;
  readonly projectId: string;
  readonly requestHash?: string;
  readonly requireActiveProject?: boolean;
}

export interface CreateTaskResult {
  readonly auditEventId: string;
  readonly idempotentReplay: boolean;
  readonly task: TaskSnapshot;
}

export interface RejectedTransition {
  readonly actualVersion?: number;
  readonly actor: AuditActor;
  readonly correlationId: string;
  readonly expectedVersion: number;
  readonly fromState: TaskState;
  readonly idempotencyKey: string;
  readonly projectId: string;
  readonly reasonCode?: string;
  readonly requestHash?: string;
  readonly reason: "failure_stage_required" | "invalid_transition" | "version_conflict";
  readonly taskId: string;
  readonly toState: TaskState;
}

export interface CommitTransitionInput extends TransitionTaskCommand {
  readonly fromState: TaskState;
  readonly pausedFromState?: TaskPauseOrigin | null;
  readonly projectId: string;
}

export interface TaskTransitionStore {
  findReplay(
    idempotencyKey: string,
    requestHash?: string,
  ): Promise<TaskTransitionResult | undefined>;
  getTask(taskId: string): Promise<TaskSnapshot | undefined>;
  commitTransition(input: CommitTransitionInput): Promise<TaskTransitionResult>;
  recordRejectedTransition(input: RejectedTransition): Promise<void>;
}

export interface TaskCoreStore extends TaskTransitionStore {
  createTask(input: CreateTaskInput): Promise<CreateTaskResult>;
}

export class TaskNotFoundError extends Error {
  constructor(taskId: string) {
    super(`Task not found: ${taskId}`);
    this.name = "TaskNotFoundError";
  }
}

export class InvalidTaskTransitionError extends Error {
  constructor(
    readonly fromState: TaskState,
    readonly toState: TaskState,
  ) {
    super(`Invalid task transition: ${fromState} -> ${toState}`);
    this.name = "InvalidTaskTransitionError";
  }
}

export class TaskVersionConflictError extends Error {
  constructor(
    readonly expectedVersion: number,
    readonly actualVersion: number,
  ) {
    super(
      `Task version conflict: expected ${String(expectedVersion)}, found ${String(actualVersion)}`,
    );
    this.name = "TaskVersionConflictError";
  }
}

export class TaskIdempotencyConflictError extends Error {
  constructor() {
    super("Idempotency key was already used for a different request");
    this.name = "TaskIdempotencyConflictError";
  }
}

export class TaskProjectNotEligibleError extends Error {
  constructor() {
    super("Project is not eligible for task creation");
    this.name = "TaskProjectNotEligibleError";
  }
}

export class TaskFailureStageRequiredError extends Error {
  constructor() {
    super("failureStage is required when transitioning to FAILED");
    this.name = "TaskFailureStageRequiredError";
  }
}

const transitions = {
  NEW: ["NORMALIZING", "CANCELLED"],
  NORMALIZING: ["ROUTING", "FAILED", "CANCELLED"],
  ROUTING: ["SPECIFYING", "FAILED", "CANCELLED"],
  SPECIFYING: ["WAITING_APPROVAL", "QUEUED", "FAILED", "CANCELLED"],
  WAITING_APPROVAL: ["QUEUED", "CANCELLED", "PAUSED"],
  QUEUED: ["RUNNING", "FAILED", "CANCELLED", "PAUSED"],
  RUNNING: ["TESTING", "FAILED", "CANCEL_REQUESTED"],
  TESTING: ["WAITING_RESULT_APPROVAL", "FINALIZING", "FAILED", "CANCEL_REQUESTED"],
  WAITING_RESULT_APPROVAL: ["FINALIZING", "SPECIFYING", "CANCEL_REQUESTED"],
  FINALIZING: ["COMPLETED", "FAILED", "CANCEL_REQUESTED"],
  CANCEL_REQUESTED: ["CANCELLED", "FAILED"],
  FAILED: ["QUEUED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
  PAUSED: ["WAITING_APPROVAL", "QUEUED", "CANCELLED"],
} as const satisfies Record<TaskState, readonly TaskState[]>;

export function canTransition(fromState: TaskState, toState: TaskState): boolean {
  return transitions[fromState].some((candidate) => candidate === toState);
}

export class TaskStateMachine {
  constructor(private readonly store: TaskTransitionStore) {}

  async transition(command: TransitionTaskCommand): Promise<TaskTransitionResult> {
    const replay = await this.store.findReplay(command.idempotencyKey, command.requestHash);
    if (replay !== undefined) {
      return { ...replay, idempotentReplay: true };
    }

    const task = await this.store.getTask(command.taskId);
    if (task === undefined) {
      throw new TaskNotFoundError(command.taskId);
    }

    if (task.version !== command.expectedVersion) {
      await this.store.recordRejectedTransition({
        ...command,
        actualVersion: task.version,
        fromState: task.state,
        projectId: task.projectId,
        reason: "version_conflict",
      });
      throw new TaskVersionConflictError(command.expectedVersion, task.version);
    }

    if (!canTransition(task.state, command.toState)) {
      await this.store.recordRejectedTransition({
        ...command,
        fromState: task.state,
        projectId: task.projectId,
        reason: "invalid_transition",
      });
      throw new InvalidTaskTransitionError(task.state, command.toState);
    }

    if (
      task.state === "PAUSED" &&
      command.toState !== "CANCELLED" &&
      task.pausedFromState !== command.toState
    ) {
      await this.store.recordRejectedTransition({
        ...command,
        fromState: task.state,
        projectId: task.projectId,
        reason: "invalid_transition",
      });
      throw new InvalidTaskTransitionError(task.state, command.toState);
    }

    if (command.toState === "FAILED" && command.failureStage === undefined) {
      await this.store.recordRejectedTransition({
        ...command,
        fromState: task.state,
        projectId: task.projectId,
        reason: "failure_stage_required",
      });
      throw new TaskFailureStageRequiredError();
    }

    return this.store.commitTransition({
      ...command,
      fromState: task.state,
      ...(command.toState === "PAUSED"
        ? task.state === "WAITING_APPROVAL" || task.state === "QUEUED"
          ? { pausedFromState: task.state }
          : {}
        : task.state === "PAUSED"
          ? { pausedFromState: null }
          : {}),
      projectId: task.projectId,
    });
  }
}
