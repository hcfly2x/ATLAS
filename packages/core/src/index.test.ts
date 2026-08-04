import { describe, expect, it } from "vitest";

import { taskStateSchema, type TaskState } from "@atlas/shared";

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
    const current = this.tasks.get(input.taskId);
    const task: TaskSnapshot = {
      id: input.taskId,
      ...(input.pausedFromState === undefined
        ? current?.pausedFromState === undefined
          ? {}
          : { pausedFromState: current.pausedFromState }
        : input.pausedFromState === null
          ? {}
          : { pausedFromState: input.pausedFromState }),
      ...(current?.priority === undefined ? {} : { priority: current.priority }),
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

const canonicalTransitions = {
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

describe("TaskStateMachine", () => {
  it("characterizes every accepted and rejected edge in the canonical graph", async () => {
    for (const fromState of taskStateSchema.options) {
      for (const toState of taskStateSchema.options) {
        const accepted = canonicalTransitions[fromState].some((candidate) => candidate === toState);
        expect(canTransition(fromState, toState), `${fromState} -> ${toState}`).toBe(accepted);
        const task = {
          ...baseTask,
          ...(fromState === "PAUSED" && (toState === "WAITING_APPROVAL" || toState === "QUEUED")
            ? { pausedFromState: toState }
            : {}),
          state: fromState,
        };
        const store = new InMemoryTransitionStore(new Map([[task.id, task]]));
        const transition = new TaskStateMachine(store).transition({
          actor: "system",
          correlationId: `matrix-${fromState}-${toState}`,
          expectedVersion: 0,
          ...(toState === "FAILED" ? { failureStage: "characterization" } : {}),
          idempotencyKey: `matrix-${fromState}-${toState}`,
          taskId: task.id,
          toState,
        });
        if (accepted) {
          await expect(transition, `${fromState} -> ${toState}`).resolves.toMatchObject({
            fromState,
            task: { state: toState, version: 1 },
          });
          expect(store.rejected).toEqual([]);
        } else {
          await expect(transition, `${fromState} -> ${toState}`).rejects.toBeInstanceOf(
            InvalidTaskTransitionError,
          );
          expect(store.rejected).toEqual([
            expect.objectContaining({ fromState, reason: "invalid_transition", toState }),
          ]);
        }
      }
    }
  });

  it("characterizes PAUSED with exactly the five additive edges", () => {
    expect([...taskStateSchema.options].sort()).toEqual(Object.keys(canonicalTransitions).sort());
    expect(taskStateSchema.safeParse("PAUSED").success).toBe(true);
    expect(canonicalTransitions.WAITING_APPROVAL).toContain("PAUSED");
    expect(canonicalTransitions.QUEUED).toContain("PAUSED");
    expect(canonicalTransitions.PAUSED).toEqual(["WAITING_APPROVAL", "QUEUED", "CANCELLED"]);
  });

  it.each(["WAITING_APPROVAL", "QUEUED"] as const)(
    "records %s as the origin when entering PAUSED and only resumes there",
    async (origin) => {
      const task = { ...baseTask, state: origin };
      const store = new InMemoryTransitionStore(new Map([[task.id, task]]));
      const machine = new TaskStateMachine(store);

      const paused = await machine.transition({
        actor: "user",
        correlationId: `pause-${origin}`,
        expectedVersion: 0,
        idempotencyKey: `pause-${origin}`,
        taskId: task.id,
        toState: "PAUSED",
      });
      expect(paused.task).toMatchObject({ pausedFromState: origin, state: "PAUSED" });

      const resumed = await machine.transition({
        actor: "user",
        correlationId: `resume-${origin}`,
        expectedVersion: 1,
        idempotencyKey: `resume-${origin}`,
        taskId: task.id,
        toState: origin,
      });
      expect(resumed.task.pausedFromState).toBeUndefined();
      expect(resumed.task.state).toBe(origin);
    },
  );

  it("fails closed when a resume destination differs from the stored origin", async () => {
    const task = {
      ...baseTask,
      pausedFromState: "WAITING_APPROVAL" as const,
      state: "PAUSED" as const,
    };
    const store = new InMemoryTransitionStore(new Map([[task.id, task]]));

    await expect(
      new TaskStateMachine(store).transition({
        actor: "user",
        correlationId: "resume-mismatch",
        expectedVersion: 0,
        idempotencyKey: "resume-mismatch",
        taskId: task.id,
        toState: "QUEUED",
      }),
    ).rejects.toBeInstanceOf(InvalidTaskTransitionError);
    expect(store.tasks.get(task.id)).toEqual(task);
    expect(store.rejected).toEqual([
      expect.objectContaining({ reason: "invalid_transition", toState: "QUEUED" }),
    ]);
  });

  it("fails closed when a PAUSED snapshot has no recorded origin", async () => {
    const task = { ...baseTask, state: "PAUSED" as const };
    const store = new InMemoryTransitionStore(new Map([[task.id, task]]));

    await expect(
      new TaskStateMachine(store).transition({
        actor: "user",
        correlationId: "resume-missing-origin",
        expectedVersion: 0,
        idempotencyKey: "resume-missing-origin",
        taskId: task.id,
        toState: "WAITING_APPROVAL",
      }),
    ).rejects.toBeInstanceOf(InvalidTaskTransitionError);
    expect(store.tasks.get(task.id)).toEqual(task);
  });

  it("clears the recorded origin when a PAUSED task is cancelled", async () => {
    const task = {
      ...baseTask,
      pausedFromState: "QUEUED" as const,
      state: "PAUSED" as const,
    };
    const store = new InMemoryTransitionStore(new Map([[task.id, task]]));

    const cancelled = await new TaskStateMachine(store).transition({
      actor: "user",
      correlationId: "cancel-paused",
      expectedVersion: 0,
      idempotencyKey: "cancel-paused",
      taskId: task.id,
      toState: "CANCELLED",
    });

    expect(cancelled.task.state).toBe("CANCELLED");
    expect(cancelled.task).not.toHaveProperty("pausedFromState");
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
    expect(store.rejected).toEqual([
      expect.objectContaining({
        fromState: "NEW",
        reason: "invalid_transition",
        toState: "COMPLETED",
      }),
    ]);
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
    expect(store.rejected).toEqual([
      expect.objectContaining({
        actualVersion: 2,
        expectedVersion: 1,
        reason: "version_conflict",
      }),
    ]);
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
