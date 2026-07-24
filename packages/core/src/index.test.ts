import { describe, expect, it } from "vitest";

import type {
  CommitTransitionInput,
  RejectedTransition,
  TaskSnapshot,
  TaskTransitionResult,
  TaskTransitionStore,
} from "./index.js";
import {
  InvalidTaskTransitionError,
  TaskFailureStageRequiredError,
  TaskStateMachine,
  TaskVersionConflictError,
  canTransition,
} from "./index.js";

class InMemoryTransitionStore implements TaskTransitionStore {
  readonly rejected: RejectedTransition[] = [];
  readonly replays = new Map<string, TaskTransitionResult>();

  constructor(readonly tasks: Map<string, TaskSnapshot>) {}

  findReplay(idempotencyKey: string): Promise<TaskTransitionResult | undefined> {
    return Promise.resolve(this.replays.get(idempotencyKey));
  }

  getTask(taskId: string): Promise<TaskSnapshot | undefined> {
    return Promise.resolve(this.tasks.get(taskId));
  }

  commitTransition(input: CommitTransitionInput): Promise<TaskTransitionResult> {
    const task: TaskSnapshot = {
      id: input.taskId,
      projectId: input.projectId,
      state: input.toState,
      version: input.expectedVersion + 1,
      ...(input.failureStage === undefined ? {} : { failureStage: input.failureStage }),
    };
    this.tasks.set(task.id, task);
    const result = {
      auditEventId: `audit-${input.idempotencyKey}`,
      fromState: input.fromState,
      idempotentReplay: false,
      task,
    };
    this.replays.set(input.idempotencyKey, result);
    return Promise.resolve(result);
  }

  recordRejectedTransition(input: RejectedTransition): Promise<void> {
    this.rejected.push(input);
    return Promise.resolve();
  }
}

const baseTask: TaskSnapshot = {
  id: "task-1",
  projectId: "atlas",
  state: "NEW",
  version: 0,
};

describe("TaskStateMachine", () => {
  it("implements the canonical transition graph", () => {
    expect(canTransition("NEW", "NORMALIZING")).toBe(true);
    expect(canTransition("WAITING_RESULT_APPROVAL", "SPECIFYING")).toBe(true);
    expect(canTransition("FINALIZING", "COMPLETED")).toBe(true);
    expect(canTransition("COMPLETED", "NEW")).toBe(false);
  });

  it("changes state and records an idempotent result", async () => {
    const store = new InMemoryTransitionStore(new Map([[baseTask.id, baseTask]]));
    const machine = new TaskStateMachine(store);
    const command = {
      actor: "system" as const,
      correlationId: "correlation-1",
      expectedVersion: 0,
      idempotencyKey: "transition-1",
      taskId: baseTask.id,
      toState: "NORMALIZING" as const,
    };

    const first = await machine.transition(command);
    const replay = await machine.transition(command);

    expect(first.task).toMatchObject({ state: "NORMALIZING", version: 1 });
    expect(first.idempotentReplay).toBe(false);
    expect(replay.idempotentReplay).toBe(true);
  });

  it("rejects an invalid transition and audits the rejection", async () => {
    const store = new InMemoryTransitionStore(new Map([[baseTask.id, baseTask]]));
    const machine = new TaskStateMachine(store);

    await expect(
      machine.transition({
        actor: "system",
        correlationId: "correlation-2",
        expectedVersion: 0,
        idempotencyKey: "invalid-1",
        taskId: baseTask.id,
        toState: "COMPLETED",
      }),
    ).rejects.toBeInstanceOf(InvalidTaskTransitionError);
    expect(store.rejected).toHaveLength(1);
  });

  it("rejects stale versions and audits the conflict", async () => {
    const store = new InMemoryTransitionStore(
      new Map([[baseTask.id, { ...baseTask, version: 2 }]]),
    );
    const machine = new TaskStateMachine(store);

    await expect(
      machine.transition({
        actor: "system",
        correlationId: "correlation-3",
        expectedVersion: 1,
        idempotencyKey: "conflict-1",
        taskId: baseTask.id,
        toState: "NORMALIZING",
      }),
    ).rejects.toBeInstanceOf(TaskVersionConflictError);
    expect(store.rejected).toHaveLength(1);
  });

  it("requires failureStage for terminal failures", async () => {
    const runningTask = { ...baseTask, state: "RUNNING" as const };
    const store = new InMemoryTransitionStore(new Map([[runningTask.id, runningTask]]));
    const machine = new TaskStateMachine(store);

    await expect(
      machine.transition({
        actor: "worker",
        correlationId: "correlation-4",
        expectedVersion: 0,
        idempotencyKey: "failure-without-stage",
        taskId: runningTask.id,
        toState: "FAILED",
      }),
    ).rejects.toBeInstanceOf(TaskFailureStageRequiredError);
    expect(store.rejected[0]?.reason).toBe("failure_stage_required");
  });
});
