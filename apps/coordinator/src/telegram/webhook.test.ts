import { afterEach, describe, expect, it } from "vitest";

import type { TaskCoreStore } from "@atlas/core";

import { createCoordinatorApp } from "../app.js";
import type { TelegramClient } from "./client.js";
import { TelegramGateway } from "./service.js";
import type { TelegramStore } from "./store.js";
import type { TelegramResponse } from "./types.js";

const processed = new Map<bigint, readonly TelegramResponse[]>();
const telegramStore = {
  findProcessedUpdate: (updateId) => Promise.resolve(processed.get(updateId)),
  recordProcessedUpdate: (input) => {
    processed.set(input.updateId, input.responses);
    return Promise.resolve({ idempotentReplay: false, responses: input.responses });
  },
  listProjects: () => Promise.resolve([]),
  selectProject: () => Promise.reject(new Error("not used")),
  getSelectedProject: () => Promise.resolve(undefined),
  findTaskStatus: () => Promise.resolve(undefined),
  decideApproval: () => Promise.reject(new Error("not used")),
} satisfies TelegramStore;

const unusedTaskStore = {
  createTask: () => Promise.reject(new Error("not used")),
  findReplay: () => Promise.resolve(undefined),
  getTask: () => Promise.resolve(undefined),
  commitTransition: () => Promise.reject(new Error("not used")),
  recordRejectedTransition: () => Promise.resolve(),
} satisfies TaskCoreStore;

class RecordingTelegramClient implements TelegramClient {
  readonly answeredCallbacks: string[] = [];
  readonly sent: { chatId: bigint; responses: readonly TelegramResponse[] }[] = [];

  answerCallback(callbackId: string): Promise<void> {
    this.answeredCallbacks.push(callbackId);
    return Promise.resolve();
  }

  getUpdates(): Promise<readonly unknown[]> {
    return Promise.resolve([]);
  }

  sendResponses(chatId: bigint, responses: readonly TelegramResponse[]): Promise<void> {
    this.sent.push({ chatId, responses });
    return Promise.resolve();
  }
}

const apps: ReturnType<typeof createCoordinatorApp>[] = [];

afterEach(async () => {
  processed.clear();
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

describe("Telegram webhook", () => {
  it("refuses to enable the webhook without a non-empty secret", () => {
    const client = new RecordingTelegramClient();
    const gateway = new TelegramGateway({
      allowedUserId: 42n,
      store: telegramStore,
      taskStore: unusedTaskStore,
    });

    expect(() =>
      createCoordinatorApp({
        logger: false,
        telegramClient: client,
        telegramGateway: gateway,
      }),
    ).toThrowError("telegramWebhookSecret is required when the Telegram webhook is enabled");
    expect(() =>
      createCoordinatorApp({
        logger: false,
        telegramClient: client,
        telegramGateway: gateway,
        telegramWebhookSecret: " ",
      }),
    ).toThrowError("telegramWebhookSecret is required when the Telegram webhook is enabled");
  });

  it("validates the webhook secret and dispatches an injected update locally", async () => {
    const client = new RecordingTelegramClient();
    const gateway = new TelegramGateway({
      allowedUserId: 42n,
      store: telegramStore,
      taskStore: unusedTaskStore,
    });
    const app = createCoordinatorApp({
      logger: false,
      telegramClient: client,
      telegramGateway: gateway,
      telegramWebhookSecret: "test-webhook-secret",
    });
    apps.push(app);
    const payload = {
      message: {
        chat: { id: 100 },
        from: { id: 42 },
        message_id: 1,
        text: "/start",
      },
      update_id: 1000,
    };

    const unauthorized = await app.inject({
      method: "POST",
      url: "/telegram/webhook",
      payload,
    });
    const accepted = await app.inject({
      method: "POST",
      url: "/telegram/webhook",
      headers: { "x-telegram-bot-api-secret-token": "test-webhook-secret" },
      payload,
    });

    expect(unauthorized.statusCode).toBe(401);
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toMatchObject({ ok: true, replayed: false });
    expect(client.sent[0]?.responses[0]?.text).toContain("ATLAS pronto");
  });

  it("does not resend responses for a replayed callback but still acknowledges it", async () => {
    const client = new RecordingTelegramClient();
    const callbackStore = {
      ...telegramStore,
      selectProject: (_userId: bigint, _chatId: bigint, projectId: string) =>
        Promise.resolve({ id: projectId, name: "ATLAS" }),
    } satisfies TelegramStore;
    const gateway = new TelegramGateway({
      allowedUserId: 42n,
      store: callbackStore,
      taskStore: unusedTaskStore,
    });
    const app = createCoordinatorApp({
      logger: false,
      telegramClient: client,
      telegramGateway: gateway,
      telegramWebhookSecret: "test-webhook-secret",
    });
    apps.push(app);
    const payload = {
      callback_query: {
        data: "project:atlas",
        from: { id: 42 },
        id: "callback-replay",
        message: { chat: { id: 100 }, message_id: 2 },
      },
      update_id: 1001,
    };
    const request = {
      method: "POST" as const,
      url: "/telegram/webhook",
      headers: { "x-telegram-bot-api-secret-token": "test-webhook-secret" },
      payload,
    };

    const accepted = await app.inject(request);
    const replay = await app.inject(request);

    expect(accepted.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({ ok: true, replayed: true });
    expect(client.sent).toHaveLength(1);
    expect(client.answeredCallbacks).toEqual(["callback-replay", "callback-replay"]);
  });
});
