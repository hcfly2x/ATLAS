import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { delimiter, join } from "node:path";

import type { WorkerAssignment } from "@atlas/shared";

export interface AllowedCommand {
  readonly executable: string;
  readonly args: readonly string[];
}

const safeToken = /^[A-Za-z0-9_./:@%+=,-]+$/;
const gnuOnlyExecutables = new Set([
  "gdate",
  "gfind",
  "ggrep",
  "greadlink",
  "gsed",
  "gstat",
  "gxargs",
]);

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
  return assignment.specification.allowed_commands.map((raw) => {
    const requested = parseSpecificationCommand(raw);
    if (
      gnuOnlyExecutables.has(requested.executable) &&
      !assignment.required_tools.gnu_tools.includes(requested.executable)
    ) {
      throw new CommandNotAllowedError(
        `GNU tool is not declared by the project: ${requested.executable}`,
      );
    }
    const allowed = assignment.allowed_commands.some(
      (entry) =>
        entry.executable === requested.executable &&
        entry.args.length === requested.args.length &&
        entry.args.every((argument, index) => argument === requested.args[index]),
    );
    if (!allowed) {
      throw new CommandNotAllowedError(`Command is outside the project allowlist: ${raw}`);
    }
    return requested;
  });
}

export async function executeAllowedCommand(
  command: AllowedCommand,
  cwd: string,
  signal: AbortSignal,
): Promise<{ exitCode: number; output: string; resolvedExecutable: string }> {
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
    child.once("error", reject);
    child.once("close", (code) => {
      resolve(code ?? 1);
    });
  });
  return { exitCode, output, resolvedExecutable };
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
