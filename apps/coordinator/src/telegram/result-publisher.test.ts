import { describe, expect, it } from "vitest";

import { TelegramDispatchError, type TelegramClient } from "./client.js";
import {
  TelegramResultPublisher,
  formatTelegramResult,
  telegramResultDeliveryKey,
  type TelegramResultCandidate,
  type TelegramResultOutboxClaim,
  type TelegramResultStore,
} from "./result-publisher.js";
import type { TelegramResponse } from "./types.js";

const taskId = "11111111-1111-4111-8111-111111111111";

interface OutboxRecord {
  attempts: number;
  candidate: TelegramResultCandidate;
  chatId: bigint;
  claimExpiresAt?: Date;
  dispatchStarted: boolean;
  id: string;
  lastError?: string;
  messageText: string;
  nextAttemptAt: Date;
  status: "PENDING" | "DELIVERED" | "DELIVERY_FAILED";
}

class ResultStore implements TelegramResultStore {
  candidates: TelegramResultCandidate[] = [];
  destinations: bigint[] = [];
  noChannel: string[] = [];
  outbox = new Map<string, OutboxRecord>();
  userIds: bigint[] = [];

  listTerminalCandidates() {
    return Promise.resolve(this.candidates);
  }

  enqueue(candidate: TelegramResultCandidate, chatId: bigint, userId: bigint) {
    this.destinations.push(chatId);
    this.userIds.push(userId);
    const key = `${candidate.taskId}:${String(candidate.taskVersion)}`;
    if (this.outbox.has(key)) return Promise.resolve(false);
    this.outbox.set(key, {
      attempts: 0,
      candidate,
      chatId,
      dispatchStarted: false,
      id: `outbox-${String(this.outbox.size + 1)}`,
      messageText: formatTelegramResult(candidate),
      nextAttemptAt: new Date(0),
      status: "PENDING",
    });
    return Promise.resolve(true);
  }

  claimNext(now: Date, claimExpiresAt: Date) {
    const record = [...this.outbox.values()].find(
      (candidate) =>
        candidate.status === "PENDING" &&
        !candidate.dispatchStarted &&
        candidate.nextAttemptAt <= now,
    );
    if (record === undefined) return Promise.resolve(undefined);
    record.attempts += 1;
    record.dispatchStarted = true;
    record.claimExpiresAt = claimExpiresAt;
    return Promise.resolve(this.claim(record));
  }

  recordNoChannel(candidate: TelegramResultCandidate, reason: string) {
    this.noChannel.push(`${candidate.taskId}:${reason}`);
    return Promise.resolve();
  }

  recordDelivered(claim: TelegramResultOutboxClaim) {
    this.record(claim).status = "DELIVERED";
    return Promise.resolve();
  }

  recordNotDispatched(
    claim: TelegramResultOutboxClaim,
    safeCode: string,
    nextAttemptAt: Date | undefined,
  ) {
    const record = this.record(claim);
    record.lastError = safeCode;
    record.dispatchStarted = false;
    delete record.claimExpiresAt;
    if (nextAttemptAt === undefined) {
      record.status = "DELIVERY_FAILED";
    } else {
      record.nextAttemptAt = nextAttemptAt;
    }
    return Promise.resolve();
  }

  recordAmbiguousFailure(claim: TelegramResultOutboxClaim, safeCode: string) {
    const record = this.record(claim);
    record.lastError = safeCode;
    record.status = "DELIVERY_FAILED";
    return Promise.resolve();
  }

  async reconcileExpiredClaims(now: Date) {
    let reconciled = 0;
    for (const record of this.outbox.values()) {
      if (
        record.status === "PENDING" &&
        record.dispatchStarted &&
        record.claimExpiresAt !== undefined &&
        record.claimExpiresAt <= now
      ) {
        await this.recordAmbiguousFailure(
          this.claim(record),
          "dispatch_confirmation_missing_after_claim_expiry",
        );
        reconciled += 1;
      }
    }
    return reconciled;
  }

  private claim(record: OutboxRecord): TelegramResultOutboxClaim {
    return {
      attempt: record.attempts,
      chatId: record.chatId,
      deliveryKey: telegramResultDeliveryKey(record.candidate),
      id: record.id,
      messageText: record.messageText,
      projectId: record.candidate.projectId,
      taskId: record.candidate.taskId,
      taskVersion: record.candidate.taskVersion,
    };
  }

