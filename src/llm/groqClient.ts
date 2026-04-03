import Groq from "groq-sdk";
import {
  ChatModel,
  CompleteChatParams,
  LlmMessage,
  LlmToolCall,
  LlmToolDefinition
} from "./types.js";
import {
  computeRetryDelayMs,
  isRetryableError,
  readRetryAfterMs,
  sleep
} from "./rateLimit.js";
import { RateLimitConfig } from "../config/types.js";

function toGroqToolDefinition(tool: LlmToolDefinition): {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
} {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }
  };
}

function toGroqMessage(message: LlmMessage): Record<string, unknown> {
  if (message.role === "tool") {
    return {
      role: "tool",
      content: message.content,
      tool_call_id: message.toolCallId
    };
  }

  if (message.role === "assistant" && message.toolCalls && message.toolCalls.length > 0) {
    return {
      role: "assistant",
      content: message.content,
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id,
        type: "function",
        function: {
          name: call.name,
          arguments: call.arguments
        }
      }))
    };
  }

  return {
    role: message.role,
    content: message.content,
    name: message.name
  };
}

function fromGroqToolCalls(raw: unknown): LlmToolCall[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const output: LlmToolCall[] = [];
  for (const item of raw) {
    const call = item as {
      id?: string;
      function?: { name?: string; arguments?: string };
    };

    const id = call.id;
    const name = call.function?.name;
    const args = call.function?.arguments;

    if (id && name) {
      output.push({
        id,
        name,
        arguments: args ?? "{}"
      });
    }
  }

  return output;
}

export class GroqChatModel implements ChatModel {
  private readonly client: Groq;
  private readonly model: string;
  private readonly defaultTemperature: number;
  private readonly rateLimit: RateLimitConfig;

  constructor(
    apiKey: string,
    model: string,
    defaultTemperature: number,
    rateLimit: RateLimitConfig
  ) {
    this.client = new Groq({ apiKey });
    this.model = model;
    this.defaultTemperature = defaultTemperature;
    this.rateLimit = rateLimit;
  }

  async complete(params: CompleteChatParams): Promise<LlmMessage> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        const response = await this.client.chat.completions.create({
          model: this.model,
          temperature: params.temperature ?? this.defaultTemperature,
          messages: params.messages.map((message) => toGroqMessage(message) as never),
          tools: params.tools ? params.tools.map(toGroqToolDefinition) : undefined,
          tool_choice: params.tools && params.tools.length > 0 ? "auto" : undefined
        });

        const message = response.choices[0]?.message;
        if (!message) {
          throw new Error("Groq returned an empty response.");
        }

        return {
          role: "assistant",
          content: message.content ?? "",
          toolCalls: fromGroqToolCalls(message.tool_calls)
        };
      } catch (error) {
        const canRetry =
          attempt < this.rateLimit.maxRetries &&
          isRetryableError(error);

        if (!canRetry) {
          throw error;
        }

        const retryAfterMs = readRetryAfterMs(error);
        const delayMs = computeRetryDelayMs(attempt, this.rateLimit, retryAfterMs);
        await sleep(delayMs);
      }
    }
  }
}
