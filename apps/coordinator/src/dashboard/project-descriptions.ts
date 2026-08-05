import { readFile } from "node:fs/promises";

import { parse } from "yaml";
import { z } from "zod";

const projectContextSchema = z
  .object({
    projects: z.array(
      z
        .object({
          dashboard: z
            .object({
              description: z.string().max(2_000).optional(),
              plan: z.string().min(1).max(50_000).optional(),
            })
            .strict()
            .optional(),
          description: z.string().max(2_000).optional(),
          id: z.string().min(1),
          purpose: z.string().max(2_000).optional(),
          scope: z.string().max(2_000).optional(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

export interface DashboardProjectContext {
  readonly description?: string;
  readonly plan?: string;
}

export interface DashboardProjectContexts {
  readonly declaredProjectIds: ReadonlySet<string>;
  readonly descriptions: ReadonlyMap<string, string>;
  readonly plans: ReadonlyMap<string, string>;
}

export function parseDashboardGoLiveAt(value: string | undefined): Date | undefined {
  if (value === undefined || value.trim().length === 0) return undefined;
  const parsed = z.string().datetime({ offset: true }).safeParse(value);
  if (!parsed.success) {
    throw new Error("DASHBOARD_GO_LIVE_AT must be a valid ISO-8601 timestamp");
  }
  return new Date(parsed.data);
}

export async function loadDashboardProjectContexts(
  path: string,
): Promise<DashboardProjectContexts> {
  try {
    const config = projectContextSchema.parse(parse(await readFile(path, "utf8")));
    const contexts = new Map<string, DashboardProjectContext>();
    for (const project of config.projects) {
      const description =
        project.dashboard?.description ?? project.description ?? project.purpose ?? project.scope;
      contexts.set(project.id, {
        ...(description === undefined ? {} : { description }),
        ...(project.dashboard?.plan === undefined ? {} : { plan: project.dashboard.plan }),
      });
    }
    return {
      declaredProjectIds: new Set(contexts.keys()),
      descriptions: new Map(
        [...contexts].flatMap(([id, context]) =>
          context.description === undefined ? [] : [[id, context.description] as const],
        ),
      ),
      plans: new Map(
        [...contexts].flatMap(([id, context]) =>
          context.plan === undefined ? [] : [[id, context.plan] as const],
        ),
      ),
    };
  } catch {
    return { declaredProjectIds: new Set(), descriptions: new Map(), plans: new Map() };
  }
}

export async function loadDashboardProjectDescriptions(
  path: string,
): Promise<ReadonlyMap<string, string>> {
  return (await loadDashboardProjectContexts(path)).descriptions;
}
