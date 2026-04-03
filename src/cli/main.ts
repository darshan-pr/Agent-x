import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { loadConfig } from "../config/env.js";
import { AgentOrchestrator } from "../core/orchestrator.js";
import { createChatModelForProvider } from "../llm/modelFactory.js";
import { promptConfirmation } from "./confirm.js";
import { createActivityLogger } from "./activityLogger.js";
import { summarizeFileWithReaderSubagent } from "../subagents/analyzer.js";
import {
  generateExecutionPlanWithPlannerSubagent,
  planVerificationWithEditorSubagent
} from "../subagents/planner.js";

const AGENT_NAME = "AgentX";
const ANSI = {
  reset: "\u001b[0m",
  green: "\u001b[32m",
  dim: "\u001b[2m",
  orange: "\u001b[38;5;208m"
} as const;

function withColor(text: string, colorCode: string): string {
  if (!process.stdout.isTTY) {
    return text;
  }
  return `${colorCode}${text}${ANSI.reset}`;
}

const AGENT_LABEL = withColor(AGENT_NAME, ANSI.green);
const YOU_LABEL = withColor("you", ANSI.dim);

const WELCOME_BANNER = [
  "      _    ____ _____ _   _ _____  __  __ ",
  "     / \\  / ___| ____| \\ | |_   _| \\ \\/ / ",
  "    / _ \\| |  _|  _| |  \\| | | |    \\  /  ",
  "   / ___ \\ |_| | |___| |\\  | | |    /  \\  ",
  "  /_/   \\_\\____|_____|_| \\_| |_|   /_/\\_\\ "
].join("\n");

function printWelcomeBanner(): void {
  if (!process.stdout.isTTY) {
    return;
  }

  console.log(withColor("\n* Welcome to AgentX CLI", ANSI.orange));
  console.log(withColor(WELCOME_BANNER, ANSI.orange));
  console.log("");
}

function formatUserFacingError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const compact = raw.replace(/\s+/g, " ").trim();

  if (compact.includes("tool_use_failed") || compact.includes("Failed to call a function")) {
    return "Model produced an invalid tool call. I hid raw payload details. Please retry the request.";
  }

  const jsonStart = raw.indexOf("{");
  if (jsonStart !== -1) {
    const maybeJson = raw.slice(jsonStart);
    try {
      const parsed = JSON.parse(maybeJson) as {
        error?: { message?: string; code?: string };
      };
      const message = parsed.error?.message;
      const code = parsed.error?.code;
      if (message && code) {
        return `${message} (${code})`;
      }
      if (message) {
        return message;
      }
    } catch {
      // fall through
    }
  }

  return compact;
}

function printHelp(): void {
  console.log("\nCommands:");
  console.log("  /help   Show commands");
  console.log("  /clear  Reset chat context");
  console.log("  /exit   Quit the CLI\n");
}

function parseArgs(): { once: boolean; initialPrompt: string } {
  const args = process.argv.slice(2);
  const once = args.includes("--once");
  const filtered = args.filter((arg) => arg !== "--once");
  return {
    once,
    initialPrompt: filtered.join(" ").trim()
  };
}

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createActivityLogger({ agentName: AGENT_NAME, color: Boolean(process.stdout.isTTY) });
  const model = createChatModelForProvider(config.coreProvider, config);
  const subagentModel = createChatModelForProvider(config.subagentProvider, config);
  const { once, initialPrompt } = parseArgs();
  const rl = readline.createInterface({ input, output });

  try {
    const orchestrator = new AgentOrchestrator({
      model,
      config,
      logger,
      confirmCommand: (command) => promptConfirmation(command, rl),
      summarizeFile: (_mainModel, filePath, fileContent) =>
        summarizeFileWithReaderSubagent(subagentModel, filePath, fileContent),
      buildPlan: (_mainModel, userInput) =>
        generateExecutionPlanWithPlannerSubagent(subagentModel, userInput),
      planVerification: (_mainModel, goal, editMessage) =>
        planVerificationWithEditorSubagent(subagentModel, goal, editMessage)
    });

    if (once) {
      if (!initialPrompt) {
        throw new Error("When using --once, provide a prompt after the flag.");
      }
      const result = await orchestrator.runTask(initialPrompt);
      console.log(`\n=== ${AGENT_NAME} Response ===\n`);
      console.log(result.output);
      return;
    }

    let session = orchestrator.createSession("interactive");

    printWelcomeBanner();
    console.log(`\n${AGENT_LABEL} Interactive CLI`);
    console.log("Type /help for commands.\n");

    if (initialPrompt) {
      const firstTurn = await orchestrator.runTurn(session, initialPrompt);
      console.log(`${AGENT_LABEL}> ${firstTurn.output}\n`);
    }

    while (true) {
      let rawInput: string;
      try {
        rawInput = await rl.question(`${YOU_LABEL}> `);
      } catch {
        break;
      }
      const command = rawInput.trim();

      if (!command) {
        continue;
      }

      if (command === "/exit" || command === "/quit") {
        break;
      }

      if (command === "/help") {
        printHelp();
        continue;
      }

      if (command === "/clear") {
        session = orchestrator.createSession("interactive");
        console.log(`${AGENT_LABEL}> context cleared\n`);
        continue;
      }

      try {
        const turn = await orchestrator.runTurn(session, command);
        console.log(`${AGENT_LABEL}> ${turn.output}\n`);
      } catch (error) {
        const message = formatUserFacingError(error);
        console.error(`${AGENT_LABEL}> request failed: ${message}\n`);
      }
    }
  } finally {
    rl.close();
  }
}

main().catch((error: unknown) => {
  const message = formatUserFacingError(error);
  console.error(`${AGENT_LABEL} failed: ${message}`);
  process.exitCode = 1;
});
