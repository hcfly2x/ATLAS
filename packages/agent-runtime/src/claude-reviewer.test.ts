import { z } from "zod";
import { describe, expect, it, vi } from "vitest";

import type { AgentRequest } from "./index.js";
import {
  CLAUDE_REVIEWER_ENDPOINT,
  CLAUDE_REVIEWER_MODEL,
  ClaudeReviewerAgentRuntime,
  estimateClaudeReviewerCostUsd,
} from "./claude-reviewer.js";

const outputSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  summary: z.string().min(1),
});

function request(): AgentRequest<z.infer<typeof outputSchema>> {
  return {
    agentId: "qa",
    input: "synthetic-review-input",
    instructions: "Return a review.",
    model: CLAUDE_REVIEWER_MODEL,
    outputSchema,
    outputSchemaName: "post_execution_review",
    taskId: "10000000-0000-4000-8000-000000000001",
  };
}

function messageResponse(body: unknown, init: { status?: number } = {}): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      headers: { "content-type": "application/json" },
      status: init.status ?? 200,
    }),
  );
}

describe("ClaudeReviewerAgentRuntime", () => {
  it("uses only the fixed Anthropic Messages endpoint and validates structured output", async () => {
    const calls: { init?: RequestInit; url: string }[] = [];
    const fetchImplementation = ((url: string | URL | Request, init?: RequestInit) => {
      const normalizedUrl = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
      calls.push({ ...(init === undefined ? {} : { init }), url: normalizedUrl });
      return messageResponse({
        content: [
          {
            text: JSON.stringify({ decision: "approved", summary: "Synthetic approval." }),
            type: "text",
          },
        ],
        model: CLAUDE_REVIEWER_MODEL,
        stop_reason: "end_turn",
        usage: { input_tokens: 100, output_tokens: 20 },
      });
    }) as typeof fetch;
    const runtime = new ClaudeReviewerAgentRuntime("test-only", {
      fetchImplementation,
      timeoutMs: 1_000,
    });

    const response = await runtime.run(request());

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(CLAUDE_REVIEWER_ENDPOINT);
    expect(calls[0]?.init?.method).toBe("POST");
    const requestBody = calls[0]?.init?.body;
    expect(typeof requestBody).toBe("string");
    if (typeof requestBody !== "string") throw new Error("Expected a JSON request body");
    expect(JSON.parse(requestBody)).toMatchObject({
      messages: [{ content: "synthetic-review-input", role: "user" }],
      model: CLAUDE_REVIEWER_MODEL,
      output_config: {
        format: {
          schema: {
            additionalProperties: false,
            required: ["decision", "summary"],
            type: "object",
          },
          type: "json_schema",
        },
      },
      system: "Return a review.",
    });
    expect(response.output).toEqual({
      decision: "approved",
      summary: "Synthetic approval.",
    });
    expect(response.estimatedCostUsd).toBe(estimateClaudeReviewerCostUsd(100, 20));
  });

  it.each([
    {
      body: {
        content: [{ text: "not-json", type: "text" }],
        model: CLAUDE_REVIEWER_MODEL,
        stop_reason: "end_turn",
        usage: { input_tokens: 1, output_tokens: 1 },
      },
      expected: "CLAUDE_REVIEWER_INVALID_RESPONSE",
      status: 200,
    },
    {
      body: {
        content: [{ text: "credential-material", type: "text" }],
        model: CLAUDE_REVIEWER_MODEL,
        stop_reason: "refusal",
        usage: { input_tokens: 1, output_tokens: 1 },
      },
      expected: "CLAUDE_REVIEWER_INVALID_RESPONSE",
      status: 200,
    },
    {
      body: {
        error: { message: "credential-material synthetic-review-input" },
      },
      expected: "CLAUDE_REVIEWER_UNAVAILABLE",
      status: 503,
    },
  ])(
    "fails closed with a fixed safe code and never emits remote content",
    async ({ body, expected, status }) => {
      const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const runtime = new ClaudeReviewerAgentRuntime("test-only", {
        fetchImplementation: () => messageResponse(body, { status }),
      });

      await expect(runtime.run(request())).rejects.toThrow(expected);

      expect(stderr).not.toHaveBeenCalled();
      expect(consoleError).not.toHaveBeenCalled();
      stderr.mockRestore();
      consoleError.mockRestore();
    },
  );

  it("maps timeout and transport failure to safe unavailable outcomes", async () => {
    const timeoutRuntime = new ClaudeReviewerAgentRuntime("test-only", {
      fetchImplementation: (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new Error("request aborted"));
          });
        }),
      timeoutMs: 1,
    });
    const unavailableRuntime = new ClaudeReviewerAgentRuntime("test-only", {
      fetchImplementation: () =>
        Promise.reject(new Error("credential-material synthetic-review-input")),
    });

    await expect(timeoutRuntime.run(request())).rejects.toThrow("CLAUDE_REVIEWER_TIMEOUT");
    await expect(unavailableRuntime.run(request())).rejects.toThrow("CLAUDE_REVIEWER_UNAVAILABLE");
  });

  it("rejects use with any model outside the reviewer model boundary", async () => {
    const runtime = new ClaudeReviewerAgentRuntime("test-only", {
      fetchImplementation: vi.fn() as never,
    });

    await expect(
      runtime.run({
        ...request(),
        model: "another-model",
      }),
    ).rejects.toThrow("CLAUDE_REVIEWER_UNSUPPORTED_MODEL");
  });
});