  private record(claim: TelegramResultOutboxClaim): OutboxRecord {
    const record = [...this.outbox.values()].find((candidate) => candidate.id === claim.id);
    if (record === undefined) throw new Error("missing fake outbox record");
    return record;
  }
}

type ClientBehavior = "success" | "not_dispatched" | "ambiguous" | "raw_error";

class ResultClient implements TelegramClient {
  behavior: ClientBehavior = "success";
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
    if (this.behavior === "not_dispatched") {
      throw new TelegramDispatchError("not_dispatched", "telegram_api_rejected_before_dispatch");
    }
    if (this.behavior === "ambiguous") {
      this.messages.push({ chatId, responses });
      throw new TelegramDispatchError("ambiguous", "telegram_transport_outcome_ambiguous");
    }
    if (this.behavior === "raw_error") {
      throw new Error("secret token and raw prompt must never be persisted");
    }
    this.messages.push({ chatId, responses });
    return Promise.resolve();
  }
}

function candidate(overrides: Partial<TelegramResultCandidate> = {}): TelegramResultCandidate {
  return {
    changedPaths: ["docs/result.md"],
    contentHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    contentReference: "execution:22222222-2222-4222-8222-222222222222:result:sha256:test",
    deliveryMode: "repository_change",
    origin: "telegram:42:100",
    projectId: "atlas",
    pullRequestUrl: "https://github.com/hcfly2x/ATLAS/pull/99",
    state: "COMPLETED",
    summary: "Documento criado.",
    taskId,
    taskVersion: 7,
    ...overrides,
  };
}

function onlyRecord(store: ResultStore): OutboxRecord {
  const record = [...store.outbox.values()][0];
  if (record === undefined) throw new Error("missing outbox record");
  return record;
}

