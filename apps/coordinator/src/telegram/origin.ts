const telegramOriginWithChat = /^telegram:(\d+):(-?\d+)$/;
const legacyTelegramDirectOrigin = /^telegram:(\d+)$/;

export function telegramResultDestination(
  origin: string,
): { chatId: bigint; userId: bigint } | undefined {
  const current = telegramOriginWithChat.exec(origin);
  if (current?.[1] !== undefined && current[2] !== undefined) {
    return { userId: BigInt(current[1]), chatId: BigInt(current[2]) };
  }

  // Antes do PR #20, conversas privadas eram persistidas sem o chat_id. Para
  // esse formato legado, o Telegram usa o próprio user_id como chat_id.
  const legacy = legacyTelegramDirectOrigin.exec(origin);
  if (legacy?.[1] === undefined) return undefined;
  const userId = BigInt(legacy[1]);
  return { userId, chatId: userId };
}
