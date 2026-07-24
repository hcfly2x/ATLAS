import { describe, expect, it, vi } from "vitest";

import type { WorkerAssignment } from "@atlas/shared";

import { WorkerCoordinatorRequestError } from "./client.js";
import { nextRetryDelay, retryWithBackoff, runWorkerPolling } from "./polling.js";

const assignment = {} as WorkerAssignment;

describe("worker polling resilience", () => {
  it("retries registration after a transient coordinator failure", async () => {
    const controller = new AbortController();
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockResolvedValue("registered");
    const errors: unknown[] = [];

    const result = await retryWithBackoff(operation, {
      initialDelayMs: 0,
      maxDelayMs: 0,
      onError: (error) => errors.push(error),
      signal: controller.signal,
    });

    expect(result).toBe("registered");
    expect(operation).toHaveBeenCalledTimes(2);
    expect(errors).toHaveLength(1);
  });

  it("fails immediately for permanent coordinator errors", async () => {
    const controller = new AbortController();
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValue(new WorkerCoordinatorRequestError(401));

    await expect(
      retryWithBackoff(operation, {
        initialDelayMs: 0,
        maxDelayMs: 0,
        onError: () => undefined,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ status: 401 });

    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("caps exponential retry delays", () => {
    expect(nextRetryDelay(5_000, 60_000)).toBe(10_000);
    expect(nextRetryDelay(30_000, 60_000)).toBe(60_000);
    expect(nextRetryDelay(60_000, 60_000)).toBe(60_000);
  });

  it("continues claiming after a transient coordinator failure", async () => {
    const controller = new AbortController();
    const claim = vi
      .fn<() => Promise<WorkerAssignment | null>>()
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockResolvedValueOnce(assignment)
      .mockImplementationOnce(() => {
        controller.abort();
        return Promise.resolve(null);
      });
    const execute = vi.fn<(value: WorkerAssignment) => Promise<void>>().mockResolvedValue();
    const errors: { error: unknown; operation: string }[] = [];

    await runWorkerPolling({
      claim,
      execute,
      idleDelayMs: 0,
      onError: (error, operation) => errors.push({ error, operation }),
      retryInitialDelayMs: 0,
      retryMaxDelayMs: 0,
      signal: controller.signal,
    });

    expect(claim).toHaveBeenCalledTimes(3);
    expect(execute).toHaveBeenCalledWith(assignment);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.operation).toBe("claim");
  });

  it("stops polling after a permanent claim error", async () => {
    const controller = new AbortController();
    const claim = vi
      .fn<() => Promise<WorkerAssignment | null>>()
      .mockRejectedValue(new WorkerCoordinatorRequestError(403));

    await expect(
      runWorkerPolling({
        claim,
        execute: () => Promise.resolve(),
        idleDelayMs: 0,
        onError: () => undefined,
        retryInitialDelayMs: 0,
        retryMaxDelayMs: 0,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ status: 403 });

    expect(claim).toHaveBeenCalledTimes(1);
  });
});
