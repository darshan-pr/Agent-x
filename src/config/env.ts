import path from "node:path";
import dotenv from "dotenv";
import { z } from "zod";
import { defaultExecutionPolicy } from "./policy.js";
import { AgentConfig } from "./types.js";

dotenv.config();

const envSchema = z.object({
  GROQ_API_KEY: z.string().min(1, "GROQ_API_KEY is required"),
  GROQ_MODEL: z.string().min(1).default("llama-3.3-70b-versatile"),
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

export function loadConfig(): AgentConfig {
  const parsed = envSchema.parse(process.env);
  const workspaceRoot = path.resolve(parsed.WORKSPACE_ROOT ?? inferWorkspaceRoot());

  return {
    apiKey: parsed.GROQ_API_KEY,
    model: parsed.GROQ_MODEL,
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
