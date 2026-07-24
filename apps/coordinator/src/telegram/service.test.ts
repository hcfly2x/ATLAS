import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type {
  CommitTransitionInput,
  CreateTaskInput,
  CreateTaskResult,
  TaskCoreStore,
  TaskSnapshot,
  TaskTransitionResult,
} from "@atlas/core";

import { TelegramGateway, TelegramUnauthorizedError } from "./service.js";
import type {
  ApprovalDecisionResult,
  TelegramProject,
  TelegramStore,
  TelegramTaskStatus,
} from "./store.js";
import type { TelegramResponse } from "./types.js";

class InMemoryTaskStore implements TaskCoreStore {
  readonly tasks = new Map<string, TaskSnapshot>();
  readonly creations = new Map<string, CreateTaskResult>();
  readonly transitions = new Map<string, TaskTransitionResult>();
  createCalls = 0;

  createTask(input: CreateTaskInput): Promise<CreateTaskResult> {
    const existing = this.creations.get(input.idempotencyKey);
    if (existing !== undefined) {
      return Promise.resolve({ ...existing, idempotentReplay: true });
    }
    this.createCalls += 1;
    const task: TaskSnapshot = {
      id: randomUUID(),
      projectId: input.projectId,
      state: "NEW",
      version: 0,
    };
    const result = { auditEventId: randomUUID(), idempotentReplay: false, task };
    this.tasks.set(task.id, task);
    this.creations.set(input.idempotencyKey, result);
    return Promise.resolve(result);
  }

  findReplay(idempotencyKey: string): Promise<TaskTransitionResult | undefined> {
    return Promise.resolve(this.transitions.get(idempotencyKey));
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
    };
    const result = {
      auditEventId: randomUUID(),
      fromState: input.fromState,
      idempotentReplay: false,
      task,
    };
    this.tasks.set(task.id, task);
    this.transitions.set(input.idempotencyKey, result);
    return Promise.resolve(result);
  }

  recordRejectedTransition(): Promise<void> {
    return Promise.resolve();
  }
}

class InMemoryTelegramStore implements TelegramStore {
  readonly processed = new Map<bigint, readonly TelegramResponse[]>();
  readonly projects: TelegramProject[] = [{ id: "atlas", name: "ATLAS" }];
  selected: TelegramProject | undefined;
  status: TelegramTaskStatus | undefined;
  decision: ApprovalDecisionResult | undefined;
  verboseLevel = 0;

  findProcessedUpdate(updateId: bigint): Promise<readonly TelegramResponse[] | undefined> {
    return Promise.resolve(this.processed.get(updateId));
  }

  recordProcessedUpdate(input: {
    responses: readonly TelegramResponse[];
    updateId: bigint;
  }): Promise<{
    idempotentReplay: boolean;
    responses: readonly TelegramResponse[];
  }> {
    const existing = this.processed.get(input.updateId);
    if (existing !== undefined) {
      return Promise.resolve({ idempotentReplay: true, responses: existing });
    }
    this.processed.set(input.updateId, input.responses);
    return Promise.resolve({ idempotentReplay: false, responses: input.responses });
  }

  listProjects(): Promise<readonly TelegramProject[]> {
    return Promise.resolve(this.projects);
  }

  selectProject(...args: [bigint, bigint, string]): Promise<TelegramProject> {
    const projectId = args[2];
    const project = this.projects.find((candidate) => candidate.id === projectId);
    if (project === undefined) {
      return Promise.reject(new Error("project not found"));
    }
    this.selected = project;
    return Promise.resolve(project);
  }

  getSelectedProject(): Promise<TelegramProject | undefined> {
    return Promise.resolve(this.selected);
  }

  setVerboseLevel(_userId: bigint, _chatId: bigint, level: 0 | 1 | 2): Promise<number> {
    this.verboseLevel = level;
    return Promise.resolve(level);
  }

  findTaskStatus(): Promise<TelegramTaskStatus | undefined> {
    return Promise.resolve(this.status);
  }

  decideApproval(): Promise<ApprovalDecisionResult> {
    if (this.decision === undefined) {
      return Promise.reject(new Error("approval decision not configured"));
    }
    return Promise.resolve(this.decision);
  }
}

function messageUpdate(updateId: number, text: string, userId = 42): unknown {
  return {
    message: {
      chat: { id: 100 },
      from: { id: userId },
      message_id: updateId,
      text,
    },
    update_id: updateId,
  };
}

function callbackUpdate(updateId: number, data: string): unknown {
  return {
    callback_query: {
      data,
      from: { id: 42 },
      id: `callback-${String(updateId)}`,
      message: { chat: { id: 100 }, message_id: updateId },
    },
    update_id: updateId,
  };
}

