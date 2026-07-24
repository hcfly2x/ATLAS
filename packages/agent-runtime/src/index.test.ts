import { describe, expect, it } from "vitest";

import { estimateModelCostUsd } from "./index.js";

describe("estimateModelCostUsd", () => {
  it("uses the configured Terra and Luna token prices", () => {
    expect(estimateModelCostUsd("gpt-5.6-terra", 1_000_000, 1_000_000)).toBe(17.5);
    expect(estimateModelCostUsd("gpt-5.6-luna", 1_000_000, 1_000_000)).toBe(7);
  });
});
