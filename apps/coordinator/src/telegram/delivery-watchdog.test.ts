import { describe, expect, it } from "vitest";

import {
  DeliveryWatchdog,
  parseDeliveryWatchdogSlaMs,
  type DeliveryWatchdogIssue,
  type DeliveryWatchdogStore,
} from "./delivery-watchdog.js";

class MemoryWatchdogStore implements DeliveryWatchdogStore {
  readonly cutoffs: Date[] = [];
  readonly recorded: DeliveryWatchdogIssue[] = [];
  private readonly keys = new Set<string>();

  constructor(readonly issues: readonly DeliveryWatchdogIssue[]) {}

  listIssues(cutoff: Date): Promise<readonly DeliveryWatchdogIssue[]> {
    this.cutoffs.push(cutoff);
    return Promise.resolve(this.issues);
  }

  recordAlert(issue: DeliveryWatchdogIssue): Promise<boolean> {
    this.recorded.push(issue);
    const key = `${issue.deliveryId ?? issue.taskId}:${String(issue.taskVersion)}:${issue.reason}`;
    if (this.keys.has(key)) return Promise.resolve(false);
    this.keys.add(key);
    return Promise.resolve(true);
  }
}

const issues: readonly DeliveryWatchdogIssue[] = [
  {
    deliveryId: "delivery-1",
    deliveryKey: "telegram:result:task-1:v3:COMPLETED",
    projectId: "atlas",
    reason: "delivery_failed",
    status: "DELIVERY_FAILED",
    taskId: "task-1",
    taskVersion: 3,
  },
  {
    projectId: "atlas",
    reason: "result_delivery_outbox_missing",
    taskId: "task-2",
    taskVersion: 7,
  },
];

describe("DeliveryWatchdog", () => {
  it("audits observed delivery failures against a deterministic SLA cutoff", async () => {
    const store = new MemoryWatchdogStore(issues);
    const watchdog = new DeliveryWatchdog(store, 60_000);

    await expect(watchdog.poll(new Date("2026-07-28T00:01:00.000Z"))).resolves.toEqual({
      alertsCreated: 2,
      issuesObserved: 2,
    });
    expect(store.cutoffs).toEqual([new Date("2026-07-28T00:00:00.000Z")]);
    expect(store.recorded).toEqual(issues);
  });

  it("is idempotent through the store and never mutates delivery state", async () => {
    const store = new MemoryWatchdogStore(issues);
    const watchdog = new DeliveryWatchdog(store, 1);

    expect(await watchdog.poll()).toEqual({ alertsCreated: 2, issuesObserved: 2 });
    expect(await watchdog.poll()).toEqual({ alertsCreated: 0, issuesObserved: 2 });
    expect(issues[0]).toMatchObject({ status: "DELIVERY_FAILED" });
  });

  it("rejects invalid SLA configuration", () => {
    expect(parseDeliveryWatchdogSlaMs(undefined)).toBe(300_000);
    expect(parseDeliveryWatchdogSlaMs("1000")).toBe(1000);
    for (const value of ["0", "-1", "1.5", "NaN", "9007199254740992"]) {
      expect(() => parseDeliveryWatchdogSlaMs(value)).toThrow(
        "ATLAS_DELIVERY_SLA_MS must be a positive safe integer",
      );
    }
    expect(() => new DeliveryWatchdog(new MemoryWatchdogStore([]), 0)).toThrow(
      "delivery watchdog SLA must be a positive safe integer",
    );
  });
});
