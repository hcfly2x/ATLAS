import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import type {
  CommitTransitionInput,
  CreateTaskInput,
  CreateTaskResult,
  RejectedTransition,
  TaskCoreStore,
  TaskSnapshot,
  TaskTransitionResult,
} from "@atlas/core";

import { createCoordinatorApp } from "./app.js";

class InMemoryTaskCoreStore implements TaskCoreStore {
  readonly tasks = new Map<string, TaskSnapshot>();
  readonly transitionReplays = new Map<string, TaskTransitionResult>();
  readonly creationReplays = new Map<string, CreateTaskResult>();
  readonly rejected: RejectedTransition[] = [];

  createTask(input: CreateTaskInput): Promise<CreateTaskResult> {
    const replay = this.creationReplays.get(input.idempotencyKey);
    if (replay !== undefined) {
      return Promise.resolve({ ...replay, idempotentReplay: true });
    }
    const task: TaskSnapshot = {
      id: randomUUID(),
      projectId: input.projectId,
      state: "NEW",
      version: 0,
    };
    this.tasks.set(task.id, task);
    const result = {
      auditEventId: randomUUID(),
      idempotentReplay: false,
      task,
    };
    this.creationReplays.set(input.idempotencyKey, result);
    return Promise.resolve(result);
  }

  findReplay(idempotencyKey: string): Promise<TaskTransitionResult | undefined> {
    return Promise.resolve(this.transitionReplays.get(idempotencyKey));
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
      auditEventId: randomUUID(),
      fromState: input.fromState,
      idempotentReplay: false,
      task,
    };
    this.transitionReplays.set(input.idempotencyKey, result);
    return Promise.resolve(result);
  }

  recordRejectedTransition(input: RejectedTransition): Promise<void> {
    this.rejected.push(input);
    return Promise.resolve();
  }
}

const apps: ReturnType<typeof createCoordinatorApp>[] = [];
const internalAuthToken = "test-internal-token";
const internalAuthHeader = { authorization: `Bearer ${internalAuthToken}` };

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

describe("coordinator core API", () => {
  it("reports health with a correlation id without embedding a log object", async () => {
    const app = createCoordinatorApp({ logger: false });
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/health",
      headers: { "x-correlation-id": "phase-2-health" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      correlationId: "phase-2-health",
      service: "coordinator",
      status: "ok",
    });
  });

  it("creates a Task idempotently and traverses the canonical flow through the internal API", async () => {
    const store = new InMemoryTaskCoreStore();
    const app = createCoordinatorApp({ internalAuthToken, logger: false, taskStore: store });
    apps.push(app);

    const createPayload = {
      idempotencyKey: "create-task-1",
      origin: "internal-test",
      originalMessage: "validate the core flow",
      projectId: "atlas",
    };
    const created = await app.inject({
      method: "POST",
      url: "/internal/tasks",
      headers: { ...internalAuthHeader, "x-correlation-id": "create-correlation" },
      payload: createPayload,
    });
    const replay = await app.inject({
      method: "POST",
      url: "/internal/tasks",
      headers: internalAuthHeader,
      payload: createPayload,
    });

    expect(created.statusCode).toBe(201);
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({ idempotentReplay: true });

    const taskId = zodTaskId(created.json());
    const states = [
      "NORMALIZING",
      "ROUTING",
      "SPECIFYING",
      "QUEUED",
      "RUNNING",
      "TESTING",
      "WAITING_RESULT_APPROVAL",
      "FINALIZING",
      "COMPLETED",
    ] as const;

    for (const [index, toState] of states.entries()) {
      const response = await app.inject({
        method: "POST",
        url: `/internal/tasks/${taskId}/transitions`,
        headers: {
          ...internalAuthHeader,
          "x-correlation-id": `transition-${String(index)}`,
        },
        payload: {
          actor: "system",
          expectedVersion: index,
          idempotencyKey: `transition-${String(index)}`,
          toState,
        },
      });
      expect(response.statusCode).toBe(200);
    }

    expect(store.tasks.get(taskId)).toMatchObject({
      state: "COMPLETED",
      version: states.length,
    });
  });

  it("rejects and audits an invalid transition", async () => {
    const store = new InMemoryTaskCoreStore();
    const app = createCoordinatorApp({ internalAuthToken, logger: false, taskStore: store });
    apps.push(app);
    const created = await app.inject({
      method: "POST",
      url: "/internal/tasks",
      headers: internalAuthHeader,
      payload: {
        idempotencyKey: "create-invalid-test",
        origin: "internal-test",
        originalMessage: "invalid transition",
        projectId: "atlas",
      },
    });

    const response = await app.inject({
      method: "POST",
      url: `/internal/tasks/${zodTaskId(created.json())}/transitions`,
      headers: internalAuthHeader,
      payload: {
        actor: "system",
        expectedVersion: 0,
        idempotencyKey: "invalid-transition",
        toState: "COMPLETED",
      },
    });

    expect(response.statusCode).toBe(422);
    expect(store.rejected).toHaveLength(1);
  });

  it("requires Bearer authentication on internal endpoints", async () => {
    const store = new InMemoryTaskCoreStore();
    const app = createCoordinatorApp({ internalAuthToken, logger: false, taskStore: store });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/internal/tasks",
      payload: {
        idempotencyKey: "unauthorized-create",
        origin: "internal-test",
        originalMessage: "must not be created",
        projectId: "atlas",
      },
    });

    expect(response.statusCode).toBe(401);
    expect(store.tasks.size).toBe(0);
  });

  it("runs the supervisor through an authenticated internal boundary", async () => {
    const store = new InMemoryTaskCoreStore();
    const taskId = randomUUID();
    const calls: { correlationId: string; taskId: string }[] = [];
    const app = createCoordinatorApp({
      internalAuthToken,
      logger: false,
      supervisorService: {
        processTask: (requestedTaskId, correlationId) => {
          calls.push({ correlationId, taskId: requestedTaskId });
          return Promise.resolve({
            approvalId: randomUUID(),
            specificationId: randomUUID(),
            state: "QUEUED",
          });
        },
      },
      taskStore: store,
    });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: `/internal/tasks/${taskId}/supervise`,
      headers: {
        ...internalAuthHeader,
        "x-correlation-id": "supervisor-api-correlation",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ state: "QUEUED" });
    expect(calls).toEqual([{ correlationId: "supervisor-api-correlation", taskId }]);
  });
});

function zodTaskId(payload: unknown): string {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "task" in payload &&
    typeof payload.task === "object" &&
    payload.task !== null &&
    "id" in payload.task &&
    typeof payload.task.id === "string"
  ) {
    return payload.task.id;
  }
  throw new Error("Task id missing from response");
}
