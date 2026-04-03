import { ChatModel, CompleteChatParams, LlmMessage } from "../../src/llm/types.js";

export class QueueChatModel implements ChatModel {
  private readonly queue: LlmMessage[];

  constructor(queue: LlmMessage[]) {
    this.queue = [...queue];
  }

  async complete(_params: CompleteChatParams): Promise<LlmMessage> {
    const next = this.queue.shift();
    if (!next) {
      throw new Error("QueueChatModel received more calls than queued responses.");
    }
    return next;
  }
}
