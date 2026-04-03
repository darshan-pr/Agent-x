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

export interface AgentConfig {
  apiKey: string;
  model: string;
  temperature: number;
  maxSteps: number;
  maxMessages: number;
  workspaceRoot: string;
  executionPolicy: ExecutionPolicy;
  rateLimit: RateLimitConfig;
}
