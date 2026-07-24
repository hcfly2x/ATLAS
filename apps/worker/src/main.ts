import { randomUUID } from "node:crypto";

import { CodexCliAdapter } from "@atlas/codex-adapter";
import { GitCliAdapter } from "@atlas/git-adapter";

import { WorkerCoordinatorClient } from "./client.js";
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
const client = new WorkerCoordinatorClient(coordinatorUrl, workerToken);
const capabilities = await workerStartupCapabilities();
const registration = await client.register({
  capabilities,
  concurrencyLimit,
  name: process.env.ATLAS_WORKER_NAME ?? "local-mac-worker",
  projectScopes,
});
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
  void client.heartbeat(registration.workerId, capabilities);
}, 30_000);

process.on("SIGINT", () => {
  clearInterval(heartbeat);
  process.exitCode = 0;
});

while (process.exitCode === undefined) {
  const assignment = await client.claim(registration.workerId, `claim:${randomUUID()}`);
  if (assignment === null) {
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    continue;
  }
  await gate.run(() => runner.execute(assignment));
}
