import { posix } from "node:path";

import { minimatch } from "minimatch";

import {
  canonicalPayloadHash,
  createEmpiricalReviewEvidence,
  type EmpiricalReviewEvidence,
  type WorkerAssignment,
  type WorkerRuntime,
} from "@atlas/shared";

import { executeAllowedCommand, type AllowedCommand } from "./allowlist.js";
import { authorizeRuntimeCommandsWithShadow } from "./command-enforcement-shadow.js";

type ExecuteCommand = typeof executeAllowedCommand;

export interface EmpiricalReviewOptions {
  readonly assignment: WorkerAssignment;
  readonly changedPaths: readonly string[];
  readonly executeCommand?: ExecuteCommand | undefined;
  readonly reviewerId: string;
  readonly timeoutMs: number;
  readonly worktreePath: string;
}

export function unavailableEmpiricalReview(input: {
  readonly assignment: WorkerAssignment;
  readonly changedPaths: readonly string[];
  readonly reasonCode: EmpiricalReviewEvidence["unavailable_reason_code"];
  readonly reviewerId: string;
}): EmpiricalReviewEvidence {
  const now = new Date().toISOString();
  return createEmpiricalReviewEvidence({
    changed_paths_hash: canonicalPayloadHash([...input.changedPaths].sort()),
    commands: [],
    expected_scope_hash: canonicalPayloadHash([...input.assignment.specification.authorized_scope]),
    finished_at: now,
    reviewer_id: input.reviewerId,
    scope_matches: false,
    started_at: now,
    unavailable_reason_code: input.reasonCode,
    unexpected_path_hashes: [],
    verdict: "unavailable",
  });
}

function normalizedRelativePath(value: string): string | undefined {
  if (value.includes("\\") || posix.isAbsolute(value)) return undefined;
  const normalized = posix.normalize(value);
  if (normalized === ".." || normalized.startsWith("../")) return undefined;
  return normalized.replace(/^\.\//, "");
}

function scopePattern(value: string): { glob: boolean; value: string } | undefined {
  const normalized = normalizedRelativePath(value.trim());
  if (normalized === undefined || normalized.length === 0) return undefined;
  return { glob: /[*?[\]{}()!+@]/.test(normalized), value: normalized.replace(/\/$/, "") };
}

export function findUnexpectedPaths(
  changedPaths: readonly string[],
  authorizedScope: readonly string[],
): string[] {
  const patterns = authorizedScope.map(scopePattern).filter((value) => value !== undefined);
  return changedPaths
    .map((path) => ({ original: path, normalized: normalizedRelativePath(path) }))
    .filter(
      (path) =>
        path.normalized === undefined ||
        !patterns.some((pattern) => {
          const normalized = path.normalized ?? "";
          return pattern.glob
            ? minimatch(normalized, pattern.value, {
                dot: true,
                matchBase: false,
                nocase: false,
              })
            : normalized === pattern.value || normalized.startsWith(`${pattern.value}/`);
        }),
    )
    .map((path) => path.original)
    .sort()
    .slice(0, 128);
}

function isFrozenInstall(runtime: WorkerRuntime, command: AllowedCommand): boolean {
  const args = [...command.args];
  switch (runtime.package_manager) {
    case "npm":
      return command.executable === "npm" && args[0] === "ci";
    case "pnpm":
      return (
        command.executable === "pnpm" && args[0] === "install" && args.includes("--frozen-lockfile")
      );
    case "yarn":
      return (
        command.executable === "yarn" &&
        args[0] === "install" &&
        (args.includes("--immutable") || args.includes("--frozen-lockfile"))
      );
    case "bun":
      return (
        command.executable === "bun" && args[0] === "install" && args.includes("--frozen-lockfile")
      );
    default:
      return false;
  }
}

function safeExecutable(value: string): string {
  return value.replace(/[^A-Za-z0-9_.+-]/g, "_").slice(0, 128) || "unknown";
}

export async function runEmpiricalReview(
  options: EmpiricalReviewOptions,
): Promise<EmpiricalReviewEvidence> {
  const startedAt = new Date();
  const base = {
    changed_paths_hash: canonicalPayloadHash([...options.changedPaths].sort()),
    expected_scope_hash: canonicalPayloadHash([
      ...options.assignment.specification.authorized_scope,
    ]),
    reviewer_id: options.reviewerId,
    started_at: startedAt.toISOString(),
  };
  const unexpectedPaths = findUnexpectedPaths(
    options.changedPaths,
    options.assignment.specification.authorized_scope,
  );
  const finish = (
    verdict: "pass" | "fail" | "unavailable",
    commands: EmpiricalReviewEvidence["commands"],
    unavailableReasonCode: EmpiricalReviewEvidence["unavailable_reason_code"],
  ): EmpiricalReviewEvidence =>
    createEmpiricalReviewEvidence({
      ...base,
      commands,
      finished_at: new Date().toISOString(),
      scope_matches: unexpectedPaths.length === 0,
      unavailable_reason_code: unavailableReasonCode,
      unexpected_path_hashes: unexpectedPaths.map((path) => canonicalPayloadHash(path)),
      verdict,
    });

  const runtime = options.assignment.runtime;
  if (runtime === null) return finish("unavailable", [], "runtime_manifest_missing");

  const frozenInstall = runtime.bootstrap.find((command) => isFrozenInstall(runtime, command));
  if (frozenInstall === undefined) {
    return finish("unavailable", [], "frozen_install_not_declared");
  }

  let commands: readonly AllowedCommand[];
  try {
    const installRuntime = { ...runtime, bootstrap: [frozenInstall] };
    commands = [
      ...authorizeRuntimeCommandsWithShadow(
        installRuntime,
        "bootstrap",
        options.assignment.required_tools.gnu_tools,
        {
          executionId: options.assignment.execution_id,
          taskId: options.assignment.task_id,
        },
      ),
      ...authorizeRuntimeCommandsWithShadow(
        runtime,
        "validate",
        options.assignment.required_tools.gnu_tools,
        {
          executionId: options.assignment.execution_id,
          taskId: options.assignment.task_id,
        },
      ),
    ];
  } catch {
    return finish("unavailable", [], "command_denied");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, options.timeoutMs);
  const evidence: EmpiricalReviewEvidence["commands"] = [];
  try {
    for (const command of commands) {
      const commandStartedAt = Date.now();
      const result = await (options.executeCommand ?? executeAllowedCommand)(
        command,
        options.worktreePath,
        controller.signal,
      );
      evidence.push({
        command_hash: canonicalPayloadHash(command),
        duration_ms: Math.max(0, Date.now() - commandStartedAt),
        executable: safeExecutable(command.executable),
        exit_code: result.exitCode,
        status: result.exitCode === 0 ? "passed" : "failed",
      });
      if (controller.signal.aborted) return finish("unavailable", evidence, "timeout");
    }
    return finish(
      evidence.every((command) => command.status === "passed") && unexpectedPaths.length === 0
        ? "pass"
        : "fail",
      evidence,
      null,
    );
  } catch {
    return finish(
      "unavailable",
      evidence,
      controller.signal.aborted ? "timeout" : "execution_error",
    );
  } finally {
    clearTimeout(timer);
  }
}
