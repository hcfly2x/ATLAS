import { z } from "zod";

const telegramUserSchema = z.object({
  id: z.number().int().safe(),
});

const telegramChatSchema = z.object({
  id: z.number().int().safe(),
});

const telegramMessageSchema = z.object({
  chat: telegramChatSchema,
  from: telegramUserSchema,
  message_id: z.number().int().nonnegative(),
  text: z.string().min(1).optional(),
});

const telegramCallbackQuerySchema = z.object({
  id: z.string().min(1).max(255),
  data: z.string().min(1).max(64),
  from: telegramUserSchema,
  message: z
    .object({
      chat: telegramChatSchema,
      message_id: z.number().int().nonnegative(),
    })
    .optional(),
});

export const telegramUpdateSchema = z
  .object({
    callback_query: telegramCallbackQuerySchema.optional(),
    message: telegramMessageSchema.optional(),
    update_id: z.number().int().nonnegative().safe(),
  })
  .refine((value) => value.message !== undefined || value.callback_query !== undefined, {
    message: "message or callback_query is required",
  });

export type TelegramUpdate = z.infer<typeof telegramUpdateSchema>;

export interface TelegramButton {
  readonly callbackData: string;
  readonly text: string;
}

export interface TelegramResponse {
  readonly buttons?: readonly (readonly TelegramButton[])[];
  readonly text: string;
}

export interface TelegramDispatch {
  readonly callbackId?: string;
  readonly chatId: bigint;
  readonly replayed: boolean;
  readonly responses: readonly TelegramResponse[];
}
