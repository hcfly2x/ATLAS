import { describe, expect, it } from "vitest";

import { postExecutionReviewSchema } from "@atlas/shared";

import { PostExecutionQaService, postExecutionReviewInstructions } from "./service.js";

const reviewer = { id: "qa", instructions: "Review delivered work." };

describe("PostExecutionQaService", () => {
  it("requires a reviewer distinct from the supervisor", () => {
    expect(
      () =>
        new PostExecutionQaService({
          claimDurationMs: 30_000,
          council: {
            agents: new Map([["qa", reviewer]]),
            routes: { critical: ["qa"], moderate: ["qa"], simple: ["qa"] },
            supervisorId: "qa",
          },
          monthlyBudgetUsd: 25,
          prisma: {} as never,
          runtime: {} as never,
        }),
    ).toThrow("must differ from the supervisor");
  });

  it("accepts only a bounded, structured post-execution decision", () => {
    expect(
      postExecutionReviewSchema.parse({
        confidence: 0.91,
        decision: "approved",
        findings: ["Tests and diff satisfy the specification."],
        required_actions: [],
        risks: [],
        summary: "Approved for finalization.",
      }),
    ).toMatchObject({ decision: "approved" });
    expect(() => postExecutionReviewSchema.parse({ decision: "approve" })).toThrow();
  });

  it("accepts an empty diff for answer_only without weakening repository_change review", () => {
    expect(postExecutionReviewInstructions(true)).toContain(
      "an empty diff is valid and must not be rejected",
    );
    expect(postExecutionReviewInstructions(true)).toContain("Validate the textual summary");
    expect(postExecutionReviewInstructions(false)).toContain(
      "preserve the existing diff and artifact review behavior",
    );
    expect(postExecutionReviewInstructions(false)).not.toContain("an empty diff is valid");
  });
});
