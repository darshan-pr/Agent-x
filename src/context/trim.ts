import { LlmMessage } from "../llm/types.js";

export function trimMessages(messages: LlmMessage[], maxMessages: number): LlmMessage[] {
  if (messages.length <= maxMessages) {
    return messages;
  }

  if (maxMessages <= 1) {
    return messages.slice(-1);
  }

  const firstMessage = messages[0];
  const tail = messages.slice(-(maxMessages - 1));

  if (firstMessage?.role === "system") {
    return [firstMessage, ...tail.filter((item) => item !== firstMessage)];
  }

  return messages.slice(-maxMessages);
}
