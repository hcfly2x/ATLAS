import { describe, expect, it } from "vitest";

import { getWorkerFoundationStatus } from "./index.js";

describe("worker foundation", () => {
  it("keeps Docker and database disabled with concurrency one", () => {
    expect(getWorkerFoundationStatus("test", "darwin", "arm64")).toMatchObject({
      architecture: "arm64",
      concurrency: 1,
      database: false,
      docker: false,
      platform: "darwin",
      log: {
        context: {
          correlationId: "test",
          service: "worker",
        },
      },
    });
  });
});
