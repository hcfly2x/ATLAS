import { randomUUID } from "node:crypto";

import { PrismaClient, ProjectStatus } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { InvalidTaskTransitionError, TaskStateMachine } from "@atlas/core";

import { PrismaTaskCoreStore } from "./prisma-task-core-store.js";
import { PrismaTelegramStore } from "../telegram/store.js";

const prisma = new PrismaClient();
const store = new PrismaTaskCoreStore(prisma);
const machine = new TaskStateMachine(store);
const telegramStore = new PrismaTelegramStore(prisma);

beforeAll(async () => prisma.$connect());
afterAll(async () => prisma.$disconnect());

describe("Prisma core persistence", () => {
  it("persists idempotent Task transitions and append-only audit events atomically", async () => {
    const projectId = `integration-${randomUUID()}`;
    await prisma.project.create({
      data: {
        allowedCommands: [],
        dataClassification: "internal_test",
        id: projectId,
        name: "Integration Test",
        policy: "least_privilege",
        protectedPathsProfile: "project_default",
        requiredTools: {},
        retention: {
          audit_events_expire: false,
          files_days: 1,
          logs_days: 1,
          sensitive_days: null,
        },
        risk: "low",
        status: ProjectStatus.DRAFT,
      },
    });

    const created = await store.createTask({
      correlationId: "integration-create",
      idempotencyKey: `create-${randomUUID()}`,
      origin: "integration-test",
      originalMessage: "test persistence",
      projectId,
    });
    const transitioned = await machine.transition({
      actor: "system",
      correlationId: "integration-transition",
      expectedVersion: 0,
      idempotencyKey: `transition-${randomUUID()}`,
      taskId: created.task.id,
      toState: "NORMALIZING",
    });

    expect(transitioned.task).toMatchObject({ state: "NORMALIZING", version: 1 });
    expect(
      await prisma.auditEvent.count({
        where: { taskId: created.task.id },
      }),
    ).toBe(2);

    await expect(
      machine.transition({
        actor: "system",
        correlationId: "integration-invalid",
        expectedVersion: 1,
        idempotencyKey: `invalid-${randomUUID()}`,
        taskId: created.task.id,
        toState: "COMPLETED",
      }),
    ).rejects.toBeInstanceOf(InvalidTaskTransitionError);
    expect(
      await prisma.auditEvent.count({
        where: {
          action: "task.transition.rejected",
          taskId: created.task.id,
        },
      }),
    ).toBe(1);

    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: { taskId: created.task.id },
    });
    await expect(
      prisma.auditEvent.update({
        where: { id: audit.id },
        data: { action: "forbidden-update" },
      }),
    ).rejects.toThrow(/append-only/);
  });

  it("enforces immutable Specification versions and Execution linkage", async () => {
    const projectId = `integration-${randomUUID()}`;
    const project = await prisma.project.create({
      data: {
        allowedCommands: [],
        dataClassification: "internal_test",
        id: projectId,
        name: "Specification Integration Test",
        policy: "least_privilege",
        protectedPathsProfile: "project_default",
        requiredTools: {},
        retention: {
          audit_events_expire: false,
          files_days: 1,
          logs_days: 1,
          sensitive_days: null,
        },
        risk: "low",
      },
    });
    const task = await prisma.task.create({
      data: {
        idempotencyKey: `task-${randomUUID()}`,
        origin: "integration-test",
        originalMessage: "test immutable specification",
        projectId: project.id,
      },
    });
    const specification = await prisma.specification.create({
      data: {
        payload: { objective: "integration test" },
        payloadHash: `hash-${randomUUID()}`,
        taskId: task.id,
        version: 1,
      },
    });
    const execution = await prisma.execution.create({
      data: {
        attempt: 1,
        idempotencyKey: `execution-${randomUUID()}`,
        specificationId: specification.id,
        taskId: task.id,
      },
    });

    expect(execution.specificationId).toBe(specification.id);
    await expect(
      prisma.specification.update({
        where: { id: specification.id },
        data: { payloadHash: "forbidden-update" },
      }),
    ).rejects.toThrow(/immutable/);
  });

  it("persists Telegram update replay, project selection and versioned approval decisions", async () => {
    const projectId = `telegram-${randomUUID()}`;
    await prisma.project.create({
      data: {
        allowedCommands: [],
        dataClassification: "internal_test",
        id: projectId,
        name: "Telegram Integration Test",
        policy: "least_privilege",
        protectedPathsProfile: "project_default",
        requiredTools: {},
        retention: { audit_events_expire: false, files_days: 1, logs_days: 1 },
        risk: "low",
      },
    });
    await telegramStore.selectProject(42n, 100n, projectId);
    expect(await telegramStore.getSelectedProject(42n)).toMatchObject({ id: projectId });

    const responses = [{ text: "persisted response" }];
    await telegramStore.recordProcessedUpdate({
      chatId: 100n,
      responses,
      updateId: 9001n,
      userId: 42n,
    });
    expect(await telegramStore.findProcessedUpdate(9001n)).toEqual(responses);

    const task = await prisma.task.create({
      data: {
        idempotencyKey: `telegram-task-${randomUUID()}`,
        origin: "telegram:42",
        originalMessage: "approve this",
        projectId,
        state: "WAITING_APPROVAL",
      },
    });
    const approval = await prisma.approval.create({
      data: {
        channel: "telegram",
        idempotencyKey: `approval-${randomUUID()}`,
        presentedPayload: { objective: "integration" },
        requestedBy: "system",
        targetHash: "sha256:integration",
        targetId: "specification-integration",
        targetType: "SPECIFICATION",
        targetVersion: 3,
        taskId: task.id,
        type: "PRE_EXECUTION",
      },
    });
    const decided = await telegramStore.decideApproval({
      approvalId: approval.id,
      callbackId: "integration-callback",
      correlationId: "integration-telegram",
      decision: "APPROVED",
      userId: 42n,
    });

    expect(decided.approval).toMatchObject({
      targetHash: "sha256:integration",
      targetId: "specification-integration",
      targetVersion: 3,
    });
    expect(
      await prisma.auditEvent.findUnique({
        where: { idempotencyKey: "telegram:callback:integration-callback:approval" },
      }),
    ).not.toBeNull();
  });
});
