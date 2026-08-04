import { describe, expect, it, vi } from "vitest";

import {
  TaskIdempotencyConflictError,
  TaskProjectNotEligibleError,
  type CommitTransitionInput,
  type TaskTransitionResult,
} from "@atlas/core";
import type { TaskState } from "@atlas/shared";

import type { TaskIntakeService } from "../tasks/intake.js";
import type {
  DashboardCommandReceiptStore,
  DashboardCommandTaskStore,
} from "./command-receipt-store.js";
import { DashboardTaskCommandError, DashboardTaskCommandService } from "./task-command-service.js";

const taskId = "10000000-0000-4000-8000-000000000001";

function store(
  state: TaskState = "RUNNING",
  options: { pausedFromState?: "WAITING_APPROVAL" | "QUEUED"; priority?: 0 | 10 | 20 } = {},
) {
  const createTask = vi.fn();
  const findReplay = vi.fn().mockResolvedValue(undefined);
  const getTask = vi.fn().mockResolvedValue({
    id: taskId,
    projectId: "atlas",
    ...(options.pausedFromState === undefined ? {} : { pausedFromState: options.pausedFromState }),
    priority: options.priority ?? 0,
    state,
    version: 7,
  });
  const commitTransition = vi.fn((input: CommitTransitionInput): Promise<TaskTransitionResult> =>
    Promise.resolve({
      auditEventId: "audit",
      fromState: input.fromState,
      idempotentReplay: false,
      task: {
        id: taskId,
        ...(input.toState === "PAUSED"
          ? { pausedFromState: input.fromState as "WAITING_APPROVAL" | "QUEUED" }
          : {}),
        priority: options.priority ?? 0,
        projectId: "atlas",
        state: input.toState,
        version: 8,
      },
    }),
  );
  const canResumeTask = vi.fn().mockResolvedValue(true);
  const setTaskPriority = vi.fn().mockResolvedValue({
    id: taskId,
    priority: 20,
    projectId: "atlas",
    state,
    version: 8,
  });
  const taskStore = {
    canResumeTask,
    commitTransition,
    createTask,
    findReplay,
    getTask,
    recordRejectedTransition: vi.fn(),
    setTaskPriority,
  } as unknown as DashboardCommandTaskStore;
  return { canResumeTask, commitTransition, createTask, findReplay, setTaskPriority, taskStore };
}

function receipts(taskStore: DashboardCommandTaskStore) {
  const results: unknown[] = [];
  const execute = vi.fn(
    async (
      _input: unknown,
      operation: (store: DashboardCommandTaskStore) => Promise<Record<string, unknown>>,
    ) => {
      const result = await operation(taskStore);
      results.push(result);
      return { ...result, idempotentReplay: false };
    },
  );
  return {
    execute,
    receiptStore: { execute } as unknown as DashboardCommandReceiptStore,
    results,
  };
}

