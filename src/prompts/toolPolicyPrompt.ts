import { ExecutionPolicy } from "../config/types.js";

export function buildToolPolicyPrompt(policy: ExecutionPolicy): string {
  return [
    "Tool execution policy:",
    `- Command confirmation required: ${policy.requireConfirmation}`,
    `- Allowlisted command prefixes: ${policy.allowCommandPrefixes.join(", ")}`,
    "- Dangerous commands are blocked even if requested.",
    "When command execution is blocked, adapt with a safer alternative."
  ].join("\n");
}
