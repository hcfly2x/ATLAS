import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { parse } from "yaml";
import { z } from "zod";

const protectedPathsSchema = z.object({
  projects: z.record(
    z.object({
      effective_globs: z.array(z.string()),
    }),
  ),
});

export async function loadProtectedGlobs(
  path = resolve(process.cwd(), "../../.atlas/protected-paths.yaml"),
): Promise<ReadonlyMap<string, readonly string[]>> {
  const config = protectedPathsSchema.parse(parse(await readFile(path, "utf8")));
  return new Map(
    Object.entries(config.projects).map(([projectId, project]) => [
      projectId,
      project.effective_globs,
    ]),
  );
}
