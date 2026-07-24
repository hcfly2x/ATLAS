import { describe, expect, it } from "vitest";

import { createStructuredLog } from "./index.js";

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
