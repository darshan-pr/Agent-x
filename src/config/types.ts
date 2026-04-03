export interface ExecutionPolicy {
  requireConfirmation: boolean;
  allowCommandPrefixes: string[];
  blockedPatterns: RegExp[];
}

export interface RateLimitConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export type LlmProvider = "groq" | "gemini";

export interface AgentConfig {
  apiKey: string;
  model: string;
  coreProvider: LlmProvider;
  subagentProvider: LlmProvider;
  groqApiKeys: string[];
  geminiApiKeys: string[];
  groqModel: string;
  geminiModel: string;
  temperature: number;
  maxSteps: number;
  maxMessages: number;
  workspaceRoot: string;
  executionPolicy: ExecutionPolicy;
  rateLimit: RateLimitConfig;
}
