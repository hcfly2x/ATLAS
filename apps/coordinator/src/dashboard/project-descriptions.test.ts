import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { loadDashboardProjectContexts, parseDashboardGoLiveAt } from "./project-descriptions.js";

describe("dashboard project context", () => {
  it("loads declared descriptions and inline plans without reading a project repository", async () => {
    const directory = await mkdtemp(join(tmpdir(), "atlas-dashboard-context-"));
    const path = join(directory, "projects.yaml");
    await writeFile(
      path,
      `projects:
  - id: atlas
    description: Descrição legada
    dashboard:
      description: Descrição da Dashboard
      plan: |
        - [x] Base concluída
        - [ ] Próxima etapa
`,
      "utf8",
    );

    const contexts = await loadDashboardProjectContexts(path);

    expect(contexts.descriptions.get("atlas")).toBe("Descrição da Dashboard");
    expect(contexts.plans.get("atlas")).toContain("Base concluída");
  });

  it("fails open when the declared context is absent or unreadable", async () => {
    const contexts = await loadDashboardProjectContexts("/path/that/does/not/exist");

    expect([...contexts.descriptions]).toEqual([]);
    expect([...contexts.plans]).toEqual([]);
  });
});

describe("DASHBOARD_GO_LIVE_AT", () => {
  it("keeps current behavior when absent and parses a valid ISO timestamp", () => {
    expect(parseDashboardGoLiveAt(undefined)).toBeUndefined();
    expect(parseDashboardGoLiveAt(" ")).toBeUndefined();
    expect(parseDashboardGoLiveAt("2026-08-05T12:00:00.000Z")?.toISOString()).toBe(
      "2026-08-05T12:00:00.000Z",
    );
  });

  it("fails startup configuration closed when invalid", () => {
    expect(() => parseDashboardGoLiveAt("not-a-timestamp")).toThrow(
      "DASHBOARD_GO_LIVE_AT must be a valid ISO-8601 timestamp",
    );
  });
});
