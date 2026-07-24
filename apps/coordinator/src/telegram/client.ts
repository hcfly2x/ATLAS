import { z } from "zod";

import type { TelegramButton, TelegramDispatch, TelegramResponse } from "./types.js";

export interface TelegramClient {
  answerCallback(callbackId: string): Promise<void>;
  getUpdates(offset?: number): Promise<readonly unknown[]>;
  sendResponses(chatId: bigint, responses: readonly TelegramResponse[]): Promise<void>;
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
      throw new Error(`Telegram API ${method} transport failed`);
    }
    const payload = (await response.json()) as {
      description?: string;
      ok?: boolean;
      result?: unknown;
    };
    if (!response.ok || payload.ok !== true) {
      throw new Error(payload.description ?? `Telegram API ${method} failed`);
    }
    return payload.result;
  }
}

export async function dispatchTelegram(
  client: TelegramClient,
  dispatch: TelegramDispatch,
): Promise<void> {
  await client.sendResponses(dispatch.chatId, dispatch.responses);
  if (dispatch.callbackId !== undefined) {
    await client.answerCallback(dispatch.callbackId);
  }
}
