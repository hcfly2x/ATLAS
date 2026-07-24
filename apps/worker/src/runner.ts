import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import type { CodexAdapter } from "@atlas/codex-adapter";
import type { GitAdapter, WorktreeRequest } from "@atlas/git-adapter";
import {
  canonicalPayloadHash,
  createWorkerResult,
  WORKER_RESULT_CONTRACT_VERSION,
  type WorkerAssignment,
  type WorkerCapabilities,
  type WorkerResult,
} from "@atlas/shared";

import { authorizeCommands, executeAllowedCommand, type AllowedCommand } from "./allowlist.js";
import type { WorkerCoordinatorClient } from "./client.js";
import { runPreflight } from "./preflight.js";
import { findProtectedPathMatches } from "./protected-paths.js";

export interface WorkerApi {
  appendLog: WorkerCoordinatorClient["appendLog"];
  finalize: WorkerCoordinatorClient["finalize"];
  renew: WorkerCoordinatorClient["renew"];
  submitResult: WorkerCoordinatorClient["submitResult"];
}

export interface WorkerRunnerOptions {
  readonly api: WorkerApi;
  readonly codex: CodexAdapter;
  readonly codexEstimatedCostUsdPerExecution: number;
  readonly git: GitAdapter;
  readonly githubToken: string;
  readonly leaseRenewalMs: number;
  readonly maxLogChunkBytes: number;
  readonly preflight?: (
    requirements: WorkerAssignment["required_tools"],
  ) => Promise<WorkerCapabilities>;
  readonly timeoutMs: number;
  readonly workerId: string;
  readonly worktreeRoot: string;
}

function sanitize(value: string): string {
  return value
    .replace(/\b(?:sk|gh[opusr])_[A-Za-z0-9_-]{10,}\b/g, "[REDACTED]")
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]");
}

