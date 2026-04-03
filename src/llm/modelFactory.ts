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

function buildGroqModel(config: AgentConfig): ChatModel {
  const models = config.groqApiKeys.map(
    (apiKey) => new GroqChatModel(apiKey, config.groqModel, config.temperature, config.rateLimit)
  );
  return new RoundRobinChatModel(models);
}

function buildGeminiModel(config: AgentConfig): ChatModel {
  return new GeminiChatModel(config.geminiApiKeys, config.geminiModel, config.rateLimit);
}

export function createChatModelForProvider(provider: LlmProvider, config: AgentConfig): ChatModel {
  if (provider === "gemini") {
    return buildGeminiModel(config);
  }
  return buildGroqModel(config);
}
