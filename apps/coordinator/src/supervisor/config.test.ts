import { describe, expect, it } from "vitest";

import { loadAlwaysHumanActions, parseMonthlyBudgetUsd } from "./config.js";

describe("supervisor configuration", () => {
  it("loads the repository always-human policy", async () => {
    const actions = await loadAlwaysHumanActions();

    expect(actions.has("production_secret_change")).toBe(true);
    expect(actions.has("deploy_production")).toBe(true);
  });

  it("defaults the monthly deliberation budget to USD 25", () => {
    expect(parseMonthlyBudgetUsd(undefined)).toBe(25);
    expect(() => parseMonthlyBudgetUsd("0")).toThrow(/positive number/);
  });
});
