import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { CodexCliAdapter } from "./index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

describe("CodexCliAdapter", () => {
  it("runs a fake non-interactive CLI without shell and parses its structured summary", async () => {
    const root = await mkdtemp(join(tmpdir(), "atlas-codex-adapter-"));
    temporaryDirectories.push(root);
    const executable = join(root, "codex");
    const summaryPath = join(root, "summary.json");
    await writeFile(
      executable,
      `#!/usr/bin/env node
const fs = require("node:fs");
const output = process.argv[process.argv.indexOf("--output-last-message") + 1];
process.stdin.resume();
process.stdin.on("end", () => {
  fs.writeFileSync(output, JSON.stringify({summary:"fake done",risks:[],pending_items:[]}));
  process.stdout.write("fake chunk");
});
`,
    );
    await chmod(executable, 0o755);
    const previousPath = process.env.PATH;
    process.env.PATH = `${root}${delimiter}${previousPath ?? ""}`;
    try {
      const chunks: string[] = [];
      const result = await new CodexCliAdapter().execute({
        abortSignal: new AbortController().signal,
        onChunk: (chunk) => {
          chunks.push(chunk);
          return Promise.resolve();
        },
        prompt: "validated specification only",
        summaryPath,
        taskId: "task",
        worktreePath: root,
      });

      expect(result).toEqual({
        exitCode: 0,
        summary: { pendingItems: [], risks: [], summary: "fake done" },
      });
      expect(chunks.join("")).toContain("fake chunk");
    } finally {
      process.env.PATH = previousPath;
    }
  });
});
