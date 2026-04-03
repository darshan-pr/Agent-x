import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { Interface } from "node:readline/promises";

type ConfirmationMode = "ask" | "always";

export interface ConfirmationState {
  mode: ConfirmationMode;
  allowedPrefixes: Set<string>;
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function inferPrefix(command: string): string {
  const tokens = command.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return "";
  }
  const first = normalize(tokens[0]);
  const second = normalize(tokens[1] ?? "");

  if (first === "npm" && ["run", "test", "install"].includes(second)) {
    return `npm ${second}`;
  }
  if (first === "python" || first === "python3" || first === "node" || first === "tsx") {
    return first;
  }
  return first;
}

function matchesPrefix(command: string, prefix: string): boolean {
  const normalizedCommand = normalize(command);
  const normalizedPrefix = normalize(prefix);
  return (
    normalizedCommand === normalizedPrefix ||
    normalizedCommand.startsWith(`${normalizedPrefix} `)
  );
}

function shouldAutoApprove(command: string, state?: ConfirmationState): boolean {
  if (!state) {
    return false;
  }
  if (state.mode === "always") {
    return true;
  }
  for (const prefix of state.allowedPrefixes) {
    if (matchesPrefix(command, prefix)) {
      return true;
    }
  }
  return false;
}

export function createConfirmationState(): ConfirmationState {
  return {
    mode: "ask",
    allowedPrefixes: new Set<string>()
  };
}

export async function promptConfirmation(
  command: string,
  rl?: Interface,
  state?: ConfirmationState
): Promise<boolean> {
  if (shouldAutoApprove(command, state)) {
    return true;
  }

  const ownedInterface = !rl;
  const activeRl = rl ?? readline.createInterface({ input, output });
  try {
    const prefix = inferPrefix(command);
    const answer = await activeRl.question(
      `Allow command execution? "${command}" [y]es/[n]o/[a]lways/[p]refix${prefix ? `=${prefix}` : ""}: `
    );
    const normalized = normalize(answer);
    if (normalized === "y" || normalized === "yes") {
      return true;
    }
    if ((normalized === "a" || normalized === "always") && state) {
      state.mode = "always";
      return true;
    }
    if ((normalized === "p" || normalized === "prefix") && state && prefix) {
      state.allowedPrefixes.add(prefix);
      return true;
    }
    return false;
  } finally {
    if (ownedInterface) {
      activeRl.close();
    }
  }
}