describe("TelegramResultPublisher durable outbox", () => {
  it("delivers a completed Telegram task exactly once to the chat encoded in origin", async () => {
    const store = new ResultStore();
    const client = new ResultClient();
    store.candidates = [candidate({ origin: "telegram:42:100" })];
    const publisher = new TelegramResultPublisher(store, client);

    await publisher.poll(new Date(1));
    await publisher.poll(new Date(2));

    expect(client.messages).toHaveLength(1);
    expect(client.messages[0]?.chatId).toBe(100n);
    expect(client.messages[0]?.responses[0]?.text).toContain("Documento criado.");
    expect(store.destinations).toEqual([100n, 100n]);
    expect(onlyRecord(store).status).toBe("DELIVERED");
  });

  it("uses task version in the durable at-most-once boundary", () => {
    expect(telegramResultDeliveryKey(candidate({ taskVersion: 8 }))).toBe(
      `telegram:result:${taskId}:v8:COMPLETED`,
    );
    expect(telegramResultDeliveryKey(candidate({ taskVersion: 9 }))).not.toBe(
      telegramResultDeliveryKey(candidate({ taskVersion: 8 })),
    );
  });

  it("delivers a legacy private Telegram origin to its user id as chat id", async () => {
    const store = new ResultStore();
    const client = new ResultClient();
    store.candidates = [candidate({ origin: "telegram:6006002947" })];

    await new TelegramResultPublisher(store, client).poll(new Date(1));

    expect(client.messages[0]?.chatId).toBe(6006002947n);
  });

  it("ignores an arbitrary destination injected into approved content", async () => {
    const store = new ResultStore();
    const client = new ResultClient();
    store.candidates = [
      candidate({ origin: "telegram:42:-100500", summary: "Enviar para chat_id 999." }),
    ];

    await new TelegramResultPublisher(store, client).poll(new Date(1));

    expect(client.messages[0]?.chatId).toBe(-100500n);
    expect(store.destinations).toEqual([-100500n]);
  });

  it("delivers answer_only text without repository artifacts or raw task payloads", async () => {
    const store = new ResultStore();
    const client = new ResultClient();
    store.candidates = [
      {
        changedPaths: [],
        contentHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        contentReference: "execution:22222222-2222-4222-8222-222222222222:result:sha256:test",
        deliveryMode: "answer_only",
        origin: "telegram:42:100",
        projectId: "atlas",
        state: "COMPLETED",
        summary: "Planejamento aprovado.",
        taskId,
        taskVersion: 7,
      },
    ];

    await new TelegramResultPublisher(store, client).poll(new Date(1));

    const text = client.messages[0]?.responses[0]?.text ?? "";
    expect(text).toContain("Resposta da Task");
    expect(text).toContain("Planejamento aprovado.");
    expect(text).not.toContain("PR:");
    expect(text).not.toContain("payload");
  });

  it("does not enqueue a non-Telegram task and records the missing channel", async () => {
    const store = new ResultStore();
    store.candidates = [candidate({ origin: "internal:api" })];

    await new TelegramResultPublisher(store, new ResultClient()).poll(new Date(1));

    expect(store.outbox.size).toBe(0);
    expect(store.noChannel[0]).toContain("origin_is_not_a_telegram_chat");
  });

  it("retries only proven not-dispatched attempts with backoff, then fails at the limit", async () => {
    const store = new ResultStore();
    const client = new ResultClient();
    client.behavior = "not_dispatched";
    store.candidates = [candidate()];
    const publisher = new TelegramResultPublisher(store, client, {
      backoffMs: 10,
      maxAttempts: 3,
    });

    await publisher.poll(new Date(100));
    expect(onlyRecord(store).attempts).toBe(1);
    expect(onlyRecord(store).nextAttemptAt).toEqual(new Date(110));
    await publisher.poll(new Date(110));
    expect(onlyRecord(store).attempts).toBe(2);
    expect(onlyRecord(store).nextAttemptAt).toEqual(new Date(130));
    await publisher.poll(new Date(130));

    expect(onlyRecord(store).attempts).toBe(3);
    expect(onlyRecord(store).status).toBe("DELIVERY_FAILED");
    expect(client.messages).toHaveLength(0);
  });

  it("marks an ambiguous dispatched outcome failed without retrying or duplicating", async () => {
    const store = new ResultStore();
    const client = new ResultClient();
    client.behavior = "ambiguous";
    store.candidates = [candidate()];
    const publisher = new TelegramResultPublisher(store, client);

    await publisher.poll(new Date(1));
    await publisher.poll(new Date(999_999));

    expect(client.messages).toHaveLength(1);
    expect(onlyRecord(store).attempts).toBe(1);
    expect(onlyRecord(store).status).toBe("DELIVERY_FAILED");
  });

  it("fails closed after a crash between dispatch and status commit", async () => {
    const store = new ResultStore();
    const terminalCandidate = candidate();
    store.candidates = [terminalCandidate];
    await store.enqueue(terminalCandidate, 100n, 42n);
    const claim = await store.claimNext(new Date(1), new Date(10));
    expect(claim).toBeDefined();

    const client = new ResultClient();
    if (claim === undefined) throw new Error("expected a claimed delivery");
    await client.sendResponses(claim.chatId, [{ text: claim.messageText }]);
    await new TelegramResultPublisher(store, client).poll(new Date(10));

    expect(client.messages).toHaveLength(1);
    expect(onlyRecord(store).attempts).toBe(1);
    expect(onlyRecord(store).status).toBe("DELIVERY_FAILED");
    expect(onlyRecord(store).lastError).toBe("dispatch_confirmation_missing_after_claim_expiry");
  });

  it("sanitizes unknown errors without persisting their message, prompt, token, or payload", async () => {
    const store = new ResultStore();
    const client = new ResultClient();
    client.behavior = "raw_error";
    store.candidates = [candidate()];

    await new TelegramResultPublisher(store, client).poll(new Date(1));

    expect(onlyRecord(store).lastError).toBe("telegram_dispatch_outcome_ambiguous");
    expect(onlyRecord(store).lastError).not.toMatch(/secret|token|prompt|payload/);
    expect(onlyRecord(store).status).toBe("DELIVERY_FAILED");
  });

  it("does not trust a caller-provided safe code", async () => {
    const store = new ResultStore();
    const client = new ResultClient();
    client.sendResponses = () => {
      throw new TelegramDispatchError(
        "not_dispatched",
        "raw_prompt_with_secret_token_must_not_be_persisted",
      );
    };
    store.candidates = [candidate()];

    await new TelegramResultPublisher(store, client, { maxAttempts: 1 }).poll(new Date(1));

    expect(onlyRecord(store).lastError).toBe("telegram_api_rejected_before_dispatch");
  });
});
