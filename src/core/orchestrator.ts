import {
  addPlannerNote,
  createSessionContext,
  recordMessage,
  recordToolResult,
  updateFileSummary
} from "../context/session.js";
import { trimMessages } from "../context/trim.js";
import { SessionContext } from "../context/types.js";
import { AgentConfig } from "../config/types.js";
import { AgentLogger } from "./logger.js";
import { ChatModel, LlmMessage } from "../llm/types.js";
import { SYSTEM_PROMPT } from "../prompts/systemPrompt.js";
import { buildToolPolicyPrompt } from "../prompts/toolPolicyPrompt.js";
import {
  executeTool,
  isToolName,
  parseToolArguments,
  serializeToolResult,
  TOOL_DEFINITIONS
} from "../tools/index.js";
import { ToolResult, ToolRuntimeContext } from "../tools/types.js";
import { summarizeFileWithReaderSubagent } from "../subagents/analyzer.js";
import {
  generateExecutionPlanWithPlannerSubagent,
  planVerificationWithEditorSubagent
} from "../subagents/planner.js";
import path from "node:path";

export interface AgentRunResult {
  output: string;
  steps: number;
  session: SessionContext;
}

export interface OrchestratorDependencies {
  model: ChatModel;
  config: AgentConfig;
  logger: AgentLogger;
  confirmCommand: (command: string) => Promise<boolean>;
  summarizeFile?: (model: ChatModel, filePath: string, fileContent: string) => Promise<string>;
  buildPlan?: (model: ChatModel, userInput: string) => Promise<string[]>;
  planVerification?: (model: ChatModel, goal: string, editMessage: string) => Promise<string>;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function clipText(value: string, max = 180): string {
  const normalized = normalizeWhitespace(value);
  if (normalized.length <= max) {
    return normalized;
  }
  return `${normalized.slice(0, max - 3)}...`;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function toAbsoluteDisplayPath(workspaceRoot: string, value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(workspaceRoot, value);
}

function extractErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const trimmed = raw.trim();
  const jsonStart = trimmed.indexOf("{");
  if (jsonStart !== -1) {
    const maybeJson = trimmed.slice(jsonStart);
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
      // Fall back to compact text.
    }
  }
  return trimmed.replace(/\s+/g, " ");
}

function isToolUseFailure(error: unknown): boolean {
  const compact = extractErrorMessage(error).toLowerCase();
  return (
    compact.includes("tool_use_failed") ||
    compact.includes("failed to call a function")
  );
}

function isSmallTalkInput(input: string): boolean {
  const normalized = input
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return false;
  }

  const directMatches = new Set([
    "hi",
    "hii",
    "hiii",
    "hello",
    "hey",
    "hey there",
    "good morning",
    "good afternoon",
    "good evening",
    "thanks",
    "thank you",
    "thx"
  ]);
  if (directMatches.has(normalized)) {
    return true;
  }

  if (/^(hi+|hello+|hey+)(\s+(there|agentx|agent x))?$/.test(normalized)) {
    return true;
  }

  return false;
}

function buildSmallTalkReply(input: string): string {
  const normalized = input
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (/^(thanks|thank you|thx)$/.test(normalized)) {
    return "You are welcome. Tell me what you want to build or fix, and I will handle it.";
  }

  return "Hi! I can help with coding, editing files, and running commands. Tell me what you want done.";
}

function inferExecutionPlan(userInput: string): string[] {
  const lower = userInput.toLowerCase();
  const steps: string[] = ["Understand the request and identify relevant files."];

  if (/(find|search|locate|where|which|list)/.test(lower)) {
    steps.push("Search the workspace for matching files and symbols.");
  }

  steps.push("Read the most relevant files to gather context.");

  if (/(edit|update|modify|change|create|fix|write|add|remove|refactor|replace)/.test(lower)) {
    steps.push("Apply focused edits to requested files.");
  }

  if (/(test|verify|run|build|lint|check)/.test(lower)) {
    steps.push("Run verification commands where helpful.");
  }

  steps.push("Return a concise summary of work performed.");

  return [...new Set(steps)];
}

