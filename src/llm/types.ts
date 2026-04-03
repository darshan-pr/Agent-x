export type LlmRole = "system" | "user" | "assistant" | "tool";

export interface LlmToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface LlmMessage {
  role: LlmRole;
  content: string;
  name?: string;
  toolCallId?: string;
  toolCalls?: LlmToolCall[];
}

export interface LlmToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface CompleteChatParams {
  messages: LlmMessage[];
  temperature?: number;
  tools?: LlmToolDefinition[];
}

export interface ChatModel {
  complete(params: CompleteChatParams): Promise<LlmMessage>;
}
