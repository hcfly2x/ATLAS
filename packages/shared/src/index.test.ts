import { describe, expect, it } from "vitest";

import { canonicalPayloadHash, createStructuredLog } from "./index.js";

describe("createStructuredLog", () => {
  it("keeps the correlation id in every structured record", () => {
    const result = createStructuredLog(
      { correlationId: "task-123", service: "coordinator" },
      "info",
      "ready",
      new Date("2026-07-23T12:00:00.000Z"),
    );

    expect(result).toEqual({
      context: { correlationId: "task-123", service: "coordinator" },
      level: "info",
      message: "ready",
      timestamp: "2026-07-23T12:00:00.000Z",
    });
  });
});

describe("canonicalPayloadHash", () => {
  it("is deterministic for semantically identical objects and changes with content", () => {
    const first = canonicalPayloadHash({
      objective: "same",
      nested: { beta: 2, alpha: 1 },
      scope: ["one", "two"],
    });
    const reordered = canonicalPayloadHash({
      scope: ["one", "two"],
      nested: { alpha: 1, beta: 2 },
      objective: "same",
    });
    const changed = canonicalPayloadHash({
      scope: ["one", "changed"],
      nested: { alpha: 1, beta: 2 },
      objective: "same",
    });

    expect(first).toBe(reordered);
    expect(first).not.toBe(changed);
    expect(first).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("rejects values outside the JSON data model", () => {
    expect(() => canonicalPayloadHash({ invalid: undefined })).toThrow(TypeError);
    expect(() => canonicalPayloadHash({ invalid: Number.NaN })).toThrow(TypeError);
  });
});
