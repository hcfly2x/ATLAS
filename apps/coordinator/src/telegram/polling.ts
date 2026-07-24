import type { FastifyBaseLogger } from "fastify";

import type { TelegramClient } from "./client.js";
import { dispatchTelegram } from "./client.js";
import type { TelegramGateway } from "./service.js";
import { telegramUpdateSchema } from "./types.js";

export interface TelegramPollingHandle {
  stop(): void;
}

async function backoff(signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, 1_000);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
  });
}

export function startTelegramPolling(
  gateway: TelegramGateway,
  client: TelegramClient,
  logger: FastifyBaseLogger,
): TelegramPollingHandle {
  const controller = new AbortController();

  void (async () => {
    let offset: number | undefined;
    while (!controller.signal.aborted) {
      try {
        const updates = await client.getUpdates(offset);
        for (const rawUpdate of updates) {
          const update = telegramUpdateSchema.parse(rawUpdate);
          const dispatch = await gateway.handle(
            update,
            `telegram-poll:${String(update.update_id)}`,
          );
          await dispatchTelegram(client, dispatch);
          offset = update.update_id + 1;
        }
      } catch (error: unknown) {
        logger.error({ error }, "telegram polling iteration failed");
        await backoff(controller.signal);
      }
    }
  })();

  return {
    stop: () => {
      controller.abort();
    },
  };
}
