import type { AgentRuntime } from "@atlas/agent-runtime";
import {
  CLAUDE_REVIEWER_MODEL,
  ClaudeReviewerAgentRuntime,
  OPENAI_MODELS,
} from "@atlas/agent-runtime";
import { describe, expect, it } from "vitest";

import { selectPostExecutionReviewerRuntime } from "./reviewer-runtime.js";

const openaiRuntime: AgentRuntime = {
  run: () => Promise.reject(new Error("not called")),
};

describe("post-execution reviewer runtime selection", () => {
  it("keeps the current OpenAI runtime when Claude is not configured", () => {
    const selection = selectPostExecutionReviewerRuntime({ openaiRuntime });

    expect(selection).toEqual({
      model: OPENAI_MODELS.reviewer,
      provider: "openai",
      runtime: openaiRuntime,
    });
  });

  it("activates a distinct Claude runtime only for the selected reviewer provider", () => {
    const selection = selectPostExecutionReviewerRuntime({
      anthropicApiKey: "test-only",
      openaiRuntime,
      provider: "claude",
    });

    expect(selection.provider).toBe("claude");
    expect(selection.model).toBe(CLAUDE_REVIEWER_MODEL);
    expect(selection.runtime).toBeInstanceOf(ClaudeReviewerAgentRuntime);
    expect(selection.runtime).not.toBe(openaiRuntime);
  });

  it("fails closed for an invalid or incomplete explicit Claude selection", () => {
    expect(() =>
      selectPostExecutionReviewerRuntime({
        openaiRuntime,
        provider: "claude",
      }),
    ).toThrow("ANTHROPIC_API_KEY is required");
    expect(() =>
      selectPostExecutionReviewerRuntime({
        anthropicApiKey: "test-only",
        claudeTimeoutMs: "0",
        openaiRuntime,
        provider: "claude",
      }),
    ).toThrow("positive safe integer");
    expect(() =>
      selectPostExecutionReviewerRuntime({
        openaiRuntime,
        provider: "other",
      }),
    ).toThrow("must be openai or claude");
  });
});
