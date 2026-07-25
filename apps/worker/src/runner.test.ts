import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { CodexAdapter } from "@atlas/codex-adapter";
import type { GitAdapter } from "@atlas/git-adapter";
import { canonicalPayloadHash, type WorkerAssignment } from "@atlas/shared";

import { WorkerRunner, type WorkerApi } from "./runner.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

function assignment(repositoryPath: string): WorkerAssignment {
  const specification = {
    acceptance_criteria: ["done"],
    allowed_commands: [],
    approval_required_for: [],
    authorized_scope: ["docs/**"],
    constraints: [],
    context: [],
    expected_delivery: "PR",
    implementation_strategy: ["edit"],
    objective: "bounded test",
    out_of_scope: [],
    project_id: "atlas",
    required_tests: ["unit"],
    risk_level: "moderate" as const,
    task_id: "10000000-0000-4000-8000-000000000001",
    version: 1,
  };
  return {
    allowed_commands: [],
    autonomy_level: 2,
    execution_id: "10000000-0000-4000-8000-000000000002",
    fencing_token: "1",
    lease_expires_at: "2026-07-24T14:00:00.000Z",
    lease_id: "10000000-0000-4000-8000-000000000003",
    project_id: "atlas",
    protected_globs: [".env*"],
    repository_path: repositoryPath,
    required_tools: { codex_cli: null, git: null, gnu_tools: [], node: null },
    runtime: null,
    specification,
    specification_hash: canonicalPayloadHash(specification),
    specification_id: "10000000-0000-4000-8000-000000000004",
    specification_version: 1,
    task_id: specification.task_id,
  };
}

