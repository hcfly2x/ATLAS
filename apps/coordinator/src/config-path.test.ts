import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { defaultAtlasConfigPath } from "./config-path.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("defaultAtlasConfigPath", () => {
  it("uses the repository root when the compiled coordinator path has no adjacent .atlas", async () => {
    const root = await mkdtemp(join(tmpdir(), "atlas-config-path-"));
    directories.push(root);
    const configPath = join(root, ".atlas", "projects.yaml");
    await mkdir(join(root, "apps", "coordinator", "dist", "src"), { recursive: true });
    await mkdir(join(root, ".atlas"), { recursive: true });
    await writeFile(configPath, "projects: []\n");

    expect(
      defaultAtlasConfigPath(
        "projects.yaml",
        pathToFileURL(join(root, "apps", "coordinator", "dist", "src", "main.js")).href,
        root,
      ),
    ).toBe(configPath);
  });
});
