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

export function toGeminiRequest(params: CompleteChatParams): Record<string, unknown> {
  const toolNameByCallId = new Map<string, string>();
  const contents: Array<Record<string, unknown>> = [];
  const systemMessages: string[] = [];
  let lastRole: "user" | "model" | null = null;

  function pushUser(parts: Array<Record<string, unknown>>): void {
    contents.push({
      role: "user",
      parts
    });
    lastRole = "user";
  }

  function pushModel(parts: Array<Record<string, unknown>>): void {
    if (parts.length === 0) {
      return;
    }
    if (lastRole !== "user") {
      return;
    }
    contents.push({
      role: "model",
      parts
    });
    lastRole = "model";
  }

  function appendToolResponsePart(part: Record<string, unknown>): void {
    const lastEntry = contents[contents.length - 1] as
      | { role?: unknown; parts?: Array<Record<string, unknown>> }
      | undefined;
    if (
      lastRole === "user" &&
      lastEntry?.role === "user" &&
      Array.isArray(lastEntry.parts) &&
      lastEntry.parts.every(
        (existingPart) =>
          typeof existingPart === "object" &&
          existingPart !== null &&
          "functionResponse" in existingPart
      )
    ) {
      lastEntry.parts.push(part);
      return;
    }
    pushUser([part]);
  }

  for (let index = 0; index < params.messages.length; index += 1) {
    const message = params.messages[index];
    if (message.role === "system") {
      systemMessages.push(message.content);
      continue;
    }

    if (message.role === "user") {
      pushUser([{ text: message.content }]);
      continue;
    }

    if (message.role === "assistant") {
      const parts: Array<Record<string, unknown>> = [];
      if (message.content) {
        parts.push({ text: message.content });
      }
      if (message.toolCalls && message.toolCalls.length > 0) {
        let scanIndex = index + 1;
        const availableToolResponses = new Set<string>();
        while (scanIndex < params.messages.length) {
          const next = params.messages[scanIndex];
          if (next.role !== "tool") {
            break;
          }
          if (next.toolCallId) {
            availableToolResponses.add(next.toolCallId);
          }
          scanIndex += 1;
        }

        const canEmitFunctionCalls = lastRole === "user";
        for (const call of message.toolCalls) {
          if (!canEmitFunctionCalls || !availableToolResponses.has(call.id)) {
            continue;
          }
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
      pushModel(parts);
      continue;
    }

    if (message.role === "tool") {
      const toolName = message.toolCallId ? toolNameByCallId.get(message.toolCallId) : undefined;
      if (!toolName) {
        continue;
      }
      if (lastRole !== "model" && lastRole !== "user") {
        continue;
      }
      appendToolResponsePart({
        functionResponse: {
          name: toolName,
          response: stringifyToolResponse(message.content)
        }
      });
      continue;
    }
  }

  // Ensure the first conversational turn is user-facing for Gemini's sequencing rules.
  while (contents.length > 0) {
    const firstRole = contents[0]?.role;
    if (firstRole === "user") {
      break;
    }
    contents.shift();
  }

  if (contents.length > 0) {
    let cursor = 1;
    while (cursor < contents.length) {
      const prevRole = contents[cursor - 1]?.role;
      const currentRole = contents[cursor]?.role;
      if (prevRole === currentRole) {
        const currentParts =
          (contents[cursor]?.parts as Array<Record<string, unknown>> | undefined) ?? [];
        const previousParts =
          (contents[cursor - 1]?.parts as Array<Record<string, unknown>> | undefined) ?? [];
        if (currentRole === "user") {
          previousParts.push(...currentParts);
          contents.splice(cursor, 1);
          continue;
        }
        if (currentRole === "model") {
          previousParts.push(...currentParts);
          contents.splice(cursor, 1);
          continue;
        }
      }
      cursor += 1;
    }
  }

  // Drop trailing model function-call turns without a following user response.
  while (contents.length > 0) {
    const last = contents[contents.length - 1] as { role?: unknown; parts?: Array<Record<string, unknown>> };
    if (last.role !== "model") {
      break;
    }
    const hasFunctionCall = (last.parts ?? []).some(
      (part) => typeof part === "object" && part !== null && "functionCall" in part
    );
    if (!hasFunctionCall) {
      break;
    }
    contents.pop();
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
