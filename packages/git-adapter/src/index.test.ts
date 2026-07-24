import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { GitCliAdapter } from "./index.js";

const exec = promisify(execFile);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

describe("GitCliAdapter", () => {
  it("creates, inspects and safely removes an isolated worktree", async () => {
    const root = await mkdtemp(join(tmpdir(), "atlas-git-adapter-"));
    temporaryDirectories.push(root);
    const repositoryPath = join(root, "repository");
    const worktreePath = join(root, "worktree");
    await exec("git", ["init", "-b", "main", repositoryPath]);
    await writeFile(join(repositoryPath, "README.md"), "initial\n");
    await exec("git", ["-C", repositoryPath, "add", "README.md"]);
    await exec("git", [
      "-C",
      repositoryPath,
      "-c",
      "user.name=ATLAS Test",
      "-c",
      "user.email=atlas@example.invalid",
      "commit",
      "-m",
      "initial",
    ]);
    const adapter = new GitCliAdapter();
    const request = {
      branchName: "atlas/test-task",
      repositoryPath,
      worktreePath,
    };

    await adapter.createWorktree(request);
    await writeFile(join(worktreePath, "README.md"), "changed\n");
    await writeFile(join(worktreePath, "new-file.txt"), "new\n");
    const diff = await adapter.diff(worktreePath);

    expect(diff.changedPaths).toEqual(["README.md", "new-file.txt"]);
    expect(diff.filesChanged).toBe(2);
    expect(diff.content).toContain("new-file.txt");
    await adapter.removeWorktree(request);
    await expect(
      exec("git", ["-C", repositoryPath, "show-ref", "atlas/test-task"]),
    ).rejects.toThrow();
  });
});
