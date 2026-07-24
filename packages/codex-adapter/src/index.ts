import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";

export interface CodexExecutionRequest {
  readonly abortSignal: AbortSignal;
  readonly prompt: string;
  readonly taskId: string;
  readonly worktreePath: string;
  readonly summaryPath: string;
  readonly onChunk: (chunk: string) => Promise<void>;
}

export interface CodexExecutionSummary {
  readonly summary: string;
  readonly risks: readonly string[];
  readonly pendingItems: readonly string[];
}

export interface CodexExecutionResult {
  readonly exitCode: number;
  readonly summary: CodexExecutionSummary;
}

export interface CodexAdapter {
  execute(request: CodexExecutionRequest): Promise<CodexExecutionResult>;
}

export class CodexCliAdapter implements CodexAdapter {
  async execute(request: CodexExecutionRequest): Promise<CodexExecutionResult> {
    const child = spawn(
      "codex",
      ["exec", "--json", "--output-last-message", request.summaryPath, "-"],
      {
        cwd: request.worktreePath,
        detached: true,
        env: process.env,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    const flushes: Promise<void>[] = [];
    const stream = (
      source: NodeJS.ReadableStream & { pause(): unknown; resume(): unknown },
      chunk: Buffer,
    ): void => {
      source.pause();
      const flush = request.onChunk(chunk.toString("utf8")).finally(() => {
        source.resume();
      });
      flushes.push(flush);
    };
    child.stdout.on("data", (chunk: Buffer) => {
      stream(child.stdout, chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stream(child.stderr, chunk);
    });
    const abort = (): void => {
      if (child.pid !== undefined) {
        const processGroup = -child.pid;
        try {
          process.kill(processGroup, "SIGTERM");
        } catch {
          child.kill("SIGTERM");
        }
        setTimeout(() => {
          if (child.exitCode === null) {
            try {
              process.kill(processGroup, "SIGKILL");
            } catch {
              child.kill("SIGKILL");
            }
          }
        }, 5_000).unref();
      }
    };
    request.abortSignal.addEventListener("abort", abort, { once: true });
    child.stdin.end(request.prompt);
    const exitCode = await new Promise<number>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code) => {
        resolve(code ?? 1);
      });
    });
    request.abortSignal.removeEventListener("abort", abort);
    await Promise.all(flushes);
    const rawSummary = JSON.parse(await readFile(request.summaryPath, "utf8")) as unknown;
    if (
      typeof rawSummary !== "object" ||
      rawSummary === null ||
      !("summary" in rawSummary) ||
      typeof rawSummary.summary !== "string"
    ) {
      throw new Error("Codex did not produce the required structured summary");
    }
    return {
      exitCode,
      summary: {
        summary: rawSummary.summary,
        risks:
          "risks" in rawSummary && Array.isArray(rawSummary.risks)
            ? rawSummary.risks.filter((value): value is string => typeof value === "string")
            : [],
        pendingItems:
          "pending_items" in rawSummary && Array.isArray(rawSummary.pending_items)
            ? rawSummary.pending_items.filter((value): value is string => typeof value === "string")
            : [],
      },
    };
  }
}
