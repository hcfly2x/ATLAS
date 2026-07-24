import { access } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import semver from "semver";

import type { WorkerCapabilities, WorkerAssignment } from "@atlas/shared";

const execFileAsync = promisify(execFile);

export class PreflightError extends Error {
  readonly code = "WORKER_PREFLIGHT_FAILED";
}

async function resolveExecutable(name: string): Promise<string> {
  if (name.includes("/")) {
    await access(name);
    return name;
  }
  for (const directory of (process.env.PATH ?? "").split(delimiter).filter(Boolean)) {
    const candidate = join(directory, name);
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Continue searching PATH.
    }
  }
  throw new PreflightError(`Required executable not found: ${name}`);
}

async function versionOf(executable: string): Promise<string> {
  const result = await execFileAsync(executable, ["--version"], {
    encoding: "utf8",
    timeout: 10_000,
  });
  return `${result.stdout}${result.stderr}`.trim().split("\n")[0] ?? "";
}

function assertMinimum(label: string, actual: string, minimum: string | null): void {
  if (minimum === null) return;
  const actualVersion = semver.coerce(actual);
  const minimumVersion = semver.coerce(minimum);
  if (
    actualVersion === null ||
    minimumVersion === null ||
    semver.lt(actualVersion, minimumVersion)
  ) {
    throw new PreflightError(`${label} ${actual} does not satisfy minimum ${minimum}`);
  }
}

export async function runPreflight(
  requirements?: WorkerAssignment["required_tools"],
): Promise<WorkerCapabilities> {
  if (process.platform !== "darwin" || process.arch !== "arm64") {
    throw new PreflightError(
      `MVP worker requires darwin/arm64; received ${process.platform}/${process.arch}`,
    );
  }
  const git = await resolveExecutable("git");
  const codex = await resolveExecutable("codex");
  const gitVersion = await versionOf(git);
  const codexVersion = await versionOf(codex);
  assertMinimum("Node", process.version, requirements?.node ?? null);
  assertMinimum("Git", gitVersion, requirements?.git ?? null);
  assertMinimum("Codex CLI", codexVersion, requirements?.codex_cli ?? null);
  const tools: Record<string, string> = { codex, git, node: process.execPath };
  for (const tool of requirements?.gnu_tools ?? []) {
    const resolved = await resolveExecutable(tool);
    const version = await versionOf(resolved);
    if (!version.toLowerCase().includes("gnu")) {
      throw new PreflightError(`${tool} is declared as GNU but did not identify as GNU`);
    }
    tools[tool] = resolved;
  }
  return {
    architecture: process.arch,
    codex_version: codexVersion,
    git_version: gitVersion,
    node_version: process.version,
    platform: process.platform,
    tools,
  };
}
