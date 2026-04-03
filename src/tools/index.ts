import { LlmToolDefinition } from "../llm/types.js";
import { editFile } from "./editFile.js";
import { readFile } from "./readFile.js";
import { runCommand } from "./runCommand.js";
import { searchFiles } from "./searchFiles.js";
import {
  EditPatchSpec,
  ToolName,
  ToolResult,
  ToolRuntimeContext
} from "./types.js";

export const TOOL_DEFINITIONS: LlmToolDefinition[] = [
  {
    name: "searchFiles",
    description: "Search for files by path or content match.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        baseDir: { type: "string", default: "." },
        limit: { type: "number", default: 5 }
      },
      required: ["query"]
    }
  },
  {
    name: "readFile",
    description: "Read a file from the workspace, optionally with line range.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        startLine: { type: "number" },
        endLine: { type: "number" }
      },
      required: ["path"]
    }
  },
  {
    name: "editFile",
    description: "Apply a text patch edit to a file and optionally create backup.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        patchSpec: {
          type: "object",
          properties: {
            search: { type: "string" },
            replace: { type: "string" },
            all: { type: "boolean", default: false }
          },
          required: ["search", "replace"]
        },
        createBackup: { type: "boolean", default: true }
      },
      required: ["path", "patchSpec"]
    }
  },
  {
    name: "runCommand",
    description: "Run an allowlisted command in the workspace.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string" },
        cwd: { type: "string", default: "." }
      },
      required: ["command"]
    }
  }
];

const TOOL_NAMES: ToolName[] = ["searchFiles", "readFile", "editFile", "runCommand"];

export function isToolName(value: string): value is ToolName {
  return TOOL_NAMES.includes(value as ToolName);
}

export function parseToolArguments(raw: string): {
  ok: boolean;
  args?: Record<string, unknown>;
  error?: string;
} {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        ok: false,
        error: "Tool arguments must be a JSON object."
      };
    }
    return {
      ok: true,
      args: parsed as Record<string, unknown>
    };
  } catch (error) {
    return {
      ok: false,
      error: `Invalid JSON in tool arguments: ${(error as Error).message}`
    };
  }
}

function toInteger(input: unknown, fallback: number): number {
  if (typeof input === "number" && Number.isFinite(input)) {
    return Math.floor(input);
  }

  if (typeof input === "string") {
    const parsed = Number(input);
    if (Number.isFinite(parsed)) {
      return Math.floor(parsed);
    }
  }

  return fallback;
}

export async function executeTool(
  name: ToolName,
  args: Record<string, unknown>,
  ctx: ToolRuntimeContext
): Promise<ToolResult> {
  try {
    if (name === "searchFiles") {
      const query = typeof args.query === "string" ? args.query.trim() : "";
      if (!query) {
        return {
          name,
          success: false,
          error: "query is required",
          message: "Missing required field: query"
        };
      }
      const baseDir = typeof args.baseDir === "string" ? args.baseDir : ".";
      const limit = Math.min(Math.max(toInteger(args.limit, 5), 1), 20);
      return await searchFiles(query, baseDir, limit, ctx.workspaceRoot);
    }

    if (name === "readFile") {
      const filePath = typeof args.path === "string" ? args.path : "";
      if (!filePath) {
        return {
          name,
          success: false,
          error: "path is required",
          message: "Missing required field: path"
        };
      }

      const startLine = args.startLine === undefined ? undefined : toInteger(args.startLine, 1);
      const endLine = args.endLine === undefined ? undefined : toInteger(args.endLine, Number.MAX_SAFE_INTEGER);

      return await readFile(filePath, ctx.workspaceRoot, startLine, endLine);
    }

    if (name === "editFile") {
      const filePath = typeof args.path === "string" ? args.path : "";
      const patch = args.patchSpec as EditPatchSpec | undefined;
      const createBackup = typeof args.createBackup === "boolean" ? args.createBackup : true;

      if (!filePath || !patch || typeof patch.search !== "string" || typeof patch.replace !== "string") {
        return {
          name,
          success: false,
          error: "path and patchSpec(search, replace) are required",
          message: "Missing or invalid editFile arguments."
        };
      }

      return await editFile(filePath, patch, ctx.workspaceRoot, createBackup);
    }

    if (name === "runCommand") {
      const command = typeof args.command === "string" ? args.command : "";
      if (!command) {
        return {
          name,
          success: false,
          error: "command is required",
          message: "Missing required field: command"
        };
      }

      const cwd = typeof args.cwd === "string" ? args.cwd : ".";
      return await runCommand(
        command,
        ctx.workspaceRoot,
        ctx.executionPolicy,
        ctx.confirmCommand,
        cwd
      );
    }

    return {
      name,
      success: false,
      error: `Unsupported tool: ${name}`,
      message: "Tool is not supported."
    };
  } catch (error) {
    return {
      name,
      success: false,
      message: "Tool execution failed.",
      error: (error as Error).message
    };
  }
}

export function serializeToolResult(result: ToolResult): string {
  return JSON.stringify(result, null, 2);
}
