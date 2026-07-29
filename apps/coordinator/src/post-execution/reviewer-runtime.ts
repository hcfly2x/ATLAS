import {
  CLAUDE_REVIEWER_MODEL,
  ClaudeReviewerAgentRuntime,
  OPENAI_MODELS,
  type AgentRuntime,
} from "@atlas/agent-runtime";

export type PostExecutionReviewerProvider = "claude" | "openai";

export interface PostExecutionReviewerRuntime {
  readonly model: string;
  readonly provider: PostExecutionReviewerProvider;
  readonly runtime: AgentRuntime;
}

function parseProvider(value: string | undefined): PostExecutionReviewerProvider {
  if (value === undefined || value.trim().length === 0 || value === "openai") {
    return "openai";
  }
  if (value === "claude") {
    return "claude";
  }
  throw new Error("ATLAS_POST_EXECUTION_REVIEWER_PROVIDER must be openai or claude");
}

function parseTimeoutMs(value: string | undefined): number {
  const timeoutMs = Number(value ?? "60000");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error("ATLAS_CLAUDE_REVIEWER_TIMEOUT_MS must be a positive safe integer");
  }
  return timeoutMs;
}

export function selectPostExecutionReviewerRuntime(input: {
  readonly anthropicApiKey?: string;
  readonly claudeTimeoutMs?: string;
  readonly openaiRuntime: AgentRuntime;
  readonly provider?: string;
}): PostExecutionReviewerRuntime {
  const provider = parseProvider(input.provider);
  if (provider === "openai") {
    return {
      model: OPENAI_MODELS.reviewer,
      provider,
      runtime: input.openaiRuntime,
    };
  }
  if (input.anthropicApiKey === undefined || input.anthropicApiKey.trim().length === 0) {
    throw new Error(
      "ANTHROPIC_API_KEY is required when ATLAS_POST_EXECUTION_REVIEWER_PROVIDER=claude",
    );
  }
  return {
    model: CLAUDE_REVIEWER_MODEL,
    provider,
    runtime: new ClaudeReviewerAgentRuntime(input.anthropicApiKey, {
      timeoutMs: parseTimeoutMs(input.claudeTimeoutMs),
    }),
  };
}
