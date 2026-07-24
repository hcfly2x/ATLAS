import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { ZodType } from "zod";

export const OPENAI_MODELS = {
  normalizer: "gpt-5.6-luna",
  router: "gpt-5.6-luna",
  reviewer: "gpt-5.6-luna",
  supervisor: "gpt-5.6-terra",
} as const;

const pricePerMillionTokens: Record<string, { input: number; output: number }> = {
  "gpt-5.6-luna": { input: 1, output: 6 },
  "gpt-5.6-terra": { input: 2.5, output: 15 },
};

export interface AgentRequest<Output> {
  readonly agentId: string;
  readonly input: string;
  readonly instructions: string;
  readonly model: string;
  readonly outputSchema: ZodType<Output>;
  readonly outputSchemaName: string;
  readonly taskId: string;
}

export interface AgentResponse<Output> {
  readonly estimatedCostUsd: number;
  readonly inputTokens: number;
  readonly latencyMs: number;
  readonly model: string;
  readonly output: Output;
  readonly outputTokens: number;
}

export interface AgentRuntime {
  run<Output>(request: AgentRequest<Output>): Promise<AgentResponse<Output>>;
}

export class UnsupportedModelPricingError extends Error {
  constructor(readonly model: string) {
    super(`No pricing configured for model: ${model}`);
    this.name = "UnsupportedModelPricingError";
  }
}

export function estimateModelCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const price = pricePerMillionTokens[model];
  if (price === undefined) {
    throw new UnsupportedModelPricingError(model);
  }
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}

export class OpenAIAgentRuntime implements AgentRuntime {
  private readonly client: OpenAI;

  constructor(apiKey: string) {
    if (apiKey.trim().length === 0) {
      throw new Error("OpenAI API key is required");
    }
    this.client = new OpenAI({ apiKey });
  }

  async run<Output>(request: AgentRequest<Output>): Promise<AgentResponse<Output>> {
    const startedAt = performance.now();
    const response = await this.client.responses.parse({
      input: request.input,
      instructions: request.instructions,
      model: request.model,
      store: false,
      text: {
        format: zodTextFormat(request.outputSchema, request.outputSchemaName),
      },
    });
    if (response.output_parsed === null) {
      throw new Error(`Agent ${request.agentId} returned no structured output`);
    }
    const inputTokens = response.usage?.input_tokens ?? 0;
    const outputTokens = response.usage?.output_tokens ?? 0;
    return {
      estimatedCostUsd: estimateModelCostUsd(request.model, inputTokens, outputTokens),
      inputTokens,
      latencyMs: Math.round(performance.now() - startedAt),
      model: request.model,
      output: request.outputSchema.parse(response.output_parsed),
      outputTokens,
    };
  }
}