function checksum(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function commandRecord(
  command: AllowedCommand,
  resolvedExecutable: string,
  startedAt: Date,
  finishedAt: Date,
  exitCode: number,
) {
  return {
    args: [...command.args],
    executable: resolvedExecutable,
    exit_code: exitCode,
    finished_at: finishedAt.toISOString(),
    started_at: startedAt.toISOString(),
    status: exitCode === 0 ? ("passed" as const) : ("failed" as const),
  };
}

export class WorkerRunner {
  constructor(private readonly options: WorkerRunnerOptions) {}

  async execute(assignment: WorkerAssignment): Promise<WorkerResult> {
    const startedAt = new Date();
    await (this.options.preflight ?? runPreflight)(assignment.required_tools);
    if (canonicalPayloadHash(assignment.specification) !== assignment.specification_hash) {
      throw new Error("Specification hash mismatch before execution");
    }
    const branchName = `atlas/task-${assignment.task_id.slice(0, 8)}-${assignment.execution_id.slice(0, 8)}`;
    const worktreePath = join(
      this.options.worktreeRoot,
      `${basename(assignment.repository_path)}-${assignment.execution_id}`,
    );
    const worktree: WorktreeRequest = {
      branchName,
      repositoryPath: assignment.repository_path,
      worktreePath,
    };
    const abortController = new AbortController();
    const lifecycle = {
      cancelRequested: false,
      readyToFinalize: false,
      terminalFailure: false,
    };
    let logsTruncated = false;
    let logSequence = 0;
    const logReferences: {
      checksum: string;
      created_at: string;
      sequence: number;
      size_bytes: number;
    }[] = [];
    const sendChunk = async (raw: string): Promise<void> => {
      const sanitized = Buffer.from(sanitize(raw));
      if (sanitized.byteLength > this.options.maxLogChunkBytes) logsTruncated = true;
      const safe = sanitized.subarray(0, this.options.maxLogChunkBytes).toString("utf8");
      const sequence = logSequence++;
      const digest = checksum(safe);
      await this.options.api.appendLog(this.options.workerId, assignment, {
        checksum: digest,
        content: safe,
        idempotencyKey: `execution:${assignment.execution_id}:log:${String(sequence)}`,
        sequence,
      });
      logReferences.push({
        checksum: digest,
        created_at: new Date().toISOString(),
        sequence,
        size_bytes: Buffer.byteLength(safe),
      });
    };
    const leaseTimer = setInterval(() => {
      void this.options.api
        .renew(
          this.options.workerId,
          assignment,
          `execution:${assignment.execution_id}:lease:${String(Date.now())}`,
        )
        .then((renewal) => {
          lifecycle.cancelRequested = renewal.cancelRequested;
          lifecycle.readyToFinalize = renewal.readyToFinalize;
          lifecycle.terminalFailure = renewal.terminalFailure;
          if (lifecycle.cancelRequested) abortController.abort();
        })
        .catch(() => {
          abortController.abort();
        });
    }, this.options.leaseRenewalMs);
    const timeout = setTimeout(() => {
      abortController.abort();
    }, this.options.timeoutMs);
    const commands: ReturnType<typeof commandRecord>[] = [];
    const tests: {
      command_index: number;
      duration_ms: number;
      name: string;
      status: "passed" | "failed" | "skipped";
      summary: string;
    }[] = [];
    let result: WorkerResult | undefined;
    let worktreeCreated = false;
    const metadataDirectory = await mkdtemp(join(tmpdir(), "atlas-worker-"));
    try {
      await mkdir(this.options.worktreeRoot, { recursive: true });
      await this.options.git.createWorktree(worktree);
      worktreeCreated = true;
      const specificationPath = join(metadataDirectory, "specification.json");
      const summaryPath = join(metadataDirectory, "codex-summary.json");
      await writeFile(specificationPath, JSON.stringify(assignment.specification, null, 2));
      const prompt = [
        "Implement only the validated Specification in the attached JSON.",
        "Do not expand scope or change architecture.",
        `Specification path: ${specificationPath}`,
        'Write the final message as JSON: {"summary":"...","risks":[],"pending_items":[]}.',
      ].join("\n");
      if (abortController.signal.aborted) {
        throw new Error(
          lifecycle.cancelRequested
            ? "Execution cancelled before Codex start"
            : "Execution aborted before Codex start",
        );
      }
      const codex = await this.options.codex.execute({
        abortSignal: abortController.signal,
        onChunk: sendChunk,
        prompt,
        summaryPath,
        taskId: assignment.task_id,
        worktreePath,
      });
      const authorized = authorizeCommands(assignment);
      for (const command of authorized) {
        const commandStartedAt = new Date();
        const commandResult = await executeAllowedCommand(
          command,
          worktreePath,
          abortController.signal,
        );
        const commandFinishedAt = new Date();
        commands.push(
          commandRecord(
            command,
            commandResult.resolvedExecutable,
            commandStartedAt,
            commandFinishedAt,
            commandResult.exitCode,
          ),
        );
        tests.push({
          command_index: commands.length - 1,
          duration_ms: commandFinishedAt.getTime() - commandStartedAt.getTime(),
          name: `${command.executable} ${command.args.join(" ")}`.trim(),
          status: commandResult.exitCode === 0 ? "passed" : "failed",
          summary: sanitize(commandResult.output).slice(0, 2_000),
        });
      }
      const diff = await this.options.git.diff(worktreePath);
      const protectedMatches = findProtectedPathMatches(
        diff.changedPaths,
        assignment.protected_globs,
      );
      // Streaming callbacks may finish out of order even though each receives a
      // monotonically increasing sequence. The result contract requires its
      // references to be ordered, while the database remains the authority for
      // the chunks themselves.
      const orderedLogReferences = [...logReferences].sort(
        (left, right) => left.sequence - right.sequence,
      );
      const succeeded = codex.exitCode === 0 && tests.every((test) => test.status === "passed");
      result = createWorkerResult({
        changed_paths: [...diff.changedPaths],
        codex_estimated_cost_usd: this.options.codexEstimatedCostUsdPerExecution,
        commands,
        contract_version: WORKER_RESULT_CONTRACT_VERSION,
        diff_hash: checksum(diff.content),
        diff_ref: `execution:${assignment.execution_id}:diff`,
        diff_summary: {
          deletions: diff.deletions,
          description: `${String(diff.filesChanged)} changed files`,
          files_changed: diff.filesChanged,
          insertions: diff.insertions,
        },
        error: succeeded ? null : { code: "EXECUTION_FAILED", message: "Codex or tests failed" },
        execution_id: assignment.execution_id,
        failure_stage: succeeded ? null : "testing",
        finished_at: new Date().toISOString(),
        idempotency_key: `execution:${assignment.execution_id}:result`,
        log_chunks: orderedLogReferences,
        logs_truncated: logsTruncated,
        pending_items: [...codex.summary.pendingItems],
        protected_path_matches: [...protectedMatches],
        redaction_applied: true,
        risks: [...codex.summary.risks],
        sequence: 1,
        specification_hash: assignment.specification_hash,
        specification_id: assignment.specification_id,
        specification_version: assignment.specification_version,
        started_at: startedAt.toISOString(),
        status: succeeded ? "succeeded" : "failed",
        summary: sanitize(codex.summary.summary),
        task_id: assignment.task_id,
        tests,
        worker_id: this.options.workerId,
      });
      const submitted = await this.options.api.submitResult(
        this.options.workerId,
        assignment,
        result,
      );
      lifecycle.readyToFinalize = submitted.state === "FINALIZING";
      if (submitted.state === "FAILED" || submitted.state === "CANCELLED") {
        return result;
      }
      while (
        !lifecycle.readyToFinalize &&
        !lifecycle.cancelRequested &&
        !lifecycle.terminalFailure
      ) {
        await new Promise((resolve) => setTimeout(resolve, this.options.leaseRenewalMs));
      }
      if (lifecycle.terminalFailure) {
        return result;
      }
      if (lifecycle.cancelRequested) {
        throw new Error("Execution cancelled");
      }
      if (result.status === "succeeded") {
        const finalization = await this.options.git.finalize({
          branchName,
          commitMessage: `feat: complete ATLAS task ${assignment.task_id}`,
          githubToken: this.options.githubToken,
          worktreePath,
        });
        await this.options.api.finalize(this.options.workerId, assignment, {
          ...finalization,
          idempotencyKey: `execution:${assignment.execution_id}:git-finalization`,
        });
      }
      return result;
    } catch (error: unknown) {
      if (!worktreeCreated) throw error;
      const diff = await this.options.git.diff(worktreePath);
      const cancelled = lifecycle.cancelRequested;
      const orderedLogReferences = [...logReferences].sort(
        (left, right) => left.sequence - right.sequence,
      );
      result = createWorkerResult({
        changed_paths: [...diff.changedPaths],
        codex_estimated_cost_usd: this.options.codexEstimatedCostUsdPerExecution,
        commands,
        contract_version: WORKER_RESULT_CONTRACT_VERSION,
        diff_hash: checksum(diff.content),
        diff_ref: `execution:${assignment.execution_id}:diff`,
        diff_summary: {
          deletions: diff.deletions,
          description: `${String(diff.filesChanged)} changed files`,
          files_changed: diff.filesChanged,
          insertions: diff.insertions,
        },
        error: {
          code: cancelled ? "EXECUTION_CANCELLED" : "WORKER_EXECUTION_FAILED",
          message: sanitize(error instanceof Error ? error.message : "Unknown worker error"),
        },
        execution_id: assignment.execution_id,
        failure_stage: cancelled ? null : abortController.signal.aborted ? "timeout" : "worker",
        finished_at: new Date().toISOString(),
        idempotency_key: `execution:${assignment.execution_id}:result`,
        log_chunks: orderedLogReferences,
        logs_truncated: logsTruncated,
        pending_items: [],
        protected_path_matches: [
          ...findProtectedPathMatches(diff.changedPaths, assignment.protected_globs),
        ],
        redaction_applied: true,
        risks: [],
        sequence: 1,
        specification_hash: assignment.specification_hash,
        specification_id: assignment.specification_id,
        specification_version: assignment.specification_version,
        started_at: startedAt.toISOString(),
        status: cancelled ? "cancelled" : "failed",
        summary: cancelled ? "Execution cancelled and cleaned up" : "Execution failed",
        task_id: assignment.task_id,
        tests,
        worker_id: this.options.workerId,
      });
      await this.options.api.submitResult(this.options.workerId, assignment, result);
      return result;
    } finally {
      clearInterval(leaseTimer);
      clearTimeout(timeout);
      if (worktreeCreated) {
        await this.options.git.removeWorktree(worktree);
      }
      await rm(metadataDirectory, { force: true, recursive: true });
    }
  }
}

export class WorkerConcurrencyGate {
  private active = 0;

  constructor(readonly limit = 1) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error("Worker concurrency limit must be a positive integer");
    }
  }

  async run<Output>(operation: () => Promise<Output>): Promise<Output> {
    if (this.active >= this.limit) {
      throw new Error("WORKER_CONCURRENCY_LIMIT");
    }
    this.active += 1;
    try {
      return await operation();
    } finally {
      this.active -= 1;
    }
  }
}

export function workerStartupCapabilities(): Promise<WorkerCapabilities> {
  return runPreflight();
}
