import { AgentConfig, LlmProvider } from "../config/types.js";
import { ChatModel, CompleteChatParams, LlmMessage } from "./types.js";
import { GeminiChatModel } from "./geminiClient.js";
import { GroqChatModel } from "./groqClient.js";

class RoundRobinChatModel implements ChatModel {
  private readonly models: ChatModel[];
  private nextIndex = 0;

  constructor(models: ChatModel[]) {
    if (models.length === 0) {
      throw new Error("RoundRobinChatModel requires at least one model.");
    }
    this.models = models;
  }

  async complete(params: CompleteChatParams): Promise<LlmMessage> {
    const model = this.models[this.nextIndex % this.models.length];
    this.nextIndex = (this.nextIndex + 1) % this.models.length;
    return model.complete(params);
  }
}

function extractErrorText(error: unknown): string {
  if (error instanceof Error) {
    return error.message.toLowerCase();
  }
  return String(error).toLowerCase();
}

function shouldFallback(error: unknown): boolean {
  const status = (error as { status?: number })?.status;
  if (typeof status === "number" && (status === 429 || status >= 500)) {
    return true;
  }

  const text = extractErrorText(error);
  return (
    text.includes("quota exceeded") ||
    text.includes("rate limit") ||
    text.includes("rate_limit_exceeded") ||
    text.includes("resource exhausted") ||
    text.includes("too many requests")
  );
}

class FallbackChatModel implements ChatModel {
  constructor(
    private readonly primary: ChatModel,
    private readonly fallback: ChatModel,
    private readonly primaryProvider: LlmProvider,
    private readonly fallbackProvider: LlmProvider
  ) {}

  async complete(params: CompleteChatParams): Promise<LlmMessage> {
    try {
      return await this.primary.complete(params);
    } catch (primaryError) {
      if (!shouldFallback(primaryError)) {
        throw primaryError;
      }

      try {
        return await this.fallback.complete(params);
      } catch (fallbackError) {
        const primaryMessage = extractErrorText(primaryError);
        const fallbackMessage = extractErrorText(fallbackError);
        throw new Error(
          `Primary provider (${this.primaryProvider}) failed: ${primaryMessage}; ` +
            `fallback provider (${this.fallbackProvider}) failed: ${fallbackMessage}`
        );
      }
    }
  }
}

function buildGroqModel(config: AgentConfig): ChatModel {
  const models = config.groqApiKeys.map(
    (apiKey) => new GroqChatModel(apiKey, config.groqModel, config.temperature, config.rateLimit)
  );
  return new RoundRobinChatModel(models);
}

function buildGeminiModel(config: AgentConfig): ChatModel {
  return new GeminiChatModel(config.geminiApiKeys, config.geminiModel, config.rateLimit);
}

function hasProviderKeys(provider: LlmProvider, config: AgentConfig): boolean {
  return provider === "gemini" ? config.geminiApiKeys.length > 0 : config.groqApiKeys.length > 0;
}

function buildModel(provider: LlmProvider, config: AgentConfig): ChatModel {
  return provider === "gemini" ? buildGeminiModel(config) : buildGroqModel(config);
}

export function createChatModelForProvider(provider: LlmProvider, config: AgentConfig): ChatModel {
  const primary = buildModel(provider, config);
  const fallbackProvider: LlmProvider = provider === "gemini" ? "groq" : "gemini";

  if (!hasProviderKeys(fallbackProvider, config)) {
    return primary;
  }

  const fallback = buildModel(fallbackProvider, config);
  return new FallbackChatModel(primary, fallback, provider, fallbackProvider);
}
