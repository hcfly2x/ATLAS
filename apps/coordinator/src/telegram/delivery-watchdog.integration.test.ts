import { randomUUID } from "node:crypto";

import { DeliveryOutboxStatus, PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DashboardService } from "../dashboard/service.js";
import { DeliveryWatchdog, PrismaDeliveryWatchdogStore } from "./delivery-watchdog.js";

const prisma = new PrismaClient();

beforeAll(async () => prisma.$connect());
afterAll(async () => prisma.$disconnect());

async function createTerminalTask(projectId: string, version: number) {
  const taskId = randomUUID();
  await prisma.task.create({
    data: {
      id: taskId,
      idempotencyKey: `watchdog-task-${taskId}`,
      origin: "telegram:42:100",
      originalMessage: "synthetic delivery watchdog fixture",
      projectId,
      state: "COMPLETED",
      updatedAt: new Date("2026-07-27T23:00:00.000Z"),
      version,
    },
  });
  return taskId;
}

async function createOutbox(
  projectId: string,
  taskId: string,
  taskVersion: number,
  status: "DELIVERY_FAILED" | "PENDING",
) {
  return prisma.resultDeliveryOutbox.create({
    data: {
      contentHash: `sha256:${"a".repeat(64)}`,
      contentReference: `task:${taskId}:v${String(taskVersion)}:COMPLETED`,
      createdAt: new Date("2026-07-27T23:00:00.000Z"),
      deliveryKey: `telegram:result:${taskId}:v${String(taskVersion)}:COMPLETED`,
      destinationChatId: 100n,
      destinationUserId: 42n,
      messageText: "synthetic approved result",
      projectId,
      status,
      taskId,
      taskVersion,
    },
  });
}

describe("Prisma delivery watchdog", () => {
  it("audits failed, overdue and missing deliveries once without retrying or changing Task state", async () => {
    const projectId = `watchdog-${randomUUID()}`;
    await prisma.project.create({
      data: {
        allowedCommands: [],
        dataClassification: "internal_test",
        id: projectId,
        name: projectId,
        policy: "least_privilege",
        protectedPathsProfile: "project_default",
        requiredTools: {},
        retention: { audit_events_expire: false, files_days: 1, logs_days: 1 },
        risk: "low",
      },
    });
    const failedTaskId = await createTerminalTask(projectId, 1);
    const overdueTaskId = await createTerminalTask(projectId, 2);
    const missingTaskId = await createTerminalTask(projectId, 3);
    const legacyTaskId = await createTerminalTask(projectId, 4);
    const staleLegacyTaskId = await createTerminalTask(projectId, 5);
    const failed = await createOutbox(
      projectId,
      failedTaskId,
      1,
      DeliveryOutboxStatus.DELIVERY_FAILED,
    );
    const overdue = await createOutbox(projectId, overdueTaskId, 2, DeliveryOutboxStatus.PENDING);
    await prisma.telegramTaskDelivery.create({
      data: {
        chatId: 100n,
        projectId,
        resultClaimedAt: new Date("2026-07-27T23:00:00.000Z"),
        resultDeliveryKey: `telegram:result:${legacyTaskId}:v4:COMPLETED`,
        taskId: legacyTaskId,
        userId: 42n,
      },
    });
    await prisma.telegramTaskDelivery.create({
      data: {
        chatId: 100n,
        projectId,
        resultClaimedAt: new Date("2026-07-27T23:00:00.000Z"),
        resultDeliveryKey: `telegram:result:${staleLegacyTaskId}:v4:COMPLETED`,
        taskId: staleLegacyTaskId,
        userId: 42n,
      },
    });

    const watchdog = new DeliveryWatchdog(
      new PrismaDeliveryWatchdogStore(prisma, { projectId }),
      60_000,
    );
    const now = new Date("2026-07-28T00:00:00.000Z");
    await expect(watchdog.poll(now)).resolves.toEqual({
      alertsCreated: 4,
      issuesObserved: 4,
    });
    await expect(watchdog.poll(now)).resolves.toEqual({
      alertsCreated: 0,
      issuesObserved: 0,
    });

    const alerts = await prisma.auditEvent.findMany({
      where: {
        action: "telegram.result_delivery.watchdog_alerted",
        projectId,
      },
      orderBy: { idempotencyKey: "asc" },
    });
    expect(alerts).toHaveLength(4);
    expect(alerts.map((alert) => alert.taskId).sort()).toEqual(
      [failedTaskId, missingTaskId, overdueTaskId, staleLegacyTaskId].sort(),
    );
    expect(
      await prisma.resultDeliveryOutbox.findUniqueOrThrow({ where: { id: failed.id } }),
    ).toMatchObject({ attempts: 0, status: DeliveryOutboxStatus.DELIVERY_FAILED });
    expect(
      await prisma.resultDeliveryOutbox.findUniqueOrThrow({ where: { id: overdue.id } }),
    ).toMatchObject({ attempts: 0, status: DeliveryOutboxStatus.PENDING });
    expect(
      await prisma.task.findMany({
        where: {
          id: {
            in: [failedTaskId, overdueTaskId, missingTaskId, legacyTaskId, staleLegacyTaskId],
          },
        },
        select: { state: true },
      }),
    ).toEqual([
      { state: "COMPLETED" },
      { state: "COMPLETED" },
      { state: "COMPLETED" },
      { state: "COMPLETED" },
      { state: "COMPLETED" },
    ]);

    const dashboard = new DashboardService(prisma, {
      deliverySlaMs: 60_000,
      now: () => now,
    });
    await expect(dashboard.overview(projectId)).resolves.toMatchObject({
      delivery: {
        delivered: 0,
        deliveryFailed: 1,
        missingOutbox: 2,
        pending: 1,
        pendingOverdue: 1,
        slaMs: 60_000,
      },
    });
    const deliveries = await dashboard.deliveries(projectId);
    expect(deliveries).toHaveLength(2);
    expect(JSON.stringify(deliveries)).not.toContain("synthetic approved result");
    expect(JSON.stringify(deliveries)).not.toContain("destinationChatId");
    expect(JSON.stringify(deliveries)).not.toContain("destinationUserId");

    const countsBeforeMissionControl = await Promise.all([
      prisma.task.count({ where: { projectId } }),
      prisma.approval.count({ where: { task: { projectId } } }),
      prisma.auditEvent.count({ where: { projectId } }),
      prisma.resultDeliveryOutbox.count({ where: { projectId } }),
    ]);
    const missionControl = await dashboard.missionControl(projectId);
    expect(missionControl).toMatchObject({
      intelligence: {
        generatedBy: "deterministic_rules",
        status: "available",
      },
      methodology: {
        eta: "indeterminado",
        pendingQuestions: "indeterminado",
        progress: "task_state",
      },
      risks: {
        count: 4,
        status: "available",
      },
    });
    const serializedMissionControl = JSON.stringify(missionControl);
    for (const forbidden of [
      "synthetic approved result",
      "synthetic delivery watchdog fixture",
      "messageText",
      "destinationChatId",
      "destinationUserId",
      "originalMessage",
    ]) {
      expect(serializedMissionControl).not.toContain(forbidden);
    }
    await expect(
      Promise.all([
        prisma.task.count({ where: { projectId } }),
        prisma.approval.count({ where: { task: { projectId } } }),
        prisma.auditEvent.count({ where: { projectId } }),
        prisma.resultDeliveryOutbox.count({ where: { projectId } }),
      ]),
    ).resolves.toEqual(countsBeforeMissionControl);
  });
});
