import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { realpath } from "node:fs/promises";
import { dirname, sep } from "node:path";

const execFileAsync = promisify(execFile);

export interface WorktreeRequest {
  readonly repositoryPath: string;
  readonly branchName: string;
  readonly worktreePath: string;
}

export interface GitDiff {
  readonly changedPaths: readonly string[];
  readonly content: string;
  readonly deletions: number;
  readonly filesChanged: number;
  readonly insertions: number;
}

export interface GitFinalization {
  readonly commitSha: string;
  readonly pullRequestUrl: string;
}

export interface GitAdapter {
  createWorktree(request: WorktreeRequest): Promise<void>;
  diff(worktreePath: string): Promise<GitDiff>;
  finalize(input: {
    branchName: string;
    commitMessage: string;
    githubToken: string;
    worktreePath: string;
  }): Promise<GitFinalization>;
  removeWorktree(request: WorktreeRequest): Promise<void>;
}

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const result = await execFileAsync("git", [...args], {
    cwd,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  return result.stdout.trim();
}

function parseNumstat(output: string): Pick<GitDiff, "deletions" | "filesChanged" | "insertions"> {
  let deletions = 0;
  let filesChanged = 0;
  let insertions = 0;
  for (const line of output.split("\n").filter(Boolean)) {
    const [added, removed] = line.split("\t");
    filesChanged += 1;
    insertions += added === "-" ? 0 : Number(added);
    deletions += removed === "-" ? 0 : Number(removed);
  }
  return { deletions, filesChanged, insertions };
}

export class GitCliAdapter implements GitAdapter {
  async createWorktree(request: WorktreeRequest): Promise<void> {
    await git(request.repositoryPath, [
      "worktree",
      "add",
      "-b",
      request.branchName,
      request.worktreePath,
      "HEAD",
    ]);
  }

  async diff(worktreePath: string): Promise<GitDiff> {
    await git(worktreePath, ["add", "--intent-to-add", "--all"]);
    const [content, names, numstat] = await Promise.all([
      git(worktreePath, ["diff", "--binary", "HEAD"]),
      git(worktreePath, ["diff", "--name-only", "HEAD"]),
      git(worktreePath, ["diff", "--numstat", "HEAD"]),
    ]);
    return {
      changedPaths: names.split("\n").filter(Boolean),
      content,
      ...parseNumstat(numstat),
    };
  }

  async finalize(input: {
    branchName: string;
    commitMessage: string;
    githubToken: string;
    worktreePath: string;
  }): Promise<GitFinalization> {
    await git(input.worktreePath, ["add", "--all"]);
    await git(input.worktreePath, [
      "-c",
      "user.name=ATLAS Worker",
      "-c",
      "user.email=atlas-worker@users.noreply.github.com",
      "commit",
      "-m",
      input.commitMessage,
    ]);
    const commitSha = await git(input.worktreePath, ["rev-parse", "HEAD"]);
    await git(input.worktreePath, ["push", "--set-upstream", "origin", input.branchName]);
    const remote = await git(input.worktreePath, ["remote", "get-url", "origin"]);
    const match = /github\.com[/:]([^/]+)\/([^/.]+)(?:\.git)?$/.exec(remote);
    if (match?.[1] === undefined || match[2] === undefined) {
      throw new Error("origin is not a supported GitHub repository");
    }
    const headers = {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${input.githubToken}`,
      "Content-Type": "application/json",
      "User-Agent": "atlas-worker",
    };
    const existing = await fetch(
      `https://api.github.com/repos/${match[1]}/${match[2]}/pulls?state=open&head=${encodeURIComponent(`${match[1]}:${input.branchName}`)}`,
      { headers },
    );
    if (!existing.ok) {
      throw new Error(`GitHub pull request lookup failed (${String(existing.status)})`);
    }
    const existingPayload = (await existing.json()) as { html_url?: unknown }[];
    if (typeof existingPayload[0]?.html_url === "string") {
      return { commitSha, pullRequestUrl: existingPayload[0].html_url };
    }
    const response = await fetch(`https://api.github.com/repos/${match[1]}/${match[2]}/pulls`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        base: "main",
        body: "Automated ATLAS worker delivery. Merge remains human.",
        draft: true,
        head: input.branchName,
        title: input.commitMessage,
      }),
    });
    if (!response.ok) {
      throw new Error(`GitHub pull request creation failed (${String(response.status)})`);
    }
    const payload = (await response.json()) as { html_url?: unknown };
    if (typeof payload.html_url !== "string") {
      throw new Error("GitHub did not return a pull request URL");
    }
    return { commitSha, pullRequestUrl: payload.html_url };
  }

  async removeWorktree(request: WorktreeRequest): Promise<void> {
    const repository = await realpath(request.repositoryPath);
    const target = await realpath(request.worktreePath);
    if (
      target === repository ||
      dirname(target) === target ||
      repository.startsWith(`${target}${sep}`)
    ) {
      throw new Error("unsafe worktree cleanup target");
    }
    await git(repository, ["worktree", "remove", "--force", target]);
    await git(repository, ["branch", "-D", request.branchName]);
  }
}
