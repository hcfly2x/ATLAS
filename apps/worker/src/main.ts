import { randomUUID } from "node:crypto";

import { CodexCliAdapter } from "@atlas/codex-adapter";
import { GitCliAdapter } from "@atlas/git-adapter";

import { WorkerCoordinatorClient } from "./client.js";
import { retryWithBackoff, runWorkerPolling } from "./polling.js";
import { WorkerConcurrencyGate, WorkerRunner, workerStartupCapabilities } from "./runner.js";

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}

const coordinatorUrl = requiredEnvironment("ATLAS_COORDINATOR_URL");
if (!coordinatorUrl.startsWith("https://") && process.env.NODE_ENV !== "development") {
  throw new Error("ATLAS_COORDINATOR_URL must use HTTPS outside development");
}
const workerToken = requiredEnvironment("ATLAS_WORKER_TOKEN");
const githubToken = requiredEnvironment("GITHUB_TOKEN");
const projectScopes = requiredEnvironment("ATLAS_PROJECT_SCOPES")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const concurrencyLimit = Number.parseInt(process.env.ATLAS_WORKER_CONCURRENCY ?? "1", 10);
const reconnectInitialDelayMs = Number(process.env.ATLAS_RECONNECT_INITIAL_DELAY_MS ?? "5000");
const reconnectMaxDelayMs = Number(process.env.ATLAS_RECONNECT_MAX_DELAY_MS ?? "60000");
const client = new WorkerCoordinatorClient(coordinatorUrl, workerToken);
const capabilities = await workerStartupCapabilities();
const controller = new AbortController();
const logTransientError = (error: unknown, operation: string): void => {
  const message = error instanceof Error ? error.message : "unknown error";
  process.stderr.write(
    `${JSON.stringify({ level: "error", message, operation, service: "worker" })}\n`,
  );
};
process.on("SIGINT", () => {
  controller.abort();
  process.exitCode = 0;
});
const registration = await retryWithBackoff(
  () =>
    client.register({
      capabilities,
      concurrencyLimit,
      name: process.env.ATLAS_WORKER_NAME ?? "local-mac-worker",
      projectScopes,
    }),
  {
    initialDelayMs: reconnectInitialDelayMs,
    maxDelayMs: reconnectMaxDelayMs,
    onError: (error) => {
      logTransientError(error, "register");
    },
    signal: controller.signal,
  },
);
const runner = new WorkerRunner({
  api: client,
  codex: new CodexCliAdapter(),
  codexEstimatedCostUsdPerExecution: Number(
    process.env.CODEX_ESTIMATED_COST_USD_PER_EXECUTION ?? "0",
  ),
  git: new GitCliAdapter(),
  githubToken,
  leaseRenewalMs: Number(process.env.ATLAS_LEASE_RENEWAL_MS ?? "10000"),
  maxLogChunkBytes: Number(process.env.ATLAS_LOG_CHUNK_BYTES ?? "65536"),
  timeoutMs: Number(process.env.ATLAS_EXECUTION_TIMEOUT_MS ?? "3600000"),
  workerId: registration.workerId,
  worktreeRoot: requiredEnvironment("ATLAS_WORKTREE_ROOT"),
});
const gate = new WorkerConcurrencyGate(concurrencyLimit);
const heartbeat = setInterval(() => {
  void client.heartbeat(registration.workerId, capabilities).catch((error: unknown) => {
    logTransientError(error, "heartbeat");
  });
}, 30_000);

controller.signal.addEventListener("abort", () => {
  clearInterval(heartbeat);
});

await runWorkerPolling({
  claim: () => client.claim(registration.workerId, `claim:${randomUUID()}`),
  execute: (assignment) => gate.run(() => runner.execute(assignment)),
  idleDelayMs: 5_000,
  onError: logTransientError,
  retryInitialDelayMs: reconnectInitialDelayMs,
  retryMaxDelayMs: reconnectMaxDelayMs,
  signal: controller.signal,
});