describe("WorkerRunner", () => {
  it("fails bootstrap without calling Codex and cleans the worktree", async () => {
    const root = await mkdtemp(join(tmpdir(), "atlas-runner-bootstrap-failure-"));
    temporaryDirectories.push(root);
    let codexCalled = false;
    let cleaned = false;
    let submitted: Awaited<ReturnType<WorkerRunner["execute"]>> | undefined;
    const input = assignment(root);
    input.runtime = {
      allowed_commands: [
        { executable: "pnpm", args: ["install", "--frozen-lockfile"] },
        { executable: "pnpm", args: ["validate"] },
      ],
      bootstrap: [{ executable: "pnpm", args: ["install", "--frozen-lockfile"] }],
      forbidden_commands: [],
      package_manager: "pnpm",
      timeout_minutes: 1,
      validate: [{ executable: "pnpm", args: ["validate"] }],
    };
    const runner = new WorkerRunner({
      api: {
        appendLog: () => Promise.resolve(),
        finalize: () => Promise.resolve(),
        renew: () =>
          Promise.resolve({
            cancelRequested: false,
            leaseExpiresAt: "2026-07-24T14:00:00.000Z",
            readyToFinalize: false,
            terminalFailure: false,
          }),
        submitResult: (_workerId, _assignment, result) => {
          submitted = result;
          return Promise.resolve({ replayed: false, state: "FAILED" });
        },
      },
      codex: {
        execute: () => {
          codexCalled = true;
          return Promise.reject(new Error("Codex must not run after bootstrap failure"));
        },
      },
      codexEstimatedCostUsdPerExecution: 0,
      executeCommand: (command) =>
        Promise.resolve({
          aborted: false,
          exitCode: 1,
          output: "bootstrap failed",
          resolvedExecutable: command.executable,
        }),
      git: {
        createWorktree: () => Promise.resolve(),
        diff: () =>
          Promise.resolve({
            changedPaths: [],
            content: "",
            deletions: 0,
            filesChanged: 0,
            insertions: 0,
          }),
        finalize: () => Promise.reject(new Error("must not finalize")),
        removeWorktree: () => {
          cleaned = true;
          return Promise.resolve();
        },
      },
      githubToken: "fake",
      leaseRenewalMs: 10,
      maxLogChunkBytes: 1024,
      preflight: () =>
        Promise.resolve({
          architecture: "arm64",
          codex_version: "codex 1.0.0",
          git_version: "git 2.0.0",
          node_version: "v22.13.0",
          platform: "darwin",
          tools: {},
        }),
      timeoutMs: 1_000,
      workerId: "10000000-0000-4000-8000-000000000005",
      worktreeRoot: root,
    });

    expect((await runner.execute(input)).failure_stage).toBe("bootstrap");
    expect(submitted?.commands[0]).toMatchObject({ exit_code: 1, status: "failed" });
    expect(codexCalled).toBe(false);
    expect(cleaned).toBe(true);
  });

  it("classifies an expired runtime bootstrap deadline as timeout", async () => {
    const root = await mkdtemp(join(tmpdir(), "atlas-runner-bootstrap-timeout-"));
    temporaryDirectories.push(root);
    let submitted: Awaited<ReturnType<WorkerRunner["execute"]>> | undefined;
    const input = assignment(root);
    input.runtime = {
      allowed_commands: [
        { executable: "pnpm", args: ["install", "--frozen-lockfile"] },
        { executable: "pnpm", args: ["validate"] },
      ],
      bootstrap: [{ executable: "pnpm", args: ["install", "--frozen-lockfile"] }],
      forbidden_commands: [],
      package_manager: "pnpm",
      timeout_minutes: 1,
      validate: [{ executable: "pnpm", args: ["validate"] }],
    };
    const runner = new WorkerRunner({
      api: {
        appendLog: () => Promise.resolve(),
        finalize: () => Promise.resolve(),
        renew: () =>
          Promise.resolve({
            cancelRequested: false,
            leaseExpiresAt: "2026-07-24T14:00:00.000Z",
            readyToFinalize: false,
            terminalFailure: false,
          }),
        submitResult: (_workerId, _assignment, result) => {
          submitted = result;
          return Promise.resolve({ replayed: false, state: "FAILED" });
        },
      },
      codex: { execute: () => Promise.reject(new Error("must not call Codex")) },
      codexEstimatedCostUsdPerExecution: 0,
      executeCommand: (command, _cwd, signal) =>
        new Promise((resolve) => {
          signal.addEventListener(
            "abort",
            () => {
              resolve({
                aborted: true,
                exitCode: 124,
                output: "timed out",
                resolvedExecutable: command.executable,
              });
            },
            { once: true },
          );
        }),
      git: {
        createWorktree: () => Promise.resolve(),
        diff: () =>
          Promise.resolve({
            changedPaths: [],
            content: "",
            deletions: 0,
            filesChanged: 0,
            insertions: 0,
          }),
        finalize: () => Promise.reject(new Error("must not finalize")),
        removeWorktree: () => Promise.resolve(),
      },
      githubToken: "fake",
      leaseRenewalMs: 120_000,
      maxLogChunkBytes: 1024,
      preflight: () =>
        Promise.resolve({
          architecture: "arm64",
          codex_version: "codex 1.0.0",
          git_version: "git 2.0.0",
          node_version: "v22.13.0",
          platform: "darwin",
          tools: {},
        }),
      runtimeTimeoutMs: () => 1,
      timeoutMs: 120_000,
      workerId: "10000000-0000-4000-8000-000000000005",
      worktreeRoot: root,
    });

    expect((await runner.execute(input)).failure_stage).toBe("timeout");
    expect(submitted?.commands[0]).toMatchObject({ exit_code: 124, status: "failed" });
  });

  it("keeps legacy validation behavior without a runtime and cleans the worktree", async () => {
    const root = await mkdtemp(join(tmpdir(), "atlas-runner-test-"));
    temporaryDirectories.push(root);
    const calls: string[] = [];
    const git: GitAdapter = {
      createWorktree: () => {
        calls.push("create");
        return Promise.resolve();
      },
      diff: () =>
        Promise.resolve({
          changedPaths: ["docs/readme.md"],
          content: "diff",
          deletions: 0,
          filesChanged: 1,
          insertions: 1,
        }),
      finalize: () => {
        calls.push("finalize");
        return Promise.resolve({
          commitSha: "abcdef123456",
          pullRequestUrl: "https://github.com/example/repo/pull/1",
        });
      },
      removeWorktree: () => {
        calls.push("cleanup");
        return Promise.resolve();
      },
    };
    const codex: CodexAdapter = {
      execute: async (request) => {
        await request.onChunk("safe output");
        return {
          exitCode: 0,
          summary: { pendingItems: [], risks: [], summary: "done" },
        };
      },
    };
    const api: WorkerApi = {
      appendLog: () => Promise.resolve(),
      finalize: () => {
        calls.push("coordinator-finalize");
        return Promise.resolve();
      },
      renew: () =>
        Promise.resolve({
          cancelRequested: false,
          leaseExpiresAt: "2026-07-24T14:00:00.000Z",
          readyToFinalize: true,
          terminalFailure: false,
        }),
      submitResult: () => Promise.resolve({ replayed: false, state: "FINALIZING" }),
    };
    const runner = new WorkerRunner({
      api,
      codex,
      codexEstimatedCostUsdPerExecution: 0,
      git,
      githubToken: "fake",
      leaseRenewalMs: 10,
      maxLogChunkBytes: 1024,
      preflight: () =>
        Promise.resolve({
          architecture: "arm64",
          codex_version: "codex 1.0.0",
          git_version: "git 2.0.0",
          node_version: "v22.13.0",
          platform: "darwin",
          tools: {},
        }),
      timeoutMs: 1_000,
      workerId: "10000000-0000-4000-8000-000000000005",
      worktreeRoot: root,
    });

    const result = await runner.execute(assignment(root));

    expect(result.status).toBe("succeeded");
    expect(calls).toEqual(["create", "finalize", "coordinator-finalize", "cleanup"]);
  });

  it("orders result log references when concurrent stream callbacks complete out of order", async () => {
    const root = await mkdtemp(join(tmpdir(), "atlas-runner-log-order-"));
    temporaryDirectories.push(root);
    let submitted: Awaited<ReturnType<WorkerRunner["execute"]>> | undefined;
    const runner = new WorkerRunner({
      api: {
        appendLog: (_workerId, _assignment, chunk) =>
          new Promise<void>((resolve) => {
            setTimeout(resolve, chunk.sequence === 0 ? 10 : 0);
          }),
        finalize: () => Promise.resolve(),
        renew: () =>
          Promise.resolve({
            cancelRequested: false,
            leaseExpiresAt: "2026-07-24T14:00:00.000Z",
            readyToFinalize: true,
            terminalFailure: false,
          }),
        submitResult: (_workerId, _assignment, result) => {
          submitted = result;
          return Promise.resolve({ replayed: false, state: "FINALIZING" });
        },
      },
      codex: {
        execute: async (request) => {
          await Promise.all([request.onChunk("first"), request.onChunk("second")]);
          return { exitCode: 0, summary: { pendingItems: [], risks: [], summary: "done" } };
        },
      },
      codexEstimatedCostUsdPerExecution: 0,
      git: {
        createWorktree: () => Promise.resolve(),
        diff: () =>
          Promise.resolve({
            changedPaths: [],
            content: "",
            deletions: 0,
            filesChanged: 0,
            insertions: 0,
          }),
        finalize: () =>
          Promise.resolve({ commitSha: "abcdef123456", pullRequestUrl: "https://example.test/1" }),
        removeWorktree: () => Promise.resolve(),
      },
      githubToken: "fake",
      leaseRenewalMs: 100,
      maxLogChunkBytes: 1024,
      preflight: () =>
        Promise.resolve({
          architecture: "arm64",
          codex_version: "codex 1.0.0",
          git_version: "git 2.0.0",
          node_version: "v22.13.0",
          platform: "darwin",
          tools: {},
        }),
      timeoutMs: 1_000,
      workerId: "10000000-0000-4000-8000-000000000005",
      worktreeRoot: root,
    });

    await runner.execute(assignment(root));

    expect(submitted?.log_chunks.map((chunk) => chunk.sequence)).toEqual([0, 1]);
  });

  it("submits failure and cleans up when Codex fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "atlas-runner-failure-"));
    temporaryDirectories.push(root);
    let submittedStatus: string | undefined;
    let cleaned = false;
    const runner = new WorkerRunner({
      api: {
        appendLog: () => Promise.resolve(),
        finalize: () => Promise.resolve(),
        renew: () =>
          Promise.resolve({
            cancelRequested: false,
            leaseExpiresAt: "2026-07-24T14:00:00.000Z",
            readyToFinalize: false,
            terminalFailure: false,
          }),
        submitResult: (_workerId, _assignment, result) => {
          submittedStatus = result.status;
          return Promise.resolve({ replayed: false, state: "FAILED" });
        },
      },
      codex: { execute: () => Promise.reject(new Error("fake failure")) },
      codexEstimatedCostUsdPerExecution: 0,
      git: {
        createWorktree: () => Promise.resolve(),
        diff: () =>
          Promise.resolve({
            changedPaths: [],
            content: "",
            deletions: 0,
            filesChanged: 0,
            insertions: 0,
          }),
        finalize: () => Promise.reject(new Error("must not finalize")),
        removeWorktree: () => {
          cleaned = true;
          return Promise.resolve();
        },
      },
      githubToken: "fake",
      leaseRenewalMs: 10,
      maxLogChunkBytes: 1024,
      preflight: () =>
        Promise.resolve({
          architecture: "arm64",
          codex_version: "codex 1.0.0",
          git_version: "git 2.0.0",
          node_version: "v22.13.0",
          platform: "darwin",
          tools: {},
        }),
      timeoutMs: 1_000,
      workerId: "10000000-0000-4000-8000-000000000005",
      worktreeRoot: root,
    });

    expect((await runner.execute(assignment(root))).status).toBe("failed");
    expect(submittedStatus).toBe("failed");
    expect(cleaned).toBe(true);
  });

  it("turns cooperative cancellation into a cancelled result and cleanup", async () => {
    const root = await mkdtemp(join(tmpdir(), "atlas-runner-cancel-"));
    temporaryDirectories.push(root);
    let submittedStatus: string | undefined;
    let cleaned = false;
    const runner = new WorkerRunner({
      api: {
        appendLog: () => Promise.resolve(),
        finalize: () => Promise.reject(new Error("must not finalize")),
        renew: () =>
          Promise.resolve({
            cancelRequested: true,
            leaseExpiresAt: "2026-07-24T14:00:00.000Z",
            readyToFinalize: false,
            terminalFailure: false,
          }),
        submitResult: (_workerId, _assignment, result) => {
          submittedStatus = result.status;
          return Promise.resolve({ replayed: false, state: "CANCELLED" });
        },
      },
      codex: {
        execute: (request) =>
          new Promise((_resolve, reject) => {
            if (request.abortSignal.aborted) {
              reject(new Error("cancelled"));
              return;
            }
            request.abortSignal.addEventListener(
              "abort",
              () => {
                reject(new Error("cancelled"));
              },
              {
                once: true,
              },
            );
          }),
      },
      codexEstimatedCostUsdPerExecution: 0,
      git: {
        createWorktree: () => Promise.resolve(),
        diff: () =>
          Promise.resolve({
            changedPaths: [],
            content: "",
            deletions: 0,
            filesChanged: 0,
            insertions: 0,
          }),
        finalize: () => Promise.reject(new Error("must not finalize")),
        removeWorktree: () => {
          cleaned = true;
          return Promise.resolve();
        },
      },
      githubToken: "fake",
      leaseRenewalMs: 5,
      maxLogChunkBytes: 1024,
      preflight: () =>
        Promise.resolve({
          architecture: "arm64",
          codex_version: "codex 1.0.0",
          git_version: "git 2.0.0",
          node_version: "v22.13.0",
          platform: "darwin",
          tools: {},
        }),
      timeoutMs: 1_000,
      workerId: "10000000-0000-4000-8000-000000000005",
      worktreeRoot: root,
    });

    expect((await runner.execute(assignment(root))).status).toBe("cancelled");
    expect(submittedStatus).toBe("cancelled");
    expect(cleaned).toBe(true);
  });
});
