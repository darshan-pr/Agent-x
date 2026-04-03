import path from "node:path";
import dotenv from "dotenv";
import { z } from "zod";
import { defaultExecutionPolicy } from "./policy.js";
import { AgentConfig } from "./types.js";

dotenv.config();

const envSchema = z.object({
  GROQ_API_KEY: z.string().optional(),
  GROQ_API_KEYS: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_API_KEYS: z.string().optional(),
  CORE_PROVIDER: z.enum(["groq", "gemini"]).default("groq"),
  SUBAGENT_PROVIDER: z.enum(["groq", "gemini"]).default("groq"),
  GROQ_MODEL: z.string().min(1).default("llama-3.3-70b-versatile"),
  GEMINI_MODEL: z.string().min(1).default("gemini-2.0-flash"),
  GROQ_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.2),
  AGENT_MAX_STEPS: z.coerce.number().int().positive().default(8),
  RATE_LIMIT_MAX_RETRIES: z.coerce.number().int().min(0).default(4),
  RATE_LIMIT_BASE_DELAY_MS: z.coerce.number().int().min(100).default(1200),
  RATE_LIMIT_MAX_DELAY_MS: z.coerce.number().int().min(200).default(15000),
  WORKSPACE_ROOT: z.string().optional(),
  CONFIRM_COMMANDS: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true")
});

function inferWorkspaceRoot(): string {
  const cwd = process.cwd();
  if (path.basename(cwd) === "aiagent") {
    return path.resolve(cwd, "..");
  }
  return cwd;
}

function parseApiKeys(primary?: string, pool?: string): string[] {
  const values = [primary ?? "", pool ?? ""]
    .join(",")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return [...new Set(values)];
}

export function loadConfig(): AgentConfig {
  const parsed = envSchema.parse(process.env);
  const workspaceRoot = path.resolve(parsed.WORKSPACE_ROOT ?? inferWorkspaceRoot());
  const groqApiKeys = parseApiKeys(parsed.GROQ_API_KEY, parsed.GROQ_API_KEYS);
  const geminiApiKeys = parseApiKeys(parsed.GEMINI_API_KEY, parsed.GEMINI_API_KEYS);

  if (parsed.CORE_PROVIDER === "groq" && groqApiKeys.length === 0) {
    throw new Error("CORE_PROVIDER=groq requires GROQ_API_KEY or GROQ_API_KEYS.");
  }
  if (parsed.CORE_PROVIDER === "gemini" && geminiApiKeys.length === 0) {
    throw new Error("CORE_PROVIDER=gemini requires GEMINI_API_KEY or GEMINI_API_KEYS.");
  }
  if (parsed.SUBAGENT_PROVIDER === "groq" && groqApiKeys.length === 0) {
    throw new Error("SUBAGENT_PROVIDER=groq requires GROQ_API_KEY or GROQ_API_KEYS.");
  }
  if (parsed.SUBAGENT_PROVIDER === "gemini" && geminiApiKeys.length === 0) {
    throw new Error("SUBAGENT_PROVIDER=gemini requires GEMINI_API_KEY or GEMINI_API_KEYS.");
  }

  return {
    apiKey: parsed.CORE_PROVIDER === "groq" ? groqApiKeys[0] : geminiApiKeys[0],
    model: parsed.CORE_PROVIDER === "groq" ? parsed.GROQ_MODEL : parsed.GEMINI_MODEL,
    coreProvider: parsed.CORE_PROVIDER,
    subagentProvider: parsed.SUBAGENT_PROVIDER,
    groqApiKeys,
    geminiApiKeys,
    groqModel: parsed.GROQ_MODEL,
    geminiModel: parsed.GEMINI_MODEL,
    temperature: parsed.GROQ_TEMPERATURE,
    maxSteps: parsed.AGENT_MAX_STEPS,
    maxMessages: 20,
    workspaceRoot,
    executionPolicy: defaultExecutionPolicy(parsed.CONFIRM_COMMANDS),
    rateLimit: {
      maxRetries: parsed.RATE_LIMIT_MAX_RETRIES,
      baseDelayMs: parsed.RATE_LIMIT_BASE_DELAY_MS,
      maxDelayMs: parsed.RATE_LIMIT_MAX_DELAY_MS
    }
  };
}
