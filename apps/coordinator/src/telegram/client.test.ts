import { afterEach, describe, expect, it, vi } from "vitest";

import { TelegramBotApiClient, type TelegramDispatchError } from "./client.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TelegramBotApiClient dispatch outcomes", () => {
  it("classifies a rejected API response as proven not dispatched", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ description: "raw provider detail", ok: false }), {
          headers: { "content-type": "application/json" },
          status: 400,
        }),
      ),
    );

    const result = new TelegramBotApiClient("synthetic-token").sendResponses(42n, [
      { text: "approved result" },
    ]);

    await expect(result).rejects.toMatchObject({
      outcome: "not_dispatched",
      safeCode: "telegram_api_rejected_before_dispatch",
    } satisfies Partial<TelegramDispatchError>);
    await expect(result).rejects.not.toThrow("raw provider detail");
  });

  it("classifies a transport exception as ambiguous without exposing the request URL", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("raw network error")));

    const result = new TelegramBotApiClient("synthetic-token").sendResponses(42n, [
      { text: "approved result" },
    ]);

    await expect(result).rejects.toMatchObject({
      outcome: "ambiguous",
      safeCode: "telegram_transport_outcome_ambiguous",
    } satisfies Partial<TelegramDispatchError>);
    await expect(result).rejects.not.toThrow(/synthetic-token|raw network error/);
  });
});
