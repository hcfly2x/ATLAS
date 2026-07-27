import { z } from "zod";

import type { TelegramButton, TelegramDispatch, TelegramResponse } from "./types.js";

export interface TelegramClient {
  answerCallback(callbackId: string): Promise<void>;
  getUpdates(offset?: number): Promise<readonly unknown[]>;
  sendResponses(chatId: bigint, responses: readonly TelegramResponse[]): Promise<void>;
  sendActivity(chatId: bigint): Promise<void>;
}

export type TelegramDispatchOutcome = "not_dispatched" | "ambiguous";

export class TelegramDispatchError extends Error {
  constructor(
    readonly outcome: TelegramDispatchOutcome,
    readonly safeCode: string,
  ) {
    super(safeCode);
    this.name = "TelegramDispatchError";
  }
}

function replyMarkup(
  buttons: readonly (readonly TelegramButton[])[] | undefined,
): { inline_keyboard: { callback_data: string; text: string }[][] } | undefined {
  return buttons === undefined
    ? undefined
    : {
        inline_keyboard: buttons.map((row) =>
          row.map((button) => ({
            callback_data: button.callbackData,
            text: button.text,
          })),
        ),
      };
}

export class TelegramBotApiClient implements TelegramClient {
  private readonly baseUrl: string;

  constructor(token: string, apiBase = "https://api.telegram.org") {
    if (token.length === 0) {
      throw new Error("Telegram bot token is required");
    }
    this.baseUrl = `${apiBase}/bot${token}`;
  }

  async answerCallback(callbackId: string): Promise<void> {
    await this.call("answerCallbackQuery", { callback_query_id: callbackId });
  }

  async getUpdates(offset?: number): Promise<readonly unknown[]> {
    const result = await this.call("getUpdates", {
      allowed_updates: ["message", "callback_query"],
      timeout: 25,
      ...(offset === undefined ? {} : { offset }),
    });
    return z.array(z.unknown()).parse(result);
  }

  async sendResponses(chatId: bigint, responses: readonly TelegramResponse[]): Promise<void> {
    for (const response of responses) {
      await this.call("sendMessage", {
        chat_id: chatId.toString(),
        text: response.text,
        ...(response.buttons === undefined ? {} : { reply_markup: replyMarkup(response.buttons) }),
      });
    }
  }

  async sendActivity(chatId: bigint): Promise<void> {
    await this.call("sendChatAction", { action: "typing", chat_id: chatId.toString() });
  }

  private async call(method: string, body: unknown): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/${method}`, {
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
    } catch {
      // Do not retain the request URL in the error: it contains the bot token.
      throw new TelegramDispatchError("ambiguous", "telegram_transport_outcome_ambiguous");
    }
    let payload: { description?: string; ok?: boolean; result?: unknown };
    try {
      payload = (await response.json()) as {
        description?: string;
        ok?: boolean;
        result?: unknown;
      };
    } catch {
      throw new TelegramDispatchError("ambiguous", "telegram_response_outcome_ambiguous");
    }
    if (!response.ok || payload.ok !== true) {
      throw new TelegramDispatchError("not_dispatched", "telegram_api_rejected_before_dispatch");
    }
    return payload.result;
  }
}

export async function dispatchTelegram(
  client: TelegramClient,
  dispatch: TelegramDispatch,
): Promise<void> {
  if (!dispatch.replayed) {
    await client.sendResponses(dispatch.chatId, dispatch.responses);
  }
  if (dispatch.callbackId !== undefined) {
    await client.answerCallback(dispatch.callbackId);
  }
}
