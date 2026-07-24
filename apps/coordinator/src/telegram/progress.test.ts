import { describe, expect, it } from "vitest";

import type { TelegramClient } from "./client.js";
import {
  TelegramProgressPublisher,
  type TelegramProgressCandidate,
  type TelegramProgressStore,
} from "./progress.js";
import type { TelegramResponse } from "./types.js";

class ProgressStore implements TelegramProgressStore {
  candidates: TelegramProgressCandidate[] = [];
  activities: string[] = [];
  logs: number[] = [];
  offsets: number[] = [];
  milestones: number[] = [];
  listCandidates() {
    return Promise.resolve(this.candidates);
  }
  markActivity(taskId: string) {
    this.activities.push(taskId);
    return Promise.resolve();
  }
  markLogs(_taskId: string, sequence: number, offset: number) {
    this.logs.push(sequence);
    this.offsets.push(offset);
    return Promise.resolve();
  }
  markMilestone(_taskId: string, version: number) {
    this.milestones.push(version);
    return Promise.resolve();
  }
}

class ProgressClient implements TelegramClient {
  responses: TelegramResponse[] = [];
  activity = 0;
  answerCallback() {
    return Promise.resolve();
  }
  getUpdates() {
    return Promise.resolve([]);
  }
  sendActivity() {
    this.activity += 1;
    return Promise.resolve();
  }
  sendResponses(_chatId: bigint, responses: readonly TelegramResponse[]) {
    this.responses.push(...responses);
    return Promise.resolve();
  }
}

function candidate(overrides: Partial<TelegramProgressCandidate>): TelegramProgressCandidate {
  return {
    chatId: 10n,
    lastActivityAt: null,
    lastLogSequence: -1,
    lastLogOffset: 0,
    lastTaskVersion: -1,
    logChunks: [],
    projectId: "atlas",
    state: "RUNNING",
    taskId: "11111111-1111-4111-8111-111111111111",
    taskVersion: 2,
    userId: 42n,
    verboseLevel: 0,
    ...overrides,
  };
}

describe("TelegramProgressPublisher", () => {
  it("level 0 sends activity during work", async () => {
    const store = new ProgressStore();
    const client = new ProgressClient();
    store.candidates = [candidate({ state: "RUNNING" })];
    const publisher = new TelegramProgressPublisher(store, client, () => new Date(10000));
    await publisher.poll();
    expect(client.activity).toBe(1);
    expect(client.responses).toHaveLength(0);
  });

  it("level 1 emits milestones and level 2 batches persisted chunks", async () => {
    const store = new ProgressStore();
    const client = new ProgressClient();
    store.candidates = [
      candidate({
        logChunks: [
          { content: "linha 1\n", sequence: 0 },
          { content: "linha 2\n", sequence: 1 },
        ],
        verboseLevel: 2,
      }),
    ];

    await new TelegramProgressPublisher(store, client).poll();

    expect(client.responses.map((response) => response.text).join("\n")).toContain(
      "Marco: RUNNING",
    );
    expect(client.responses.map((response) => response.text).join("\n")).toContain("linha 1");
    expect(store.milestones).toEqual([2]);
    expect(store.logs).toEqual([0]);
  });

  it("throttles a large persisted chunk without losing its remaining content", async () => {
    const store = new ProgressStore();
    const client = new ProgressClient();
    store.candidates = [
      candidate({
        logChunks: [{ content: "x".repeat(5000), sequence: 0 }],
        verboseLevel: 2,
      }),
    ];

    await new TelegramProgressPublisher(store, client).poll();

    expect(store.logs).toEqual([-1]);
    expect(store.offsets).toEqual([3500]);
    expect(client.responses.at(-1)?.text.endsWith("x".repeat(3500))).toBe(true);
  });
});
