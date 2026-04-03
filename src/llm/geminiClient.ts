import {
  computeRetryDelayMs,
  isRetryableError,
  readRetryAfterMs,
  sleep
} from "./rateLimit.js";
import { RateLimitConfig } from "../config/types.js";
import { ChatModel, CompleteChatParams, LlmMessage, LlmToolCall } from "./types.js";

interface GeminiApiError extends Error {
  status?: number;
  headers?: Record<string, string | null | undefined>;
}

function toGeminiSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const output = JSON.parse(JSON.stringify(schema)) as Record<string, unknown>;

  function normalize(node: unknown): void {
    if (!node || typeof node !== "object") {
      return;
    }
    const record = node as Record<string, unknown>;
    const type = record.type;
    if (typeof type === "string") {
      record.type = type.toUpperCase();
    }

    const properties = record.properties;
    if (properties && typeof properties === "object" && !Array.isArray(properties)) {
      for (const value of Object.values(properties as Record<string, unknown>)) {
        normalize(value);
      }
    }

    const items = record.items;
    if (items && typeof items === "object") {
      normalize(items);
    }
  }

  normalize(output);
  return output;
}

function stringifyToolResponse(content: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // fall through
  }
  return { content };
}

function toGeminiRequest(params: CompleteChatParams): Record<string, unknown> {
  const toolNameByCallId = new Map<string, string>();
  const contents: Array<Record<string, unknown>> = [];
  const systemMessages: string[] = [];

  for (const message of params.messages) {
    if (message.role === "system") {
      systemMessages.push(message.content);
      continue;
    }

    if (message.role === "user") {
      contents.push({
        role: "user",
        parts: [{ text: message.content }]
      });
      continue;
    }

    if (message.role === "assistant") {
      const parts: Array<Record<string, unknown>> = [];
      if (message.content) {
        parts.push({ text: message.content });
      }
      if (message.toolCalls && message.toolCalls.length > 0) {
        for (const call of message.toolCalls) {
          toolNameByCallId.set(call.id, call.name);
          let args: Record<string, unknown> = {};
          try {
            const parsed = JSON.parse(call.arguments) as unknown;
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
              args = parsed as Record<string, unknown>;
            }
          } catch {
            // keep empty args
          }
          parts.push({
            functionCall: {
              name: call.name,
              args
            }
          });
        }
      }
      if (parts.length > 0) {
        contents.push({
          role: "model",
          parts
        });
      }
      continue;
    }

    if (message.role === "tool") {
      const toolName = message.toolCallId ? toolNameByCallId.get(message.toolCallId) : undefined;
      if (!toolName) {
        contents.push({
          role: "user",
          parts: [{ text: message.content }]
        });
        continue;
      }
      contents.push({
        role: "user",
        parts: [
          {
            functionResponse: {
              name: toolName,
              response: stringifyToolResponse(message.content)
            }
          }
        ]
      });
    }
  }

  const request: Record<string, unknown> = {
    contents,
    generationConfig: {
      temperature: params.temperature ?? 0.2
    }
  };

  if (systemMessages.length > 0) {
    request.systemInstruction = {
      parts: [{ text: systemMessages.join("\n\n") }]
    };
  }

  if (params.tools && params.tools.length > 0) {
    request.tools = [
      {
        functionDeclarations: params.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          parameters: toGeminiSchema(tool.parameters)
        }))
      }
    ];
    request.toolConfig = {
      functionCallingConfig: {
        mode: "AUTO"
      }
    };
  }

  return request;
}

function fromGeminiResponse(payload: Record<string, unknown>): LlmMessage {
  const candidates = payload.candidates as Array<Record<string, unknown>> | undefined;
  const first = candidates?.[0];
  if (!first) {
    throw new Error("Gemini returned an empty response.");
  }

  const content = (first.content ?? {}) as Record<string, unknown>;
  const parts = Array.isArray(content.parts) ? content.parts : [];

  const textChunks: string[] = [];
  const toolCalls: LlmToolCall[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index] as Record<string, unknown>;
    if (typeof part.text === "string") {
      textChunks.push(part.text);
      continue;
    }

    const functionCall = part.functionCall as
      | { name?: string; args?: Record<string, unknown> | undefined }
      | undefined;
    if (functionCall?.name) {
      toolCalls.push({
        id: `gemini-tool-${Date.now()}-${index}`,
        name: functionCall.name,
        arguments: JSON.stringify(functionCall.args ?? {})
      });
    }
  }

  return {
    role: "assistant",
    content: textChunks.join(""),
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined
  };
}

async function callGemini(
  apiKey: string,
  model: string,
  request: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(request)
  });

  if (!response.ok) {
    const text = await response.text();
    const error = new Error(text || `Gemini request failed with status ${response.status}`) as GeminiApiError;
    error.status = response.status;
    error.headers = {
      "retry-after": response.headers.get("retry-after")
    };
    throw error;
  }

  return (await response.json()) as Record<string, unknown>;
}

export class GeminiChatModel implements ChatModel {
  private readonly apiKeys: string[];
  private readonly model: string;
  private readonly rateLimit: RateLimitConfig;
  private nextKeyIndex = 0;

  constructor(apiKeys: string[], model: string, rateLimit: RateLimitConfig) {
    if (apiKeys.length === 0) {
      throw new Error("GeminiChatModel requires at least one API key.");
    }
    this.apiKeys = apiKeys;
    this.model = model;
    this.rateLimit = rateLimit;
  }

  private pickKey(): string {
    const key = this.apiKeys[this.nextKeyIndex % this.apiKeys.length];
    this.nextKeyIndex = (this.nextKeyIndex + 1) % this.apiKeys.length;
    return key;
  }

  async complete(params: CompleteChatParams): Promise<LlmMessage> {
    const request = toGeminiRequest(params);

    for (let attempt = 0; ; attempt += 1) {
      const apiKey = this.pickKey();
      try {
        const payload = await callGemini(apiKey, this.model, request);
        return fromGeminiResponse(payload);
      } catch (error) {
        const canRetry = attempt < this.rateLimit.maxRetries && isRetryableError(error);
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
