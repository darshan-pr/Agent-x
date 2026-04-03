import fs from "node:fs/promises";
import { ensurePathWithinRoot, toWorkspaceRelative } from "./pathGuard.js";
import { ReadFileResult } from "./types.js";

export async function readFile(
  filePath: string,
  workspaceRoot: string,
  startLine?: number,
  endLine?: number
): Promise<ReadFileResult> {
  const absolutePath = ensurePathWithinRoot(workspaceRoot, filePath);
  const content = await fs.readFile(absolutePath, "utf8");
  const lines = content.split(/\r?\n/);

  const totalLines = lines.length;
  const resolvedStart = Math.max(1, startLine ?? 1);
  const resolvedEnd = Math.min(totalLines, endLine ?? totalLines);

  if (resolvedStart > resolvedEnd) {
    return {
      name: "readFile",
      success: false,
      path: toWorkspaceRelative(workspaceRoot, absolutePath),
      startLine: resolvedStart,
      endLine: resolvedEnd,
      totalLines,
      content: "",
      message: "startLine cannot be greater than endLine."
    };
  }

  const selectedContent = lines.slice(resolvedStart - 1, resolvedEnd).join("\n");

  return {
    name: "readFile",
    success: true,
    path: toWorkspaceRelative(workspaceRoot, absolutePath),
    startLine: resolvedStart,
    endLine: resolvedEnd,
    totalLines,
    content: selectedContent,
    message: `Read lines ${resolvedStart}-${resolvedEnd}.`
  };
}
