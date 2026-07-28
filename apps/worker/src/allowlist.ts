import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { delimiter, join } from "node:path";

import type { WorkerAssignment, WorkerRuntime } from "@atlas/shared";

export interface AllowedCommand {
  readonly executable: string;
  readonly args: readonly string[];
}

const safeToken = /^[A-Za-z0-9_./:@%+=,-]+$/;
export const GNU_ONLY_EXECUTABLES = [
  "gdate",
  "gfind",
  "ggrep",
  "greadlink",
  "gsed",
  "gstat",
  "gxargs",
] as const;
const gnuOnlyExecutables = new Set<string>(GNU_ONLY_EXECUTABLES);

export class CommandNotAllowedError extends Error {
  readonly code = "COMMAND_NOT_ALLOWED";
}

export function parseSpecificationCommand(command: string): AllowedCommand {
  const tokens = command.trim().split(/\s+/);
  if (tokens.length === 0 || tokens.some((token) => !safeToken.test(token))) {
    throw new CommandNotAllowedError("Shell syntax and unsafe command tokens are forbidden");
  }
  const executable = tokens[0];
  if (executable === undefined) {
    throw new CommandNotAllowedError("Command is empty");
  }
  return { args: tokens.slice(1), executable };
}

export function authorizeCommands(assignment: WorkerAssignment): readonly AllowedCommand[] {
  return authorizeConfiguredCommands(
    assignment.specification.allowed_commands.map(parseSpecificationCommand),
    assignment.allowed_commands,
    [],
    assignment.required_tools.gnu_tools,
    "Specification command",
  );
}

export function authorizeRuntimeCommands(
  runtime: WorkerRuntime,
  phase: "bootstrap" | "validate",
  gnuTools: readonly string[],
): readonly AllowedCommand[] {
  return authorizeConfiguredCommands(
    runtime[phase],
    runtime.allowed_commands,
    runtime.forbidden_commands,
    gnuTools,
    `Runtime ${phase} command`,
  );
}

function authorizeConfiguredCommands(
  requestedCommands: readonly AllowedCommand[],
  allowedCommands: readonly AllowedCommand[],
  forbiddenCommands: readonly AllowedCommand[],
  gnuTools: readonly string[],
  label: string,
): readonly AllowedCommand[] {
  return requestedCommands.map((command) => {
    if (
      !safeToken.test(command.executable) ||
      command.args.some((argument) => !safeToken.test(argument))
    ) {
      throw new CommandNotAllowedError(`${label} contains unsafe shell syntax`);
    }
    if (gnuOnlyExecutables.has(command.executable) && !gnuTools.includes(command.executable)) {
      throw new CommandNotAllowedError(
        `GNU tool is not declared by the project: ${command.executable}`,
      );
    }
    if (forbiddenCommands.some((forbidden) => forbiddenCommandMatches(forbidden, command))) {
      throw new CommandNotAllowedError(`${label} is forbidden by the project manifest`);
    }
    if (!allowedCommands.some((allowed) => exactCommandMatches(allowed, command))) {
      throw new CommandNotAllowedError(`${label} is outside the project allowlist`);
    }
    return { args: [...command.args], executable: command.executable };
  });
}

function exactCommandMatches(left: AllowedCommand, right: AllowedCommand): boolean {
  return (
    left.executable === right.executable &&
    left.args.length === right.args.length &&
    left.args.every((argument, index) => argument === right.args[index])
  );
}

function forbiddenCommandMatches(forbidden: AllowedCommand, requested: AllowedCommand): boolean {
  return (
    forbidden.executable === requested.executable &&
    (forbidden.args.length === 0 || exactCommandMatches(forbidden, requested))
  );
}

export async function executeAllowedCommand(
  command: AllowedCommand,
  cwd: string,
  signal: AbortSignal,
): Promise<{ aborted: boolean; exitCode: number; output: string; resolvedExecutable: string }> {
  const resolvedExecutable = await resolveExecutable(command.executable);
  const child = spawn(resolvedExecutable, [...command.args], {
    cwd,
    detached: true,
    shell: false,
    signal,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => {
    output += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk: Buffer) => {
    output += chunk.toString("utf8");
  });
  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once("error", (error) => {
      if (signal.aborted) {
        resolve(124);
        return;
      }
      reject(error);
    });
    child.once("close", (code) => {
      resolve(code ?? 1);
    });
  });
  return { aborted: signal.aborted, exitCode, output, resolvedExecutable };
}

async function resolveExecutable(executable: string): Promise<string> {
  if (executable.includes("/")) {
    await access(executable);
    return executable;
  }
  for (const directory of (process.env.PATH ?? "").split(delimiter).filter(Boolean)) {
    const candidate = join(directory, executable);
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Continue searching PATH.
    }
  }
  throw new CommandNotAllowedError(`Executable not found: ${executable}`);
}
