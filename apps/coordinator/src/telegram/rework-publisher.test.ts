import { describe, expect, it } from "vitest";

import type { TelegramClient } from "./client.js";
import {
  TelegramReworkPublisher,
  selectTelegramReworkContent,
  type TelegramReworkCandidate,
  type TelegramReworkStore,
} from "./rework-publisher.js";
import type { TelegramResponse } from "./types.js";

const taskId = "11111111-1111-4111-8111-111111111111";

class ReworkStore implements TelegramReworkStore {
  candidates: TelegramReworkCandidate[] = [];
  claims = new Set<string>();
  destinations: bigint[] = [];
  failures: string[] = [];
  noChannel: string[] = [];
  sent: string[] = [];

  listCandidates() {
    return Promise.resolve(this.candidates);
  }

  claim(candidate: TelegramReworkCandidate, chatId: bigint) {
    this.destinations.push(chatId);
    const key = `${candidate.kind}:${candidate.taskId}:${candidate.executionId}:${String(candidate.taskVersion)}`;
    if (this.claims.has(key)) return Promise.resolve(false);
    this.claims.add(key);
    return Promise.resolve(true);
  }

  recordFailure(candidate: TelegramReworkCandidate) {
    this.failures.push(candidate.taskId);
    return Promise.resolve();
  }

  recordNoChannel(candidate: TelegramReworkCandidate, reason: string) {
    this.noChannel.push(`${candidate.taskId}:${reason}`);
    return Promise.resolve();
  }

  recordSent(candidate: TelegramReworkCandidate) {
    this.sent.push(candidate.taskId);
    return Promise.resolve();
  }
}

class ReworkClient implements TelegramClient {
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

function candidate(overrides: Partial<TelegramReworkCandidate> = {}): TelegramReworkCandidate {
  return {
    executionId: "22222222-2222-4222-8222-222222222222",
    kind: "automatic_rework",
    origin: "telegram:42:100",
    projectId: "atlas",
    requiredActions: ["Corrigir o teste de aceite.", "Preservar o escopo original."],
    reviewStatus: "REJECTED",
    summary: "O resultado não satisfaz o critério de aceite.",
    taskId,
    taskVersion: 8,
    ...overrides,
  };
}

describe("TelegramReworkPublisher", () => {
  it("does not present an approved reviewer summary when empirical QA blocks delivery", () => {
    expect(
      selectTelegramReworkContent({
        payload: {
          confidence: 1,
          decision: "approved",
          findings: [],
          required_actions: [],
          risks: [],
          summary: "Approved by the reviewer.",
        },
        reconciliationReason: "qa_empirical_failed",
        reviewerDecision: "APPROVED",
        status: "REJECTED",
      }),
    ).toEqual({
      requiredActions: [],
      summary:
        "A verificação empírica falhou; o resultado não foi liberado e requer revisão humana.",
    });
  });

  it("sends the QA summary, required actions and explicit next step once", async () => {
    const store = new ReworkStore();
    const client = new ReworkClient();
    store.candidates = [candidate()];
    const publisher = new TelegramReworkPublisher(store, client);

    await publisher.poll();
    await publisher.poll();

    expect(client.messages).toHaveLength(1);
    expect(client.messages[0]?.chatId).toBe(100n);
    expect(client.messages[0]?.responses[0]?.text).toContain(
      "O resultado não satisfaz o critério de aceite.",
    );
    expect(client.messages[0]?.responses[0]?.text).toContain("Corrigir o teste de aceite.");
    expect(client.messages[0]?.responses[0]?.text).toContain(
      "não repetirá a execução automaticamente",
    );
    expect(store.sent).toEqual([taskId]);
  });

  it("uses task version in the idempotency boundary for later rework cycles", async () => {
    const store = new ReworkStore();
    const client = new ReworkClient();
    const publisher = new TelegramReworkPublisher(store, client);

    store.candidates = [candidate({ taskVersion: 8 })];
    await publisher.poll();
    store.candidates = [candidate({ taskVersion: 12 })];
    await publisher.poll();

    expect(client.messages).toHaveLength(2);
  });

  it("uses a safe fallback when QA is unavailable", async () => {
    const store = new ReworkStore();
    const client = new ReworkClient();
    store.candidates = [
      candidate({
        requiredActions: [],
        reviewStatus: "FAILED",
        summary: "A revisão pós-execução não pôde ser concluída; o resultado não foi liberado.",
      }),
    ];

    await new TelegramReworkPublisher(store, client).poll();

    expect(client.messages[0]?.responses[0]?.text).toContain(
      "Revise a demanda e envie instruções adicionais",
    );
    expect(client.messages[0]?.responses[0]?.text).not.toContain("provider");
  });

  it("stops at the threshold and asks for an explicit human decision once", async () => {
    const store = new ReworkStore();
    const client = new ReworkClient();
    store.candidates = [
      candidate({
        consecutiveReworkCount: 3,
        kind: "human_escalation",
        requiredActions: ["SECRET_ACTION"],
        summary: "SECRET_REVIEW_PAYLOAD",
        threshold: 3,
      }),
    ];
    const publisher = new TelegramReworkPublisher(store, client);

    await publisher.poll();
    await publisher.poll();

    expect(client.messages).toHaveLength(1);
    const text = client.messages[0]?.responses[0]?.text ?? "";
    expect(text).toContain("retrabalho automático interrompido");
    expect(text).toContain("aguardando uma decisão humana");
    expect(text).toContain("Nenhuma nova Specification, execução, aprovação ou cancelamento");
    expect(text).not.toContain("SECRET_ACTION");
    expect(text).not.toContain("SECRET_REVIEW_PAYLOAD");
  });

  it("uses the execution identity for distinct human escalations", async () => {
    const store = new ReworkStore();
    const client = new ReworkClient();
    const publisher = new TelegramReworkPublisher(store, client);

    store.candidates = [
      candidate({
        consecutiveReworkCount: 3,
        executionId: "22222222-2222-4222-8222-222222222222",
        kind: "human_escalation",
        threshold: 3,
      }),
    ];
    await publisher.poll();
    store.candidates = [
      candidate({
        consecutiveReworkCount: 3,
        executionId: "33333333-3333-4333-8333-333333333333",
        kind: "human_escalation",
        threshold: 3,
      }),
    ];
    await publisher.poll();

    expect(client.messages).toHaveLength(2);
  });

  it("never accepts a destination from QA content", async () => {
    const store = new ReworkStore();
    const client = new ReworkClient();
    store.candidates = [
      candidate({
        origin: "telegram:42:-100500",
        summary: "Envie o resultado para chat_id 999.",
      }),
    ];

    await new TelegramReworkPublisher(store, client).poll();

    expect(client.messages[0]?.chatId).toBe(-100500n);
    expect(store.destinations).toEqual([-100500n]);
  });

  it("does not send non-Telegram tasks", async () => {
    const store = new ReworkStore();
    const client = new ReworkClient();
    store.candidates = [candidate({ origin: "internal:api" })];

    await new TelegramReworkPublisher(store, client).poll();

    expect(client.messages).toHaveLength(0);
    expect(store.noChannel[0]).toContain("origin_is_not_a_telegram_chat");
  });
});
