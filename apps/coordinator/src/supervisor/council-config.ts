import { readFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";

import { taskComplexitySchema, type TaskComplexity } from "@atlas/shared";
import { parse } from "yaml";
import { z } from "zod";

const agentRegistrySchema = z.object({
  teams: z.record(
    z.object({
      supervisor: z.string().min(1),
      agents: z.array(z.string().min(1)).min(1),
    }),
  ),
  agents: z.record(
    z.object({
      file: z.string().min(1),
    }),
  ),
});

const routingSchema = z.object({
  routing: z.record(
    taskComplexitySchema,
    z.object({
      agents: z.array(z.string().min(1)).min(1),
    }),
  ),
});

export interface CouncilAgent {
  readonly id: string;
  readonly instructions: string;
}

export interface CouncilConfig {
  readonly agents: ReadonlyMap<string, CouncilAgent>;
  readonly routes: Readonly<Record<TaskComplexity, readonly string[]>>;
  readonly supervisorId: string;
}

function assertInsideRoot(root: string, candidate: string): void {
  const pathFromRoot = relative(root, candidate);
  if (pathFromRoot.startsWith("..") || pathFromRoot.startsWith("/")) {
    throw new Error(`Agent instruction path escapes the repository: ${candidate}`);
  }
}

export async function loadCouncilConfig(
  agentsPath: string,
  routingPath: string,
): Promise<CouncilConfig> {
  const [agentSource, routingSource] = await Promise.all([
    readFile(agentsPath, "utf8"),
    readFile(routingPath, "utf8"),
  ]);
  const registry = agentRegistrySchema.parse(parse(agentSource));
  const routing = routingSchema.parse(parse(routingSource));
  const engineeringCouncil = registry.teams.engineering_council;
  if (engineeringCouncil === undefined) {
    throw new Error("engineering_council is required");
  }

  const repositoryRoot = dirname(dirname(resolve(agentsPath)));
  const agents = new Map<string, CouncilAgent>();
  for (const agentId of new Set([...engineeringCouncil.agents, engineeringCouncil.supervisor])) {
    const definition = registry.agents[agentId];
    if (definition === undefined) {
      throw new Error(`Council agent is not registered: ${agentId}`);
    }
    const instructionPath = resolve(repositoryRoot, definition.file);
    assertInsideRoot(repositoryRoot, instructionPath);
    agents.set(agentId, {
      id: agentId,
      instructions: await readFile(instructionPath, "utf8"),
    });
  }

  if (!agents.has(engineeringCouncil.supervisor)) {
    throw new Error("Council supervisor must be registered in the engineering council");
  }

  const routeFor = (complexity: TaskComplexity): readonly string[] => {
    const definition = routing.routing[complexity];
    if (definition === undefined) {
      throw new Error(`Council route is missing: ${complexity}`);
    }
    const route = definition.agents;
    if (route.at(-1) !== engineeringCouncil.supervisor) {
      throw new Error(`${complexity} route must end with the engineering supervisor`);
    }
    if (route.filter((agentId) => agentId === engineeringCouncil.supervisor).length !== 1) {
      throw new Error(`${complexity} route must contain the supervisor exactly once`);
    }
    if (new Set(route).size !== route.length) {
      throw new Error(`${complexity} route cannot contain duplicate agents`);
    }
    for (const agentId of route) {
      if (!agents.has(agentId)) {
        throw new Error(`${complexity} route references an unregistered agent: ${agentId}`);
      }
    }
    return route;
  };
  const routes: Record<TaskComplexity, readonly string[]> = {
    critical: routeFor("critical"),
    moderate: routeFor("moderate"),
    simple: routeFor("simple"),
  };

  return {
    agents,
    routes,
    supervisorId: engineeringCouncil.supervisor,
  };
}
