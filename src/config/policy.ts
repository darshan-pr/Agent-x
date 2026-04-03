import { ExecutionPolicy } from "./types.js";

export function defaultExecutionPolicy(requireConfirmation: boolean): ExecutionPolicy {
  return {
    requireConfirmation,
    allowCommandPrefixes: [
      "npm run",
      "npm test",
      "npm install",
      "node",
      "npx",
      "python",
      "python3",
      "pytest",
      "uvicorn",
      "ts-node",
      "tsx",
      "echo",
      "cat",
      "ls",
      "pwd",
      "git status"
    ],
    blockedPatterns: [
      /(^|\\s)rm\\s+-rf\\b/i,
      /(^|\\s)sudo\\b/i,
      /(^|\\s)shutdown\\b/i,
      /(^|\\s)reboot\\b/i,
      /(^|\\s)mkfs\\b/i,
      /:\\(\\)\\s*\\{\\s*:\\|:&\\s*\\};:/,
      /(^|\\s)git\\s+reset\\s+--hard\\b/i
    ]
  };
}

function startsWithPrefix(command: string, prefix: string): boolean {
  const normalizedCommand = command.trim().toLowerCase();
  const normalizedPrefix = prefix.trim().toLowerCase();
  return (
    normalizedCommand === normalizedPrefix ||
    normalizedCommand.startsWith(`${normalizedPrefix} `)
  );
}

export function evaluateCommandPolicy(
  command: string,
  policy: ExecutionPolicy
): { allowed: boolean; reason?: string } {
  const normalized = command.trim();
  if (normalized.length === 0) {
    return { allowed: false, reason: "Command is empty." };
  }

  for (const pattern of policy.blockedPatterns) {
    if (pattern.test(normalized)) {
      return { allowed: false, reason: "Command matches blocked safety pattern." };
    }
  }

  const allowlisted = policy.allowCommandPrefixes.some((prefix) =>
    startsWithPrefix(normalized, prefix)
  );

  if (!allowlisted) {
    return {
      allowed: false,
      reason: "Command is not in the allowlist."
    };
  }

  return { allowed: true };
}
