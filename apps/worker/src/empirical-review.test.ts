import { describe, expect, it, vi } from "vitest";

import { canonicalPayloadHash, type WorkerAssignment } from "@atlas/shared";

import { findUnexpectedPaths, runEmpiricalReview } from "./empirical-review.js";

const workerId = "10000000-0000-4000-8000-000000000005";

function assignment(): WorkerAssignment {
  const specification = {
    acceptance_criteria: ["validated"],
    allowed_commands: [],
    approval_required_for: [],
    authorized_scope: ["docs/**"],
    constraints: [],
    context: [],
    delivery_mode: "repository_change" as const,
    expected_delivery: "PR",
    implementation_strategy: ["edit"],
    objective: "test empirical review",
    out_of_scope: [],
    project_id: "atlas",
    required_tests: ["pnpm validate"],
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
    protected_globs: [],
    repository_path: "/tmp/atlas",
    required_tools: { codex_cli: null, git: null, gnu_tools: [], node: null },
    runtime: {
      allowed_commands: [
        { args: ["install", "--frozen-lockfile"], executable: "pnpm" },
        { args: ["validate"], executable: "pnpm" },
      ],
      bootstrap: [{ args: ["install", "--frozen-lockfile"], executable: "pnpm" }],
      forbidden_commands: [],
      package_manager: "pnpm",
      timeout_minutes: 1,
      validate: [{ args: ["validate"], executable: "pnpm" }],
    },
    specification,
    specification_hash: canonicalPayloadHash(specification),
    specification_id: "10000000-0000-4000-8000-000000000004",
    specification_version: 1,
    task_id: specification.task_id,
  };
}

describe("runEmpiricalReview", () => {
  it("records a passing advisory review without raw args or output", async () => {
    const input = assignment();
    input.runtime?.validate[0]?.args.push("SECRET_VALUE");
    input.runtime?.allowed_commands[1]?.args.push("SECRET_VALUE");
    const review = await runEmpiricalReview({
      assignment: input,
      changedPaths: ["docs/readme.md"],
      executeCommand: (command) =>
        Promise.resolve({
          aborted: false,
          exitCode: 0,
          output: `token=SECRET_VALUE ${command.args.join(" ")}`,
          resolvedExecutable: command.executable,
        }),
      reviewerId: workerId,
      timeoutMs: 1_000,
      worktreePath: "/tmp/worktree",
    });

    expect(review.verdict).toBe("pass");
    expect(review.commands).toHaveLength(2);
    expect(JSON.stringify(review)).not.toContain("SECRET_VALUE");
  });

  it("records failed validation and scope escape as fail, without becoming authoritative", async () => {
    const review = await runEmpiricalReview({
      assignment: assignment(),
      changedPaths: ["src/sk_123456789012345.ts"],
      executeCommand: (command) =>
        Promise.resolve({
          aborted: false,
          exitCode: command.args[0] === "validate" ? 1 : 0,
          output: "failure payload",
          resolvedExecutable: command.executable,
        }),
      reviewerId: workerId,
      timeoutMs: 1_000,
      worktreePath: "/tmp/worktree",
    });
    expect(review).toMatchObject({
      scope_matches: false,
      verdict: "fail",
    });
    expect(review.unexpected_path_hashes).toEqual([
      canonicalPayloadHash("src/sk_123456789012345.ts"),
    ]);
    expect(JSON.stringify(review)).not.toContain("sk_123456789012345");
  });

  it("denies undeclared commands without executing them", async () => {
    const input = assignment();
    input.runtime?.allowed_commands.pop();
    const execute = vi.fn();
    const review = await runEmpiricalReview({
      assignment: input,
      changedPaths: [],
      executeCommand: execute,
      reviewerId: workerId,
      timeoutMs: 1_000,
      worktreePath: "/tmp/worktree",
    });
    expect(review).toMatchObject({
      unavailable_reason_code: "command_denied",
      verdict: "unavailable",
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("turns throws and timeouts into unavailable evidence", async () => {
    const thrown = await runEmpiricalReview({
      assignment: assignment(),
      changedPaths: [],
      executeCommand: () => Promise.reject(new Error("Bearer secret-token")),
      reviewerId: workerId,
      timeoutMs: 1_000,
      worktreePath: "/tmp/worktree",
    });
    expect(thrown).toMatchObject({
      unavailable_reason_code: "execution_error",
      verdict: "unavailable",
    });
    expect(JSON.stringify(thrown)).not.toContain("secret-token");

    const timedOut = await runEmpiricalReview({
      assignment: assignment(),
      changedPaths: [],
      executeCommand: (_command, _cwd, signal) =>
        new Promise((resolve) => {
          signal.addEventListener(
            "abort",
            () => {
              resolve({
                aborted: true,
                exitCode: 124,
                output: "raw timeout payload",
                resolvedExecutable: "pnpm",
              });
            },
            { once: true },
          );
        }),
      reviewerId: workerId,
      timeoutMs: 1,
      worktreePath: "/tmp/worktree",
    });
    expect(timedOut).toMatchObject({
      unavailable_reason_code: "timeout",
      verdict: "unavailable",
    });
  });

  it("fails closed for unsafe diff paths", () => {
    expect(findUnexpectedPaths(["docs/readme.md", "../.env.local"], ["docs/**"])).toEqual([
      "../.env.local",
    ]);
  });
});
