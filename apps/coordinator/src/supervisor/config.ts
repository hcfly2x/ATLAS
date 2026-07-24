import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { parse } from "yaml";
import { z } from "zod";

const policiesSchema = z.object({
  policies: z.object({
    always_human: z.array(z.string().min(1)),
  }),
});

async function defaultPoliciesPath(): Promise<string> {
  const candidates = [
    resolve(process.cwd(), ".atlas/policies.yaml"),
    resolve(process.cwd(), "../../.atlas/policies.yaml"),
  ];
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next repository layout.
    }
  }
  throw new Error("Unable to locate .atlas/policies.yaml");
}

export async function loadAlwaysHumanActions(path?: string): Promise<ReadonlySet<string>> {
  const resolvedPath = path ?? (await defaultPoliciesPath());
  const config = policiesSchema.parse(parse(await readFile(resolvedPath, "utf8")));
  return new Set(config.policies.always_human);
}

export function parseMonthlyBudgetUsd(value: string | undefined): number {
  const budget = Number(value ?? "25");
  if (!Number.isFinite(budget) || budget <= 0) {
    throw new Error("LLM_MONTHLY_BUDGET_USD must be a positive number");
  }
  return budget;
}
