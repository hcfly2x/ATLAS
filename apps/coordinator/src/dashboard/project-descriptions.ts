import { readFile } from "node:fs/promises";

import { parse } from "yaml";
import { z } from "zod";

const projectContextSchema = z
  .object({
    projects: z.array(
      z
        .object({
          description: z.string().max(2_000).optional(),
          id: z.string().min(1),
          purpose: z.string().max(2_000).optional(),
          scope: z.string().max(2_000).optional(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

export async function loadDashboardProjectDescriptions(
  path: string,
): Promise<ReadonlyMap<string, string>> {
  try {
    const config = projectContextSchema.parse(parse(await readFile(path, "utf8")));
    return new Map(
      config.projects.flatMap((project) => {
        const description = project.description ?? project.purpose ?? project.scope;
        return description === undefined ? [] : [[project.id, description] as const];
      }),
    );
  } catch {
    return new Map();
  }
}