async function buildExecutionPlan(
  model: ChatModel,
  userInput: string,
  buildPlanFn: (model: ChatModel, userInput: string) => Promise<string[]>
): Promise<string[]> {
  try {
    const planned = await buildPlanFn(model, userInput);
    if (planned.length > 0) {
      return planned;
    }
  } catch {
    // Fall back to heuristic plan if planner call fails.
  }

  return inferExecutionPlan(userInput);
}

function summarizeToolArguments(
  name: string,
  args: Record<string, unknown>,
  workspaceRoot: string
): string {
  if (name === "searchFiles") {
    const query = readString(args.query) ?? "";
    const baseDir = readString(args.baseDir) ?? ".";
    const limit = readNumber(args.limit) ?? 5;
    const absoluteBaseDir = toAbsoluteDisplayPath(workspaceRoot, baseDir);
    return `query="${clipText(query, 60)}", baseDir="${absoluteBaseDir}", limit=${limit}`;
  }

  if (name === "readFile") {
    const inputPath = readString(args.path) ?? "<missing>";
    const absolutePath =
      inputPath === "<missing>" ? inputPath : toAbsoluteDisplayPath(workspaceRoot, inputPath);
    const startLine = readNumber(args.startLine);
    const endLine = readNumber(args.endLine);
    const range =
      startLine !== undefined || endLine !== undefined
        ? `, lines=${startLine ?? 1}-${endLine ?? "end"}`
        : "";
    return `path="${absolutePath}"${range}`;
  }

  if (name === "editFile") {
    const inputPath = readString(args.path) ?? "<missing>";
    const absolutePath =
      inputPath === "<missing>" ? inputPath : toAbsoluteDisplayPath(workspaceRoot, inputPath);
    const patchSpec = args.patchSpec as Record<string, unknown> | undefined;
    const search = readString(patchSpec?.search) ?? "";
    const replace = readString(patchSpec?.replace) ?? "";
    const all = patchSpec?.all === true;
    return `path="${absolutePath}", all=${all}, searchChars=${search.length}, replaceChars=${replace.length}`;
  }

  if (name === "runCommand") {
    const command = readString(args.command) ?? "<missing>";
    const cwd = toAbsoluteDisplayPath(workspaceRoot, readString(args.cwd) ?? ".");
    return `command="${clipText(command, 80)}", cwd="${cwd}"`;
  }

  return "No argument summary available.";
}

function buildToolResultLogPayload(
  step: number,
  result: ToolResult,
  workspaceRoot: string
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    step,
    toolName: result.name,
    success: result.success,
    message: result.message
  };

  if (result.name === "searchFiles" && result.success) {
    return {
      ...base,
      query: result.query,
      baseDir: result.baseDir,
      matchCount: result.matches.length,
      firstMatch: result.matches[0]?.path
    };
  }

  if (result.name === "readFile" && result.success) {
    return {
      ...base,
      path: toAbsoluteDisplayPath(workspaceRoot, result.path),
      startLine: result.startLine,
      endLine: result.endLine,
      totalLines: result.totalLines,
      linesRead: Math.max(0, result.endLine - result.startLine + 1)
    };
  }

  if (result.name === "editFile" && result.success) {
    return {
      ...base,
      path: toAbsoluteDisplayPath(workspaceRoot, result.path),
      replacements: result.replacements,
      addedLines: result.addedLines ?? 0,
      removedLines: result.removedLines ?? 0,
      backupPath: result.backupPath
        ? toAbsoluteDisplayPath(workspaceRoot, result.backupPath)
        : undefined
    };
  }

  if (result.name === "runCommand" && "command" in result) {
    return {
      ...base,
      command: result.command,
      cwd: toAbsoluteDisplayPath(workspaceRoot, result.cwd),
      exitCode: result.exitCode,
      blocked: result.blocked,
      stdout: result.stdout,
      stderr: result.stderr,
      stdoutLines: result.stdout ? result.stdout.split(/\r?\n/).length : 0,
      stderrLines: result.stderr ? result.stderr.split(/\r?\n/).length : 0
    };
  }

  const errorResult = result as { error?: string };
  return {
    ...base,
    error: errorResult.error ?? "Unknown error"
  };
}

