import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";

import type { AgentRequest, AgentResponse, AgentRuntime } from "./index.js";

export const CLAUDE_REVIEWER_ENDPOINT = "https://api.anthropic.com/v1/messages";
export const CLAUDE_REVIEWER_MODEL = "claude-sonnet-5";

const CLAUDE_REVIEWER_INPUT_USD_PER_MILLION = 3;
const CLAUDE_REVIEWER_OUTPUT_USD_PER_MILLION = 15;
const DEFAULT_TIMEOUT_MS = 60_000;

const claudeMessageSchema = z.object({
  content: z.array(
    z.object({
      text: z.string().optional(),
      type: z.string(),
    }),
  ),
  model: z.string().min(1),
  stop_reason: z.string().nullable(),
  usage: z.object({
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
  }),
});

export type ClaudeReviewerFailureCode =
  | "CLAUDE_REVIEWER_INVALID_RESPONSE"
  | "CLAUDE_REVIEWER_TIMEOUT"
  | "CLAUDE_REVIEWER_UNAVAILABLE"
  | "CLAUDE_REVIEWER_UNSUPPORTED_MODEL";

export class ClaudeReviewerRuntimeError extends Error {
  constructor(readonly code: ClaudeReviewerFailureCode) {
    super(code);
    this.name = "ClaudeReviewerRuntimeError";
  }
}

export function estimateClaudeReviewerCostUsd(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens * CLAUDE_REVIEWER_INPUT_USD_PER_MILLION +
      outputTokens * CLAUDE_REVIEWER_OUTPUT_USD_PER_MILLION) /
    1_000_000
  );
}

export class ClaudeReviewerAgentRuntime implements AgentRuntime {
  private readonly fetchImplementation: typeof fetch;
  private readonly timeoutMs: number;

  constructor(
    private readonly apiKey: string,
    options: {
      fetchImplementation?: typeof fetch;
      timeoutMs?: number;
    } = {},
  ) {
    if (apiKey.trim().length === 0) {
      throw new Error("Anthropic API key is required for the Claude reviewer");
    }
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
      throw new Error("Claude reviewer timeout must be a positive safe integer");
    }
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.timeoutMs = timeoutMs;
  }

  async run<Output>(request: AgentRequest<Output>): Promise<AgentResponse<Output>> {
    if (request.model !== CLAUDE_REVIEWER_MODEL) {
      throw new ClaudeReviewerRuntimeError("CLAUDE_REVIEWER_UNSUPPORTED_MODEL");
    }

    const startedAt = performance.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, this.timeoutMs);
    timeout.unref();

    let response: Response;
    try {
      const format = zodTextFormat(request.outputSchema, request.outputSchemaName);
      response = await this.fetchImplementation(CLAUDE_REVIEWER_ENDPOINT, {
        body: JSON.stringify({
          max_tokens: 2_048,
          messages: [{ content: request.input, role: "user" }],
          model: request.model,
          output_config: {
            format: {
              schema: format.schema,
              type: "json_schema",
            },
          },
          system: request.instructions,
        }),
        headers: {
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
          "x-api-key": this.apiKey,
        },
        method: "POST",
        signal: controller.signal,
      });
    } catch {
      throw new ClaudeReviewerRuntimeError(
        controller.signal.aborted ? "CLAUDE_REVIEWER_TIMEOUT" : "CLAUDE_REVIEWER_UNAVAILABLE",
      );
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new ClaudeReviewerRuntimeError("CLAUDE_REVIEWER_UNAVAILABLE");
    }

    let parsedMessage: z.infer<typeof claudeMessageSchema>;
    try {
      parsedMessage = claudeMessageSchema.parse(await response.json());
    } catch {
      throw new ClaudeReviewerRuntimeError("CLAUDE_REVIEWER_INVALID_RESPONSE");
    }
    if (parsedMessage.model !== request.model || parsedMessage.stop_reason !== "end_turn") {
      throw new ClaudeReviewerRuntimeError("CLAUDE_REVIEWER_INVALID_RESPONSE");
    }
    const textBlocks = parsedMessage.content.filter(
      (block): block is { text: string; type: string } =>
        block.type === "text" && block.text !== undefined,
    );
    if (textBlocks.length !== 1) {
      throw new ClaudeReviewerRuntimeError("CLAUDE_REVIEWER_INVALID_RESPONSE");
    }
    const outputText = textBlocks[0]?.text;
    if (outputText === undefined) {
      throw new ClaudeReviewerRuntimeError("CLAUDE_REVIEWER_INVALID_RESPONSE");
    }

    let output: Output;
    try {
      output = request.outputSchema.parse(JSON.parse(outputText));
    } catch {
      throw new ClaudeReviewerRuntimeError("CLAUDE_REVIEWER_INVALID_RESPONSE");
    }
    const inputTokens = parsedMessage.usage.input_tokens;
    const outputTokens = parsedMessage.usage.output_tokens;
    return {
      estimatedCostUsd: estimateClaudeReviewerCostUsd(inputTokens, outputTokens),
      inputTokens,
      latencyMs: Math.round(performance.now() - startedAt),
      model: parsedMessage.model,
      output,
      outputTokens,
    };
  }
}
