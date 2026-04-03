import { ExecutionPolicy } from "../config/types.js";
import { AgentLogger } from "../core/logger.js";

export type ToolName = "searchFiles" | "readFile" | "editFile" | "runCommand";

export interface SearchMatch {
  path: string;
  matchType: "path" | "content";
  lineNumber?: number;
  preview?: string;
}

export interface SearchFilesResult {
  name: "searchFiles";
  success: boolean;
  query: string;
  baseDir: string;
  matches: SearchMatch[];
  message: string;
}

export interface ReadFileResult {
  name: "readFile";
  success: boolean;
  path: string;
  startLine: number;
  endLine: number;
  totalLines: number;
  content: string;
  message: string;
}

export interface EditPatchSpec {
  search: string;
  replace: string;
  all?: boolean;
}

export interface EditFileResult {
  name: "editFile";
  success: boolean;
  path: string;
  replacements: number;
  addedLines?: number;
  removedLines?: number;
  backupPath?: string;
  message: string;
}

export interface RunCommandResult {
  name: "runCommand";
  success: boolean;
  command: string;
  cwd: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  blocked: boolean;
  message: string;
}

export interface ToolErrorResult {
  name: ToolName;
  success: false;
  message: string;
  error: string;
}

export type ToolResult =
  | SearchFilesResult
  | ReadFileResult
  | EditFileResult
  | RunCommandResult
  | ToolErrorResult;

export interface ToolRuntimeContext {
  workspaceRoot: string;
  executionPolicy: ExecutionPolicy;
  confirmCommand: (command: string) => Promise<boolean>;
  logger: AgentLogger;
}
