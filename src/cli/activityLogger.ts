import { AgentLogger } from "../core/logger.js";

const ANSI = {
  reset: "\u001b[0m",
  dim: "\u001b[2m",
  cyan: "\u001b[36m",
  green: "\u001b[32m",
  yellow: "\u001b[33m",
  red: "\u001b[31m"
} as const;

interface ActivityLoggerOptions {
  agentName: string;
  color?: boolean;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

function withColor(text: string, code: string, colorEnabled: boolean): string {
  if (!colorEnabled) {
    return text;
  }
  return `${code}${text}${ANSI.reset}`;
}

function clipText(value: string, max = 180): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= max) {
    return compact;
  }
  return `${compact.slice(0, max - 3)}...`;
}

export function createActivityLogger(options: ActivityLoggerOptions): AgentLogger {
  const { agentName, color = true } = options;
  const agentNameStyled = withColor(agentName, ANSI.green, color);

  function write(line = ""): void {
    process.stdout.write(`${line}\n`);
  }

  function renderToolResult(payload: Record<string, unknown>): string {
    const toolName = asString(payload.toolName) ?? "unknown";
    const success = asBoolean(payload.success) ?? false;
    const message = asString(payload.message);

    if (!success) {
      if (toolName === "runCommand") {
        const command = asString(payload.command) ?? "";
        const exitCode = asNumber(payload.exitCode);
        const blocked = asBoolean(payload.blocked) ?? false;
        const stderr = clipText(asString(payload.stderr) ?? "", 140);
        const reason = blocked ? "blocked" : `exit=${exitCode ?? "unknown"}`;
        const suffix = stderr ? ` | ${stderr}` : "";
        return withColor(`  x Command(${command}) ${reason}${suffix}`, ANSI.red, color);
      }
      const error = asString(payload.error);
      const detail = error ? `${message ?? "Failed."} (${error})` : (message ?? "Failed.");
      return withColor(`  x ${toolName}: ${detail}`, ANSI.red, color);
    }

    if (toolName === "searchFiles") {
      const query = asString(payload.query) ?? "";
      const matchCount = asNumber(payload.matchCount) ?? 0;
      return withColor(
        `  ✓ Search("${query}") -> ${matchCount} match(es)`,
        ANSI.green,
        color
      );
    }

    if (toolName === "readFile") {
      const path = asString(payload.path) ?? "";
      const startLine = asNumber(payload.startLine) ?? 1;
      const endLine = asNumber(payload.endLine) ?? startLine;
      const totalLines = asNumber(payload.totalLines) ?? endLine;
      return withColor(
        `  ✓ Read(${path}) lines ${startLine}-${endLine} of ${totalLines}`,
        ANSI.green,
        color
      );
    }

    if (toolName === "editFile") {
      const path = asString(payload.path) ?? "";
      const replacements = asNumber(payload.replacements) ?? 0;
      const addedLines = asNumber(payload.addedLines) ?? 0;
      const removedLines = asNumber(payload.removedLines) ?? 0;
      return withColor(
        `  ✓ Update(${path}) replacements=${replacements}, line changes +${addedLines} / -${removedLines}`,
        ANSI.green,
        color
      );
    }

    if (toolName === "runCommand") {
      const command = asString(payload.command) ?? "";
      const exitCode = asNumber(payload.exitCode);
      const blocked = asBoolean(payload.blocked) ?? false;
      const stderr = clipText(asString(payload.stderr) ?? "", 140);
      if (blocked) {
        return withColor(`  x Command blocked: ${command}`, ANSI.red, color);
      }
      const suffix = stderr ? ` | ${stderr}` : "";
      return withColor(
        `  ✓ Command(${command}) exit=${exitCode ?? "unknown"}${suffix}`,
        ANSI.green,
        color
      );
    }

    return withColor(`  ✓ ${toolName}: ${message ?? "Completed."}`, ANSI.green, color);
  }

  return {
    log(event: string, payload: Record<string, unknown> = {}): void {
      if (event === "orchestrator.turn.start") {
        const userInput = asString(payload.userInput) ?? "";
        write(`\n${agentNameStyled} ${withColor("planning", ANSI.cyan, color)}`);
        write(withColor(`  ${userInput}`, ANSI.dim, color));
        return;
      }

      if (event === "orchestrator.plan") {
        const steps = asStringList(payload.steps);
        if (steps.length === 0) {
          return;
        }
        write(withColor("Plan", ANSI.cyan, color));
        for (let index = 0; index < steps.length; index += 1) {
          write(withColor(`  ${index + 1}. ${steps[index]}`, ANSI.dim, color));
        }
        return;
      }

      if (event === "orchestrator.step.start") {
        const step = asNumber(payload.step) ?? 0;
        write(withColor(`\nStep ${step}`, ANSI.cyan, color));
        write(withColor("  Thinking and choosing next action...", ANSI.dim, color));
        return;
      }

      if (event === "orchestrator.assistant.note") {
        const text = asString(payload.text);
        if (text) {
          write(withColor(`  Model note: ${clipText(text)}`, ANSI.dim, color));
        }
        return;
      }

      if (event === "orchestrator.tool.call") {
        const toolName = asString(payload.toolName) ?? "unknown";
        const summary = asString(payload.summary) ?? "Preparing tool call.";
        write(withColor(`  > ${toolName}(${summary})`, ANSI.yellow, color));
        return;
      }

      if (event === "orchestrator.tool.result") {
        write(renderToolResult(payload));
        return;
      }

      if (event === "orchestrator.complete") {
        const step = asNumber(payload.step) ?? 0;
        write(`\n${agentNameStyled} ${withColor(`completed in ${step} step(s).`, ANSI.green, color)}`);
        return;
      }

      if (event === "orchestrator.model.error") {
        const message = asString(payload.message) ?? "Unknown model error.";
        write(withColor(`  x Model call issue: ${clipText(message)}`, ANSI.red, color));
        return;
      }

      if (event === "orchestrator.max_steps") {
        const maxSteps = asNumber(payload.maxSteps) ?? 0;
        write(withColor(`\nStopped after max steps (${maxSteps}).`, ANSI.red, color));
      }
    }
  };
}
