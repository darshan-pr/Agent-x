import { exec } from "node:child_process";
import { promisify } from "node:util";
import { evaluateCommandPolicy } from "../config/policy.js";
import { ensurePathWithinRoot, toWorkspaceRelative } from "./pathGuard.js";
import { ExecutionPolicy } from "../config/types.js";
import { RunCommandResult } from "./types.js";

const execAsync = promisify(exec);

function normalizeCwd(workspaceRoot: string, cwd?: string): string {
  const resolved = ensurePathWithinRoot(workspaceRoot, cwd ?? ".");
  return resolved;
}

export async function runCommand(
  command: string,
  workspaceRoot: string,
  executionPolicy: ExecutionPolicy,
  confirmCommand: (command: string) => Promise<boolean>,
  cwd?: string
): Promise<RunCommandResult> {
  const policy = evaluateCommandPolicy(command, executionPolicy);
  const resolvedCwd = normalizeCwd(workspaceRoot, cwd);

  if (!policy.allowed) {
    return {
      name: "runCommand",
      success: false,
      command,
      cwd: toWorkspaceRelative(workspaceRoot, resolvedCwd) || ".",
      exitCode: null,
      stdout: "",
      stderr: policy.reason ?? "Blocked by command policy.",
      blocked: true,
      message: "Command blocked by execution policy."
    };
  }

  if (executionPolicy.requireConfirmation) {
    const confirmed = await confirmCommand(command);
    if (!confirmed) {
      return {
        name: "runCommand",
        success: false,
        command,
        cwd: toWorkspaceRelative(workspaceRoot, resolvedCwd) || ".",
        exitCode: null,
        stdout: "",
        stderr: "User did not confirm command execution.",
        blocked: false,
        message: "Command cancelled by user confirmation policy."
      };
    }
  }

  try {
    const result = await execAsync(command, {
      cwd: resolvedCwd,
      timeout: 120_000,
      maxBuffer: 1024 * 1024
    });

    return {
      name: "runCommand",
      success: true,
      command,
      cwd: toWorkspaceRelative(workspaceRoot, resolvedCwd) || ".",
      exitCode: 0,
      stdout: result.stdout,
      stderr: result.stderr,
      blocked: false,
      message: "Command executed successfully."
    };
  } catch (error) {
    const err = error as { code?: number; stdout?: string; stderr?: string; message?: string };
    return {
      name: "runCommand",
      success: false,
      command,
      cwd: toWorkspaceRelative(workspaceRoot, resolvedCwd) || ".",
      exitCode: typeof err.code === "number" ? err.code : 1,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? err.message ?? "Unknown command execution error.",
      blocked: false,
      message: "Command execution failed."
    };
  }
}
