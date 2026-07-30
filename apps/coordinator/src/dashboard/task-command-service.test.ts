import { describe, expect, it, vi } from "vitest";

import {
  TaskIdempotencyConflictError,
  TaskProjectNotEligibleError,
  type CommitTransitionInput,
  type TaskCoreStore,
  type TaskTransitionResult,
} from "@atlas/core";
import type { TaskState } from "@atlas/shared";

import type { TaskIntakeService } from "../tasks/intake.js";
import type { DashboardCommandReceiptStore } from "./command-receipt-store.js";
import { DashboardTaskCommandError, DashboardTaskCommandService } from "./task-command-service.js";

const taskId = "10000000-0000-4000-8000-000000000001";

function store(state: TaskState = "RUNNING") {
  const createTask = vi.fn();
  const findReplay = vi.fn().mockResolvedValue(undefined);
  const getTask = vi.fn().mockResolvedValue({
    id: taskId,
    projectId: "atlas",
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
        projectId: "atlas",
        state: input.toState,
        version: 8,
      },
    }),
  );
  const taskStore = {
    commitTransition,
    createTask,
    findReplay,
    getTask,
    recordRejectedTransition: vi.fn(),
  } as unknown as TaskCoreStore;
  return { commitTransition, createTask, findReplay, taskStore };
}

function receipts(taskStore: TaskCoreStore) {
  const results: unknown[] = [];
  const execute = vi.fn(
    async (
      _input: unknown,
      operation: (store: TaskCoreStore) => Promise<Record<string, unknown>>,
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
});
