import fs from "node:fs/promises";
import path from "node:path";
import { ensurePathWithinRoot, toWorkspaceRelative } from "./pathGuard.js";
import { EditFileResult, EditPatchSpec } from "./types.js";

function countLines(text: string): number {
  if (!text) {
    return 0;
  }
  return text.split(/\r?\n/).length;
}

function replaceOnce(source: string, search: string, replace: string): { output: string; replacements: number } {
  const index = source.indexOf(search);
  if (index === -1) {
    return { output: source, replacements: 0 };
  }

  return {
    output: `${source.slice(0, index)}${replace}${source.slice(index + search.length)}`,
    replacements: 1
  };
}

function replaceAll(source: string, search: string, replace: string): { output: string; replacements: number } {
  if (!source.includes(search)) {
    return { output: source, replacements: 0 };
  }

  const parts = source.split(search);
  return {
    output: parts.join(replace),
    replacements: parts.length - 1
  };
}

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildFlexibleWhitespaceRegex(search: string, global = false): RegExp | null {
  if (!/\s/.test(search)) {
    return null;
  }

  const tokens = search.match(/\s+|[^\s]+/g);
  if (!tokens || tokens.length === 0) {
    return null;
  }

  const pattern = tokens
    .map((token) => (/^\s+$/.test(token) ? "\\s+" : escapeForRegex(token)))
    .join("");

  if (!pattern) {
    return null;
  }

  return new RegExp(pattern, global ? "g" : undefined);
}

function replaceFlexibleWhitespace(
  source: string,
  search: string,
  replace: string,
  replaceEveryMatch: boolean
): { output: string; replacements: number } {
  const regex = buildFlexibleWhitespaceRegex(search, replaceEveryMatch);
  if (!regex) {
    return { output: source, replacements: 0 };
  }

  if (!replaceEveryMatch) {
    if (!regex.test(source)) {
      return { output: source, replacements: 0 };
    }
    return {
      output: source.replace(regex, () => replace),
      replacements: 1
    };
  }

  let replacements = 0;
  const output = source.replace(regex, () => {
    replacements += 1;
    return replace;
  });

  return { output, replacements };
}

function buildBackupPath(workspaceRoot: string, relativePath: string): string {
  const safeRelative = relativePath.replace(/[\\/]/g, "__");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(workspaceRoot, ".aiagent_backups", `${timestamp}__${safeRelative}`);
}

function isInsideDir(filePath: string, dirPath: string): boolean {
  const resolvedFile = path.resolve(filePath);
  const resolvedDir = path.resolve(dirPath);
  return (
    resolvedFile === resolvedDir ||
    resolvedFile.startsWith(`${resolvedDir}${path.sep}`)
  );
}

export async function editFile(
  filePath: string,
  patchSpec: EditPatchSpec,
  workspaceRoot: string,
  createBackup = true
): Promise<EditFileResult> {
  const absolutePath = ensurePathWithinRoot(workspaceRoot, filePath);
  const protectedAgentDir = path.resolve(workspaceRoot, "aiagent");
  if (isInsideDir(absolutePath, protectedAgentDir)) {
    return {
      name: "editFile",
      success: false,
      path: filePath,
      replacements: 0,
      message: "Editing files inside the agent directory is blocked by policy."
    };
  }

  const relativePath = toWorkspaceRelative(workspaceRoot, absolutePath);
  const searchText = patchSpec.search ?? "";

  let fileExists = true;
  let originalContent = "";
  try {
    originalContent = await fs.readFile(absolutePath, "utf8");
  } catch {
    fileExists = false;
  }

  if (!fileExists) {
    if (searchText.length > 0) {
      return {
        name: "editFile",
        success: false,
        path: relativePath,
        replacements: 0,
        message: "Target file does not exist for search/replace edit."
      };
    }

    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, patchSpec.replace, "utf8");
    return {
      name: "editFile",
      success: true,
      path: relativePath,
      replacements: 1,
      addedLines: countLines(patchSpec.replace),
      removedLines: 0,
      message: "Created new file from patch replacement text."
    };
  }

  if (!searchText) {
    return {
      name: "editFile",
      success: false,
      path: relativePath,
      replacements: 0,
      message: "Patch search text cannot be empty for existing files."
    };
  }

  const replaced = patchSpec.all
    ? replaceAll(originalContent, searchText, patchSpec.replace)
    : replaceOnce(originalContent, searchText, patchSpec.replace);
  const resilientReplacement =
    replaced.replacements === 0
      ? replaceFlexibleWhitespace(originalContent, searchText, patchSpec.replace, patchSpec.all === true)
      : replaced;
  const removedLines = countLines(searchText) * resilientReplacement.replacements;
  const addedLines = countLines(patchSpec.replace) * resilientReplacement.replacements;

  if (resilientReplacement.replacements === 0) {
    return {
      name: "editFile",
      success: false,
      path: relativePath,
      replacements: 0,
      message: "No matching text found for patch operation."
    };
  }

  let backupPath: string | undefined;
  if (createBackup) {
    backupPath = buildBackupPath(workspaceRoot, relativePath);
    await fs.mkdir(path.dirname(backupPath), { recursive: true });
    await fs.writeFile(backupPath, originalContent, "utf8");
  }

  await fs.writeFile(absolutePath, resilientReplacement.output, "utf8");

  return {
    name: "editFile",
    success: true,
    path: relativePath,
    replacements: resilientReplacement.replacements,
    addedLines,
    removedLines,
    backupPath: backupPath ? toWorkspaceRelative(workspaceRoot, backupPath) : undefined,
    message: `Applied ${resilientReplacement.replacements} replacement(s).`
  };
}
