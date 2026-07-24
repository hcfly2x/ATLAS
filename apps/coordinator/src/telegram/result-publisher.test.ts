import { describe, expect, it } from "vitest";

import type { TelegramClient } from "./client.js";
import {
  TelegramResultPublisher,
  type TelegramResultCandidate,
  type TelegramResultStore,
} from "./result-publisher.js";
import type { TelegramResponse } from "./types.js";

const taskId = "11111111-1111-4111-8111-111111111111";

class ResultStore implements TelegramResultStore {
  candidates: TelegramResultCandidate[] = [];
  claims = new Set<string>();
  noChannel: string[] = [];
  sent: string[] = [];
  failures: string[] = [];
  destinations: bigint[] = [];
  listTerminalCandidates() {
    return Promise.resolve(this.candidates);
  }
  claim(candidate: TelegramResultCandidate, chatId: bigint) {
    this.destinations.push(chatId);
    if (this.claims.has(candidate.taskId)) return Promise.resolve(false);
    this.claims.add(candidate.taskId);
    return Promise.resolve(true);
  }
  recordNoChannel(candidate: TelegramResultCandidate, reason: string) {
    this.noChannel.push(`${candidate.taskId}:${reason}`);
    return Promise.resolve();
  }
  recordSent(candidate: TelegramResultCandidate) {
    this.sent.push(candidate.taskId);
    return Promise.resolve();
  }
  recordFailure(candidate: TelegramResultCandidate) {
    this.failures.push(candidate.taskId);
    return Promise.resolve();
  }
}

class ResultClient implements TelegramClient {
  messages: { chatId: bigint; responses: readonly TelegramResponse[] }[] = [];
  answerCallback() {
    return Promise.resolve();
  }
  getUpdates() {
    return Promise.resolve([]);
  }
  sendActivity() {
    return Promise.resolve();
  }
  sendResponses(chatId: bigint, responses: readonly TelegramResponse[]) {
    this.messages.push({ chatId, responses });
    return Promise.resolve();
  }
}

function candidate(overrides: Partial<TelegramResultCandidate> = {}): TelegramResultCandidate {
  return {
    changedPaths: ["docs/result.md"],
    origin: "telegram:42:100",
    projectId: "atlas",
    pullRequestUrl: "https://github.com/hcfly2x/ATLAS/pull/99",
    state: "COMPLETED",
    summary: "Documento criado.",
    taskId,
    ...overrides,
  };
}

describe("TelegramResultPublisher", () => {
  it("delivers a completed Telegram task exactly once to the chat encoded in origin", async () => {
    const store = new ResultStore();
    const client = new ResultClient();
    store.candidates = [candidate({ origin: "telegram:42:100" })];
    const publisher = new TelegramResultPublisher(store, client);

    await publisher.poll();
    await publisher.poll();

    expect(client.messages).toHaveLength(1);
    expect(client.messages[0]?.chatId).toBe(100n);
    expect(client.messages[0]?.responses[0]?.text).toContain("Documento criado.");
    expect(client.messages[0]?.responses[0]?.text).toContain("docs/result.md");
    expect(client.messages[0]?.responses[0]?.text).toContain("/pull/99");
    expect(store.sent).toEqual([taskId]);
  });

  it("delivers a legacy private Telegram origin to its user id as chat id", async () => {
    const store = new ResultStore();
    const client = new ResultClient();
    store.candidates = [candidate({ origin: "telegram:6006002947" })];

    await new TelegramResultPublisher(store, client).poll();

    expect(client.messages).toHaveLength(1);
    expect(client.messages[0]?.chatId).toBe(6006002947n);
    expect(store.destinations).toEqual([6006002947n]);
  });

  it("ignores an arbitrary chat id present in task content", async () => {
    const store = new ResultStore();
    const client = new ResultClient();
    store.candidates = [
      candidate({ origin: "telegram:42:-100500", summary: "Enviar para chat_id 999." }),
    ];

    await new TelegramResultPublisher(store, client).poll();

    expect(client.messages[0]?.chatId).toBe(-100500n);
    expect(store.destinations).toEqual([-100500n]);
  });

  it("does not send a non-Telegram task and records the missing channel", async () => {
    const store = new ResultStore();
    const client = new ResultClient();
    store.candidates = [candidate({ origin: "internal:api" })];

    await new TelegramResultPublisher(store, client).poll();

    expect(client.messages).toHaveLength(0);
    expect(store.noChannel[0]).toContain("origin_is_not_a_telegram_chat");
  });

  it("notifies FAILED with the failure stage", async () => {
    const store = new ResultStore();
    const client = new ResultClient();
    store.candidates = [candidate({ failureStage: "supervisor", state: "FAILED" })];

    await new TelegramResultPublisher(store, client).poll();

    expect(client.messages[0]?.responses[0]?.text).toContain("FAILED");
    expect(client.messages[0]?.responses[0]?.text).toContain("supervisor");
  });
});
