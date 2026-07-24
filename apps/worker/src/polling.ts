import type { WorkerAssignment } from "@atlas/shared";
import { ZodError } from "zod";

import { WorkerCoordinatorRequestError } from "./client.js";

export interface WorkerPollingOptions {
  readonly claim: () => Promise<WorkerAssignment | null>;
  readonly execute: (assignment: WorkerAssignment) => Promise<unknown>;
  readonly idleDelayMs: number;
  readonly onError: (error: unknown, operation: "claim" | "execute") => void;
  readonly retryInitialDelayMs: number;
  readonly retryMaxDelayMs: number;
  readonly signal: AbortSignal;
}

async function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, milliseconds);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
  });
}

export async function retryWithBackoff<Output>(
  operation: () => Promise<Output>,
  options: {
    readonly initialDelayMs: number;
    readonly maxDelayMs: number;
    readonly onError: (error: unknown) => void;
    readonly signal: AbortSignal;
  },
): Promise<Output> {
  let delayMs = options.initialDelayMs;
  while (!options.signal.aborted) {
    try {
      return await operation();
    } catch (error: unknown) {
      options.onError(error);
      if (isPermanentCoordinatorError(error)) throw error;
      await delay(delayMs, options.signal);
      delayMs = nextRetryDelay(delayMs, options.maxDelayMs);
    }
  }
  throw new Error("Worker stopped before the coordinator operation succeeded");
}

export function isPermanentCoordinatorError(error: unknown): boolean {
  if (error instanceof ZodError) return true;
  return (
    error instanceof WorkerCoordinatorRequestError && [400, 401, 403, 422].includes(error.status)
  );
}

export function nextRetryDelay(currentDelayMs: number, maxDelayMs: number): number {
  return Math.min(currentDelayMs * 2, maxDelayMs);
}

export async function runWorkerPolling(options: WorkerPollingOptions): Promise<void> {
  let claimRetryDelayMs = options.retryInitialDelayMs;
  while (!options.signal.aborted) {
    let assignment: WorkerAssignment | null;
    try {
      assignment = await options.claim();
    } catch (error: unknown) {
      options.onError(error, "claim");
      if (isPermanentCoordinatorError(error)) throw error;
      await delay(claimRetryDelayMs, options.signal);
      claimRetryDelayMs = nextRetryDelay(claimRetryDelayMs, options.retryMaxDelayMs);
      continue;
    }
    claimRetryDelayMs = options.retryInitialDelayMs;
    if (assignment === null) {
      await delay(options.idleDelayMs, options.signal);
      continue;
    }
    try {
      await options.execute(assignment);
    } catch (error: unknown) {
      options.onError(error, "execute");
      await delay(options.retryInitialDelayMs, options.signal);
    }
  }
}
