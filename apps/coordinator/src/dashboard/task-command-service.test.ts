import { describe, expect, it, vi } from "vitest";

import {
  TaskIdempotencyConflictError,
  TaskProjectNotEligibleError,
  type CommitTransitionInput,
  type TaskCoreStore,
  type TaskTransitionResult,
} from "@atlas/core";

import type { TaskIntakeService } from "../tasks/intake.js";
import { DashboardTaskCommandError, DashboardTaskCommandService } from "./task-command-service.js";

const taskId = "10000000-0000-4000-8000-000000000001";

function store(state: "FAILED" | "RUNNING" | "CANCEL_REQUESTED" = "RUNNING") {
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
    createTask: vi.fn(),
    findReplay,
    getTask,
    recordRejectedTransition: vi.fn(),
  } as unknown as TaskCoreStore;
  return { commitTransition, findReplay, taskStore };
}

describe("DashboardTaskCommandService", () => {
  it("creates through the shared intake with a USER audit boundary and dashboard origin", async () => {
    const create = vi.fn().mockResolvedValue({
      auditEventId: "audit",
      idempotentReplay: false,
      task: { id: taskId, projectId: "atlas", state: "NEW", version: 0 },
    });
    const { taskStore } = store();
    const service = new DashboardTaskCommandService(
      { create } as unknown as TaskIntakeService,
      taskStore,
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
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: "user",
        idempotencyKey: "dashboard:demand:11111111-1111-4111-8111-111111111111",
        origin: "dashboard:owner",
        originalMessage: "Criar demanda",
        requireActiveProject: true,
      }),
    );
    expect(JSON.stringify(create.mock.calls[0]?.[0])).not.toContain("payload");
  });

  it.each([
    ["FAILED", "CANCELLED", "immediate"],
    ["RUNNING", "CANCEL_REQUESTED", "cooperative"],
  ] as const)("maps %s through the state machine to %s", async (state, target, mode) => {
    const { commitTransition, taskStore } = store(state);
    const service = new DashboardTaskCommandService(
      { create: vi.fn() } as unknown as TaskIntakeService,
      taskStore,
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

  it("rejects terminal or already requested cancellation without a transition", async () => {
    const { commitTransition, taskStore } = store("CANCEL_REQUESTED");
    const service = new DashboardTaskCommandService(
      { create: vi.fn() } as unknown as TaskIntakeService,
      taskStore,
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
  });

  it("fails closed on divergent idempotency and ineligible projects", async () => {
    const { findReplay, taskStore } = store();
    findReplay.mockRejectedValue(new TaskIdempotencyConflictError());
    const service = new DashboardTaskCommandService(
      {
        create: vi.fn().mockRejectedValue(new TaskProjectNotEligibleError()),
      } as unknown as TaskIntakeService,
      taskStore,
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
    await expect(
      service.cancelTask(
        taskId,
        {
          idempotencyKey: "22222222-2222-4222-8222-222222222222",
          taskVersion: 7,
        },
        "correlation",
      ),
    ).rejects.toEqual(new DashboardTaskCommandError("DASHBOARD_IDEMPOTENCY_CONFLICT"));
  });
});