describe("TelegramGateway", () => {
  it("authorizes one Telegram user and creates a Task idempotently after project selection", async () => {
    const store = new InMemoryTelegramStore();
    const taskStore = new InMemoryTaskStore();
    const gateway = new TelegramGateway({ allowedUserId: 42n, store, taskStore });

    await gateway.handle(callbackUpdate(1, "project:atlas"), "correlation-project");
    const created = await gateway.handle(
      messageUpdate(2, "Criar uma tarefa"),
      "correlation-create",
    );
    const replay = await gateway.handle(messageUpdate(2, "Criar uma tarefa"), "correlation-replay");

    expect(created.responses[0]?.text).toContain("Task criada");
    expect(replay.replayed).toBe(true);
    expect(taskStore.createCalls).toBe(1);
    await expect(
      gateway.handle(messageUpdate(3, "negado", 99), "correlation-forbidden"),
    ).rejects.toBeInstanceOf(TelegramUnauthorizedError);
  });

  it("presents versioned approval targets and advances an approved Task", async () => {
    const store = new InMemoryTelegramStore();
    const taskStore = new InMemoryTaskStore();
    const task: TaskSnapshot = {
      id: randomUUID(),
      projectId: "atlas",
      state: "WAITING_APPROVAL",
      version: 4,
    };
    taskStore.tasks.set(task.id, task);
    const approvalId = "11111111-1111-4111-8111-111111111111";
    store.status = {
      approvals: [
        {
          id: approvalId,
          targetHash: "sha256:abc",
          targetId: "specification-1",
          targetType: "SPECIFICATION",
          targetVersion: 2,
          type: "PRE_EXECUTION",
        },
      ],
      task,
    };
    const approval = store.status.approvals[0];
    if (approval === undefined) {
      throw new Error("approval fixture missing");
    }
    store.decision = {
      approval,
      decision: "APPROVED",
      idempotentReplay: false,
      task,
    };
    const gateway = new TelegramGateway({ allowedUserId: 42n, store, taskStore });

    const status = await gateway.handle(
      messageUpdate(10, `/status ${task.id}`),
      "correlation-status",
    );
    const decision = await gateway.handle(
      callbackUpdate(11, `approval:${approvalId}:approve`),
      "correlation-approval",
    );
    const replay = await gateway.handle(
      callbackUpdate(11, `approval:${approvalId}:approve`),
      "correlation-approval-replay",
    );

    expect(status.responses[0]?.text).toContain("SPECIFICATION:specification-1@2#sha256:abc");
    expect(status.responses[0]?.buttons?.[0]?.[0]?.callbackData).toBe(
      `approval:${approvalId}:approve`,
    );
    expect(decision.responses[0]?.text).toContain("Aprovado");
    expect(replay.replayed).toBe(true);
    expect(taskStore.tasks.get(task.id)?.state).toBe("QUEUED");
    expect(taskStore.tasks.get(task.id)?.version).toBe(5);
  });

  it("uses CANCEL_REQUESTED for cooperative cancellation of a running Task", async () => {
    const store = new InMemoryTelegramStore();
    const taskStore = new InMemoryTaskStore();
    const task: TaskSnapshot = {
      id: randomUUID(),
      projectId: "atlas",
      state: "RUNNING",
      version: 3,
    };
    taskStore.tasks.set(task.id, task);
    store.status = { approvals: [], task };
    const gateway = new TelegramGateway({ allowedUserId: 42n, store, taskStore });

    const result = await gateway.handle(
      messageUpdate(20, `/cancel ${task.id}`),
      "correlation-cancel",
    );

    expect(result.responses[0]?.text).toContain("Cancelamento cooperativo");
    expect(taskStore.tasks.get(task.id)?.state).toBe("CANCEL_REQUESTED");
  });

  it("acknowledges unsupported non-text messages without creating a Task", async () => {
    const store = new InMemoryTelegramStore();
    const taskStore = new InMemoryTaskStore();
    const gateway = new TelegramGateway({ allowedUserId: 42n, store, taskStore });

    const result = await gateway.handle(
      {
        message: {
          chat: { id: 100 },
          from: { id: 42 },
          message_id: 30,
        },
        update_id: 30,
      },
      "correlation-non-text",
    );

    expect(result.responses[0]?.text).toContain("Somente mensagens de texto");
    expect(taskStore.createCalls).toBe(0);
  });

  it("persists /verbose 0|1|2 in the Telegram session", async () => {
    const store = new InMemoryTelegramStore();
    const gateway = new TelegramGateway({
      allowedUserId: 42n,
      store,
      taskStore: new InMemoryTaskStore(),
    });

    const response = await gateway.handle(messageUpdate(40, "/verbose 2"), "verbose");

    expect(store.verboseLevel).toBe(2);
    expect(response.responses[0]?.text).toContain("logs do worker");
  });
});
