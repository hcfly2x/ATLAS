import { randomUUID } from "node:crypto";

import { DeliveryOutboxStatus, PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  PrismaTelegramResultStore,
  telegramResultDeliveryKey,
  type TelegramResultCandidate,
} from "./result-publisher.js";

const prisma = new PrismaClient();
const store = new PrismaTelegramResultStore(prisma);

beforeAll(async () => prisma.$connect());
afterAll(async () => prisma.$disconnect());

async function fixture(version = 7): Promise<TelegramResultCandidate> {
  const projectId = `delivery-${randomUUID()}`;
  const taskId = randomUUID();
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
  await prisma.task.create({
    data: {
      id: taskId,
      idempotencyKey: `delivery-task-${taskId}`,
      origin: "telegram:42:100",
      originalMessage: "deliver the approved result",
      projectId,
      state: "COMPLETED",
      version,
    },
  });
  return {
    changedPaths: ["docs/result.md"],
    contentHash: `sha256:${"a".repeat(64)}`,
    contentReference: `execution:${randomUUID()}:result:sha256:${"b".repeat(64)}`,
    deliveryMode: "repository_change",
    origin: "telegram:42:100",
    projectId,
    state: "COMPLETED",
    summary: "Approved result",
    taskId,
    taskVersion: version,
  };
}

describe("Prisma durable result delivery outbox", () => {
  it("persists one row per task version and audits bounded attempts separately from delivery", async () => {
    const candidate = await fixture();

    expect(await store.enqueue(candidate, 100n, 42n)).toBe(true);
    expect(await store.enqueue(candidate, 100n, 42n)).toBe(false);
    await prisma.resultDeliveryOutbox.update({
      where: {
        taskId_taskVersion: {
          taskId: candidate.taskId,
          taskVersion: candidate.taskVersion,
        },
      },
      data: { nextAttemptAt: new Date(0) },
    });

    const first = await store.claimNext(
      new Date("2026-07-27T22:00:00.000Z"),
      new Date("2026-07-27T22:05:00.000Z"),
    );
    expect(first).toMatchObject({ attempt: 1, taskId: candidate.taskId });
    if (first === undefined) throw new Error("expected the first delivery claim");
    await store.recordNotDispatched(
      first,
      "telegram_api_rejected_before_dispatch",
      new Date("2026-07-27T22:00:10.000Z"),
    );
    expect(
      await store.claimNext(
        new Date("2026-07-27T22:00:09.000Z"),
        new Date("2026-07-27T22:05:09.000Z"),
      ),
    ).toBeUndefined();

    const second = await store.claimNext(
      new Date("2026-07-27T22:00:10.000Z"),
      new Date("2026-07-27T22:05:10.000Z"),
    );
    expect(second).toMatchObject({ attempt: 2, taskId: candidate.taskId });
    if (second === undefined) throw new Error("expected the second delivery claim");
    await store.recordDelivered(second);

    const rows = await prisma.resultDeliveryOutbox.findMany({
      where: { taskId: candidate.taskId },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      attempts: 2,
      lastError: null,
      status: DeliveryOutboxStatus.DELIVERED,
      taskVersion: candidate.taskVersion,
    });
    const attempts = await prisma.auditEvent.findMany({
      where: {
        action: "telegram.result_delivery.attempted",
        taskId: candidate.taskId,
      },
      orderBy: { createdAt: "asc" },
    });
    expect(attempts).toHaveLength(2);
    expect(new Set(attempts.map((event) => event.idempotencyKey)).size).toBe(2);
  });

  it("reconciles an expired dispatch claim as ambiguous without making it claimable again", async () => {
    const candidate = await fixture(8);
    await store.enqueue(candidate, 100n, 42n);
    await prisma.resultDeliveryOutbox.update({
      where: {
        taskId_taskVersion: {
          taskId: candidate.taskId,
          taskVersion: candidate.taskVersion,
        },
      },
      data: { nextAttemptAt: new Date(0) },
    });
    await store.claimNext(
      new Date("2026-07-27T23:00:00.000Z"),
      new Date("2026-07-27T23:00:01.000Z"),
    );

    expect(await store.reconcileExpiredClaims(new Date("2026-07-27T23:00:01.000Z"))).toBe(1);
    expect(
      await prisma.resultDeliveryOutbox.findUniqueOrThrow({
        where: {
          taskId_taskVersion: {
            taskId: candidate.taskId,
            taskVersion: candidate.taskVersion,
          },
        },
      }),
    ).toMatchObject({
      attempts: 1,
      lastError: "dispatch_confirmation_missing_after_claim_expiry",
      status: DeliveryOutboxStatus.DELIVERY_FAILED,
    });
  });

  it("does not redeliver a terminal task already claimed by the legacy publisher", async () => {
    const candidate = await fixture(9);
    const legacyKey = telegramResultDeliveryKey(candidate);
    await prisma.telegramTaskDelivery.create({
      data: {
        chatId: 100n,
        projectId: candidate.projectId,
        resultClaimedAt: new Date(),
        resultDeliveryKey: legacyKey,
        taskId: candidate.taskId,
        userId: 42n,
      },
    });

    expect(await store.enqueue(candidate, 100n, 42n)).toBe(false);
    expect(await prisma.resultDeliveryOutbox.count({ where: { taskId: candidate.taskId } })).toBe(
      0,
    );
  });

  it("enqueues a later Task version even when an older version used the legacy claim", async () => {
    const candidate = await fixture(10);
    await prisma.telegramTaskDelivery.create({
      data: {
        chatId: 100n,
        projectId: candidate.projectId,
        resultClaimedAt: new Date(),
        resultDeliveryKey: `telegram:result:${candidate.taskId}:v9:COMPLETED`,
        taskId: candidate.taskId,
        userId: 42n,
      },
    });

    const listed = (await store.listTerminalCandidates()).find(
      (item) => item.taskId === candidate.taskId,
    );
    expect(listed).toMatchObject({ taskId: candidate.taskId, taskVersion: 10 });
    if (listed === undefined) throw new Error("expected the later Task version");
    expect(await store.enqueue(listed, 100n, 42n)).toBe(true);
    expect(
      (await store.listTerminalCandidates()).some((item) => item.taskId === candidate.taskId),
    ).toBe(false);
    expect(
      await prisma.resultDeliveryOutbox.findUniqueOrThrow({
        where: { taskId_taskVersion: { taskId: candidate.taskId, taskVersion: 10 } },
      }),
    ).toMatchObject({ status: DeliveryOutboxStatus.PENDING, taskVersion: 10 });
  });
});
