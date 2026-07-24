import { describe, expect, it } from "vitest";

import type { MemoryItem } from "@atlas/shared";

import { buildProjectMemoryContext, ProjectMemoryIsolationError } from "./index.js";

function item(overrides: Partial<MemoryItem> = {}): MemoryItem {
  return {
    content: "remember this",
    createdAt: "2026-07-24T00:00:00.000Z",
    id: "00000000-0000-4000-8000-000000000001",
    projectId: "atlas",
    type: "note",
    ...overrides,
  };
}

describe("buildProjectMemoryContext", () => {
  it("prioritizes task-specific context and decisions deterministically", () => {
    const context = buildProjectMemoryContext({
      items: [
        item({ id: "00000000-0000-4000-8000-000000000002", type: "note" }),
        item({
          id: "00000000-0000-4000-8000-000000000003",
          taskId: "00000000-0000-4000-8000-000000000099",
          type: "summary",
        }),
        item({ id: "00000000-0000-4000-8000-000000000004", type: "decision" }),
      ],
      projectId: "atlas",
      taskId: "00000000-0000-4000-8000-000000000099",
    });

    expect(context.entries.map(({ id }) => id)).toEqual([
      "00000000-0000-4000-8000-000000000003",
      "00000000-0000-4000-8000-000000000004",
      "00000000-0000-4000-8000-000000000002",
    ]);
  });

  it("fails closed when an item from another project reaches the builder", () => {
    expect(() =>
      buildProjectMemoryContext({
        items: [item({ projectId: "course-platform" })],
        projectId: "atlas",
      }),
    ).toThrow(ProjectMemoryIsolationError);
  });

  it("enforces the character budget", () => {
    const context = buildProjectMemoryContext({
      items: [item({ content: "x".repeat(100) })],
      maxChars: 24,
      projectId: "atlas",
    });
    expect(context.text.length).toBeLessThanOrEqual(24);
    expect(context.entries[0]?.content).toHaveLength(17);
    expect(context.entries[0]?.content.endsWith("…")).toBe(true);
    expect(context.truncated).toBe(true);
  });
});