describe("DashboardTaskCommandService", () => {
  it("creates through the shared intake with a USER audit boundary and dashboard origin", async () => {
    const { createTask, taskStore } = store();
    createTask.mockResolvedValue({
      auditEventId: "audit",
      idempotentReplay: false,
      task: { id: taskId, projectId: "atlas", state: "NEW", version: 0 },
    });
    const notifyTaskCreated = vi.fn();
    const { receiptStore } = receipts(taskStore);
    const service = new DashboardTaskCommandService(
      { notifyTaskCreated } as unknown as TaskIntakeService,
      receiptStore,
    );

    await expect(
      service.createDemand(
        {
          idempotencyKey: "11111111-1111-4111-8111-111111111111",
          objective: "Criar demanda",
          projectId: "atlas",
        },
        "correlation",
      ),
    ).resolves.toMatchObject({ idempotentReplay: false, task: { state: "NEW" } });
    expect(createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: "user",
        idempotencyKey: "dashboard:demand:11111111-1111-4111-8111-111111111111",
        origin: "dashboard:owner",
        originalMessage: "Criar demanda",
        requireActiveProject: true,
      }),
    );
    expect(JSON.stringify(createTask.mock.calls[0]?.[0])).not.toContain("payload");
    expect(notifyTaskCreated).toHaveBeenCalledWith(taskId, "correlation");
  });

  it.each([
    ["NEW", "CANCELLED", "immediate"],
    ["NORMALIZING", "CANCELLED", "immediate"],
    ["ROUTING", "CANCELLED", "immediate"],
    ["SPECIFYING", "CANCELLED", "immediate"],
    ["WAITING_APPROVAL", "CANCELLED", "immediate"],
    ["QUEUED", "CANCELLED", "immediate"],
    ["FAILED", "CANCELLED", "immediate"],
    ["RUNNING", "CANCEL_REQUESTED", "cooperative"],
    ["TESTING", "CANCEL_REQUESTED", "cooperative"],
    ["WAITING_RESULT_APPROVAL", "CANCEL_REQUESTED", "cooperative"],
    ["FINALIZING", "CANCEL_REQUESTED", "cooperative"],
  ] as const)("maps %s through the state machine to %s", async (state, target, mode) => {
    const { commitTransition, taskStore } = store(state);
    const { receiptStore } = receipts(taskStore);
    const service = new DashboardTaskCommandService(
      { create: vi.fn() } as unknown as TaskIntakeService,
      receiptStore,
    );

    await expect(
      service.cancelTask(
        taskId,
        {
          idempotencyKey: "22222222-2222-4222-8222-222222222222",
          reason: "Motivo seguro",
          taskVersion: 7,
        },
        "correlation",
      ),
    ).resolves.toMatchObject({ mode, task: { state: target } });
    expect(commitTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: "user",
        reasonCode: "owner_cancelled_with_reason",
        toState: target,
      }),
    );
    expect(JSON.stringify(commitTransition.mock.calls)).not.toContain("Motivo seguro");
  });

  it.each(["CANCEL_REQUESTED", "COMPLETED", "CANCELLED"] as const)(
    "rejects cancellation from %s without a transition and binds the rejection",
    async (state) => {
      const { commitTransition, taskStore } = store(state);
      const { receiptStore, results } = receipts(taskStore);
      const service = new DashboardTaskCommandService(
        { create: vi.fn() } as unknown as TaskIntakeService,
        receiptStore,
      );

      await expect(
        service.cancelTask(
          taskId,
          {
            idempotencyKey: "22222222-2222-4222-8222-222222222222",
            taskVersion: 7,
          },
          "correlation",
        ),
      ).rejects.toMatchObject({ code: "TASK_CANCEL_CONFLICT" });
      expect(commitTransition).not.toHaveBeenCalled();
      expect(results).toContainEqual({ resultCode: "TASK_CANCEL_CONFLICT", status: "rejected" });
    },
  );

  it("fails closed on divergent idempotency and ineligible projects", async () => {
    const { createTask, taskStore } = store();
    createTask.mockRejectedValue(new TaskProjectNotEligibleError());
    const createReceipts = receipts(taskStore);
    const cancelReceipts = receipts(taskStore);
    cancelReceipts.execute.mockRejectedValue(new TaskIdempotencyConflictError());
    const service = new DashboardTaskCommandService(
      { notifyTaskCreated: vi.fn() } as unknown as TaskIntakeService,
      createReceipts.receiptStore,
    );

    await expect(
      service.createDemand(
        {
          idempotencyKey: "11111111-1111-4111-8111-111111111111",
          objective: "Criar demanda",
          projectId: "archived",
        },
        "correlation",
      ),
    ).rejects.toEqual(new DashboardTaskCommandError("DASHBOARD_PROJECT_NOT_ELIGIBLE"));
    expect(createReceipts.results).toContainEqual(
      expect.objectContaining({ resultCode: "DASHBOARD_PROJECT_NOT_ELIGIBLE" }),
    );
    const cancelService = new DashboardTaskCommandService(
      { create: vi.fn() } as unknown as TaskIntakeService,
      cancelReceipts.receiptStore,
    );
    await expect(
      cancelService.cancelTask(
        taskId,
        {
          idempotencyKey: "22222222-2222-4222-8222-222222222222",
          taskVersion: 7,
        },
        "correlation",
      ),
    ).rejects.toEqual(new DashboardTaskCommandError("DASHBOARD_IDEMPOTENCY_CONFLICT"));
  });

  it("replays a persisted rejection and never reaches the state machine", async () => {
    const { commitTransition, taskStore } = store("RUNNING");
    const { execute, receiptStore } = receipts(taskStore);
    execute.mockResolvedValue({
      idempotentReplay: true,
      resultCode: "TASK_VERSION_CONFLICT",
      status: "rejected",
    } as never);
    const service = new DashboardTaskCommandService(
      { create: vi.fn() } as unknown as TaskIntakeService,
      receiptStore,
    );

    await expect(
      service.cancelTask(
        taskId,
        {
          idempotencyKey: "22222222-2222-4222-8222-222222222222",
          taskVersion: 6,
        },
        "correlation",
      ),
    ).rejects.toEqual(new DashboardTaskCommandError("TASK_VERSION_CONFLICT"));
    expect(commitTransition).not.toHaveBeenCalled();
  });

  it.each(["WAITING_APPROVAL", "QUEUED"] as const)(
    "pauses %s through the canonical state machine with derived origin",
    async (state) => {
      const { commitTransition, taskStore } = store(state);
      const service = new DashboardTaskCommandService(
        { create: vi.fn() } as unknown as TaskIntakeService,
        receipts(taskStore).receiptStore,
      );
      await expect(
        service.pauseTask(
          taskId,
          {
            idempotencyKey: "33333333-3333-4333-8333-333333333333",
            taskVersion: 7,
          },
          "correlation",
        ),
      ).resolves.toMatchObject({
        task: { pausedFromState: state, state: "PAUSED", version: 8 },
      });
      expect(commitTransition).toHaveBeenCalledWith(
        expect.objectContaining({ pausedFromState: state, toState: "PAUSED" }),
      );
    },
  );

  it.each(["WAITING_APPROVAL", "QUEUED"] as const)(
    "resumes only to the persisted %s origin",
    async (pausedFromState) => {
      const { commitTransition, taskStore } = store("PAUSED", { pausedFromState });
      const service = new DashboardTaskCommandService(
        { create: vi.fn() } as unknown as TaskIntakeService,
        receipts(taskStore).receiptStore,
      );
      await expect(
        service.resumeTask(
          taskId,
          {
            idempotencyKey: "44444444-4444-4444-8444-444444444444",
            taskVersion: 7,
          },
          "correlation",
        ),
      ).resolves.toMatchObject({ task: { pausedFromState: null, state: pausedFromState } });
      expect(commitTransition).toHaveBeenCalledWith(
        expect.objectContaining({ pausedFromState: null, toState: pausedFromState }),
      );
    },
  );

  it("binds invalid resume and priority outcomes without mutating the task", async () => {
    const resume = store("PAUSED", { pausedFromState: "QUEUED" });
    resume.canResumeTask.mockResolvedValue(false);
    const resumeReceipts = receipts(resume.taskStore);
    const resumeService = new DashboardTaskCommandService(
      { create: vi.fn() } as unknown as TaskIntakeService,
      resumeReceipts.receiptStore,
    );
    await expect(
      resumeService.resumeTask(
        taskId,
        {
          idempotencyKey: "44444444-4444-4444-8444-444444444444",
          taskVersion: 7,
        },
        "correlation",
      ),
    ).rejects.toMatchObject({ code: "TASK_RESUME_CONFLICT" });
    expect(resume.commitTransition).not.toHaveBeenCalled();
    expect(resumeReceipts.results).toContainEqual({
      resultCode: "TASK_RESUME_CONFLICT",
      status: "rejected",
    });

    const priority = store("RUNNING");
    priority.taskStore.setTaskPriority = vi
      .fn()
      .mockRejectedValue(new DashboardTaskCommandError("TASK_PRIORITY_CONFLICT"));
    const priorityReceipts = receipts(priority.taskStore);
    const priorityService = new DashboardTaskCommandService(
      { create: vi.fn() } as unknown as TaskIntakeService,
      priorityReceipts.receiptStore,
    );
    await expect(
      priorityService.setTaskPriority(
        taskId,
        {
          idempotencyKey: "55555555-5555-4555-8555-555555555555",
          priority: 20,
          taskVersion: 7,
        },
        "correlation",
      ),
    ).rejects.toMatchObject({ code: "TASK_PRIORITY_CONFLICT" });
    expect(priorityReceipts.results).toContainEqual({
      resultCode: "TASK_PRIORITY_CONFLICT",
      status: "rejected",
    });
  });

  it("sets priority through the receipt store without changing state", async () => {
    const { setTaskPriority, taskStore } = store("QUEUED");
    const service = new DashboardTaskCommandService(
      { create: vi.fn() } as unknown as TaskIntakeService,
      receipts(taskStore).receiptStore,
    );
    await expect(
      service.setTaskPriority(
        taskId,
        {
          idempotencyKey: "55555555-5555-4555-8555-555555555555",
          priority: 20,
          taskVersion: 7,
        },
        "correlation",
      ),
    ).resolves.toMatchObject({ task: { priority: 20, state: "QUEUED", version: 8 } });
    expect(setTaskPriority).toHaveBeenCalledWith(
      expect.objectContaining({ priority: 20, taskId, expectedVersion: 7 }),
    );
  });
});
