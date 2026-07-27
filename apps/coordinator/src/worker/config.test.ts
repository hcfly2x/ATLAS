import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { parse } from "yaml";
import { z } from "zod";
import { describe, expect, it } from "vitest";

import { loadProtectedGlobs } from "./config.js";

const envGlob = "**/.env*";
const protectedPathsUrl = new URL("../../../../.atlas/protected-paths.yaml", import.meta.url);
const protectedPathsSchema = z.object({
  projects: z.object({
    atlas: z.object({
      effective_globs: z.array(z.string()),
      semantic_areas: z.object({
        secrets: z.array(z.string()),
      }),
    }),
  }),
});

describe("protected paths configuration", () => {
  it("keeps nested env protection equivalent in semantic and effective globs", async () => {
    const document = protectedPathsSchema.parse(parse(await readFile(protectedPathsUrl, "utf8")));
    const semanticEnvGlobs = document.projects.atlas.semantic_areas.secrets.filter((glob) =>
      glob.includes(".env"),
    );
    const effectiveEnvGlobs = document.projects.atlas.effective_globs.filter((glob) =>
      glob.includes(".env"),
    );

    expect(semanticEnvGlobs).toEqual([envGlob]);
    expect(effectiveEnvGlobs).toEqual([envGlob]);
  });

  it("loads the nested env glob for the atlas worker assignment", async () => {
    const globs = await loadProtectedGlobs(fileURLToPath(protectedPathsUrl));

    expect(globs.get("atlas")).toContain(envGlob);
    expect(globs.get("atlas")).not.toContain(".env*");
  });
});
