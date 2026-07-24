import type { AuditActor, TaskState } from "@atlas/shared";

export interface TaskSnapshot {
  readonly id: string;
  readonly projectId: string;
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
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly origin: string;
  readonly originalMessage: string;
  readonly projectId: string;
}

export interface CreateTaskResult {
  readonly auditEventId: string;
  readonly idempotentReplay: boolean;
  readonly task: TaskSnapshot;
}

export interface RejectedTransition {
  readonly actor: AuditActor;
  readonly correlationId: string;
  readonly fromState: TaskState;
  readonly idempotencyKey: string;
  readonly projectId: string;
  readonly reason: "failure_stage_required" | "invalid_transition" | "version_conflict";
  readonly taskId: string;
  readonly toState: TaskState;
}

export interface CommitTransitionInput extends TransitionTaskCommand {
  readonly fromState: TaskState;
  readonly projectId: string;
}

export interface TaskTransitionStore {
  findReplay(idempotencyKey: string): Promise<TaskTransitionResult | undefined>;
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
  WAITING_APPROVAL: ["QUEUED", "CANCELLED"],
  QUEUED: ["RUNNING", "FAILED", "CANCELLED"],
  RUNNING: ["TESTING", "FAILED", "CANCEL_REQUESTED"],
  TESTING: ["WAITING_RESULT_APPROVAL", "FAILED", "CANCEL_REQUESTED"],
  WAITING_RESULT_APPROVAL: ["FINALIZING", "SPECIFYING", "CANCEL_REQUESTED"],
  FINALIZING: ["COMPLETED", "FAILED", "CANCEL_REQUESTED"],
  CANCEL_REQUESTED: ["CANCELLED", "FAILED"],
  FAILED: ["QUEUED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
} as const satisfies Record<TaskState, readonly TaskState[]>;

export function canTransition(fromState: TaskState, toState: TaskState): boolean {
  return transitions[fromState].some((candidate) => candidate === toState);
}

export class TaskStateMachine {
  constructor(private readonly store: TaskTransitionStore) {}

  async transition(command: TransitionTaskCommand): Promise<TaskTransitionResult> {
    const replay = await this.store.findReplay(command.idempotencyKey);
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
      projectId: task.projectId,
    });
  }
}