export class AgentOrchestrator {
  private readonly model: ChatModel;
  private readonly config: AgentConfig;
  private readonly logger: AgentLogger;
  private readonly confirmCommand: (command: string) => Promise<boolean>;
  private readonly summarizeFile: (
    model: ChatModel,
    filePath: string,
    fileContent: string
  ) => Promise<string>;
  private readonly buildPlan: (model: ChatModel, userInput: string) => Promise<string[]>;
  private readonly planVerification: (
    model: ChatModel,
    goal: string,
    editMessage: string
  ) => Promise<string>;

  constructor(deps: OrchestratorDependencies) {
    this.model = deps.model;
    this.config = deps.config;
    this.logger = deps.logger;
    this.confirmCommand = deps.confirmCommand;
    this.summarizeFile = deps.summarizeFile ?? summarizeFileWithReaderSubagent;
    this.buildPlan = deps.buildPlan ?? generateExecutionPlanWithPlannerSubagent;
    this.planVerification = deps.planVerification ?? planVerificationWithEditorSubagent;
  }

  createSession(userGoal = "interactive"): SessionContext {
    const initialMessages: LlmMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "system", content: buildToolPolicyPrompt(this.config.executionPolicy) }
    ];
    return createSessionContext(userGoal, initialMessages);
  }

  async runTask(userTask: string): Promise<AgentRunResult> {
    const session = this.createSession(userTask);
    return this.runTurn(session, userTask);
  }

  async runTurn(session: SessionContext, userInput: string): Promise<AgentRunResult> {
    session.userGoal = userInput;
    recordMessage(session, { role: "user", content: userInput });
    this.logger.log("orchestrator.turn.start", {
      userInput: clipText(userInput, 220)
    });

    if (isSmallTalkInput(userInput)) {
      const reply = buildSmallTalkReply(userInput);
      const assistantMessage: LlmMessage = {
        role: "assistant",
        content: reply
      };
      recordMessage(session, assistantMessage);
      this.logger.log("orchestrator.plan", {
        steps: ["Respond conversationally without tools."]
      });
      this.logger.log("orchestrator.step.start", {
        step: 1,
        totalMessages: session.recentMessages.length
      });
      this.logger.log("orchestrator.assistant.note", {
        step: 1,
        text: clipText(reply, 300)
      });
      this.logger.log("orchestrator.step.decision", {
        step: 1,
        decision: "final_response"
      });
      this.logger.log("orchestrator.complete", {
        step: 1
      });
      return {
        output: reply,
        steps: 1,
        session
      };
    }

    const planSteps = await buildExecutionPlan(this.model, userInput, this.buildPlan);
    this.logger.log("orchestrator.plan", {
      steps: planSteps
    });

    const toolContext: ToolRuntimeContext = {
      workspaceRoot: this.config.workspaceRoot,
      executionPolicy: this.config.executionPolicy,
      confirmCommand: this.confirmCommand,
      logger: this.logger
    };

    for (let step = 1; step <= this.config.maxSteps; step += 1) {
      session.recentMessages = trimMessages(session.recentMessages, this.config.maxMessages);

      this.logger.log("orchestrator.step.start", {
        step,
        totalMessages: session.recentMessages.length
      });

      let assistant: LlmMessage;
      try {
        assistant = await this.model.complete({
          messages: session.recentMessages,
          tools: TOOL_DEFINITIONS,
          temperature: Math.min(this.config.temperature, 0.1)
        });
      } catch (error) {
        const shortError = extractErrorMessage(error);
        this.logger.log("orchestrator.model.error", {
          step,
          message: shortError
        });

        if (isToolUseFailure(error)) {
          recordMessage(session, {
            role: "system",
            content:
              "Your previous output had malformed tool-call arguments. " +
              "Retry the same intent with valid JSON tool arguments and required fields only. " +
              "For editFile, use small exact search snippets copied from readFile output."
          });
          continue;
        }

        throw new Error(shortError);
      }

      const assistantMessage: LlmMessage = {
        role: "assistant",
        content: assistant.content,
        toolCalls: assistant.toolCalls
      };
      recordMessage(session, assistantMessage);
      const assistantNote = assistant.content.trim();
      if (assistantNote) {
        this.logger.log("orchestrator.assistant.note", {
          step,
          text: clipText(assistantNote, 300)
        });
      }

      if (assistant.toolCalls && assistant.toolCalls.length > 0) {
        this.logger.log("orchestrator.step.decision", {
          step,
          decision: "tool_calls",
          toolCount: assistant.toolCalls.length
        });

        for (const call of assistant.toolCalls) {
          if (!isToolName(call.name)) {
            this.logger.log("orchestrator.tool.call", {
              step,
              toolName: call.name,
              summary: "Model requested an unsupported tool."
            });
            const unknownResult = {
              name: call.name,
              success: false,
              message: "Model requested an unknown tool.",
              error: `Unsupported tool: ${call.name}`
            };
            recordMessage(session, {
              role: "tool",
              toolCallId: call.id,
              content: JSON.stringify(unknownResult, null, 2)
            });
            this.logger.log("orchestrator.tool.result", {
              step,
              toolName: call.name,
              success: false,
              message: unknownResult.message,
              error: unknownResult.error
            });
            continue;
          }

          const parsedArgs = parseToolArguments(call.arguments);
          if (!parsedArgs.ok || !parsedArgs.args) {
            this.logger.log("orchestrator.tool.call", {
              step,
              toolName: call.name,
              summary: "Invalid tool arguments.",
              error: parsedArgs.error ?? "Unknown parsing error."
            });
            const parseErrorResult = {
              name: call.name,
              success: false,
              message: "Malformed tool arguments.",
              error: parsedArgs.error ?? "Unknown argument parsing error."
            };
            recordMessage(session, {
              role: "tool",
              toolCallId: call.id,
              content: JSON.stringify(parseErrorResult, null, 2)
            });
            this.logger.log("orchestrator.tool.result", {
              step,
              toolName: call.name,
              success: false,
              message: parseErrorResult.message,
              error: parseErrorResult.error
            });
            continue;
          }
          this.logger.log("orchestrator.tool.call", {
            step,
            toolName: call.name,
            summary: summarizeToolArguments(call.name, parsedArgs.args, this.config.workspaceRoot)
          });

          const result = await executeTool(call.name, parsedArgs.args, toolContext);
          recordToolResult(session, result);
          recordMessage(session, {
            role: "tool",
            toolCallId: call.id,
            content: serializeToolResult(result)
          });

          if (result.name === "readFile" && result.success) {
            const summary = await this.summarizeFile(this.model, result.path, result.content);
            if (summary) {
              updateFileSummary(session, result.path, summary);
              recordMessage(session, {
                role: "system",
                content: `Reader summary for ${result.path}:\n${summary}`
              });
            }
          }

          if (result.name === "editFile" && result.success) {
            const note = await this.planVerification(this.model, session.userGoal, result.message);
            if (note) {
              addPlannerNote(session, note);
              recordMessage(session, {
                role: "system",
                content: `Planner verification note:\n${note}`
              });
            }
          }

          this.logger.log(
            "orchestrator.tool.result",
            buildToolResultLogPayload(step, result, this.config.workspaceRoot)
          );
        }

        continue;
      }

      this.logger.log("orchestrator.step.decision", {
        step,
        decision: "final_response"
      });

      const text = assistant.content.trim();
      if (text.length > 0) {
        this.logger.log("orchestrator.complete", { step });
        return {
          output: text,
          steps: step,
          session
        };
      }

      recordMessage(session, {
        role: "system",
        content: "Your previous response had no text and no tool calls. Provide a final response."
      });
    }

    this.logger.log("orchestrator.max_steps", {
      maxSteps: this.config.maxSteps
    });

    return {
      output: `Stopped after reaching max steps (${this.config.maxSteps}).`,
      steps: this.config.maxSteps,
      session
    };
  }
}
