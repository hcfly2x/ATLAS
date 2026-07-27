import { describe, expect, it } from "vitest";

import { assertFinalizationArtifacts } from "./service.js";

describe("worker finalization delivery contract", () => {
  it("allows answer_only only without Git artifacts", () => {
    expect(() => {
      assertFinalizationArtifacts({
        commitSha: null,
        deliveryMode: "answer_only",
        pullRequestUrl: null,
      });
    }).not.toThrow();
    expect(() => {
      assertFinalizationArtifacts({
        commitSha: "abcdef123456",
        deliveryMode: "answer_only",
        pullRequestUrl: "https://example.test/pull/1",
      });
    }).toThrow("answer_only finalization cannot publish Git artifacts");
  });

  it("preserves Git artifacts as mandatory for repository_change", () => {
    expect(() => {
      assertFinalizationArtifacts({
        commitSha: "abcdef123456",
        deliveryMode: "repository_change",
        pullRequestUrl: "https://example.test/pull/1",
      });
    }).not.toThrow();
    expect(() => {
      assertFinalizationArtifacts({
        commitSha: null,
        deliveryMode: "repository_change",
        pullRequestUrl: null,
      });
    }).toThrow("repository_change finalization requires Git artifacts");
  });
});
