import { randomUUID } from "node:crypto";

import { PrismaClient, ProjectStatus } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { InvalidTaskTransitionError, TaskStateMachine } from "@atlas/core";

import { PrismaTaskCoreStore } from "./prisma-task-core-store.js";

const prisma = new PrismaClient();
const store = new PrismaTaskCoreStore(prisma);
const machine = new TaskStateMachine(store);

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
});
