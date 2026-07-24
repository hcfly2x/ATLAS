import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { loadCouncilConfig } from "./council-config.js";

describe("council configuration", () => {
  it("loads the versioned role registry and canonical complexity routes", async () => {
    const config = await loadCouncilConfig(
      fileURLToPath(new URL("../../../../.atlas/agents.yaml", import.meta.url)),
      fileURLToPath(new URL("../../../../.atlas/routing.yaml", import.meta.url)),
    );

    expect(config.supervisorId).toBe("engineering_supervisor");
    expect(config.routes.simple).toEqual(["project_context", "engineering_supervisor"]);
    expect(config.routes.moderate).toEqual([
      "project_context",
      "architect",
      "qa",
      "engineering_supervisor",
    ]);
    expect(config.routes.critical).toEqual([
      "product",
      "project_context",
      "architect",
      "security",
      "qa",
      "engineering_supervisor",
    ]);
    expect(config.agents.get("security")?.instructions).toContain("Segurança");
  });
});
