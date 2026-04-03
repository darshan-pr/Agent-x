import fs from "node:fs/promises";
import path from "node:path";
import type { Dirent } from "node:fs";
import { SearchFilesResult, SearchMatch } from "./types.js";
import { ensurePathWithinRoot, toWorkspaceRelative } from "./pathGuard.js";

const IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  ".next",
  ".venv",
  "venv",
  ".idea",
  ".vscode",
  ".pytest_cache",
  ".mypy_cache",
  "coverage",
  ".aiagent_backups",
  "__pycache__"
]);

const MAX_FILE_SIZE_BYTES = 512 * 1024;

function buildPreview(line: string): string {
  const trimmed = line.trim();
  return trimmed.length > 140 ? `${trimmed.slice(0, 140)}...` : trimmed;
}

async function findInFile(filePath: string, query: string): Promise<{ lineNumber: number; preview: string } | null> {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile() || stat.size > MAX_FILE_SIZE_BYTES) {
      return null;
    }

    const content = await fs.readFile(filePath, "utf8");
    const lines = content.split(/\r?\n/);
    const queryLower = query.toLowerCase();
    const index = lines.findIndex((line) => line.toLowerCase().includes(queryLower));

    if (index === -1) {
      return null;
    }

    return {
      lineNumber: index + 1,
      preview: buildPreview(lines[index])
    };
  } catch {
    return null;
  }
}

export async function searchFiles(
  query: string,
  baseDir: string,
  limit: number,
  workspaceRoot: string
): Promise<SearchFilesResult> {
  const searchRoot = ensurePathWithinRoot(workspaceRoot, baseDir);
  const pathMatches: SearchMatch[] = [];
  const contentMatches: SearchMatch[] = [];
  const seen = new Set<string>();
  const queryLower = query.toLowerCase();

  function pushMatch(bucket: SearchMatch[], match: SearchMatch): void {
    const key = `${match.path}:${match.matchType}:${match.lineNumber ?? 0}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    bucket.push(match);
  }

  function reachedLimit(): boolean {
    return pathMatches.length + contentMatches.length >= limit;
  }

  async function walk(currentDir: string): Promise<void> {
    if (reachedLimit()) {
      return;
    }

    let entries: Dirent[];
    try {
      entries = await fs.readdir(currentDir, {
        withFileTypes: true,
        encoding: "utf8"
      });
    } catch {
      return;
    }

    const sorted = [...entries].sort((a, b) => a.name.localeCompare(b.name));
    const files = sorted.filter((entry) => entry.isFile());
    const dirs = sorted.filter((entry) => entry.isDirectory() && !IGNORED_DIRS.has(entry.name));

    for (const entry of files) {
      if (reachedLimit()) {
        return;
      }
      const absolutePath = path.join(currentDir, entry.name);

      const relativePath = toWorkspaceRelative(workspaceRoot, absolutePath);
      const lowerPath = relativePath.toLowerCase();
      if (lowerPath.includes(queryLower)) {
        pushMatch(pathMatches, {
          path: relativePath,
          matchType: "path"
        });
      }

      if (reachedLimit()) {
        return;
      }

      const contentMatch = await findInFile(absolutePath, query);
      if (contentMatch) {
        pushMatch(contentMatches, {
          path: relativePath,
          matchType: "content",
          lineNumber: contentMatch.lineNumber,
          preview: contentMatch.preview
        });
      }
    }

    for (const entry of dirs) {
      if (reachedLimit()) {
        return;
      }
      await walk(path.join(currentDir, entry.name));
    }
  }

  await walk(searchRoot);
  const matches = [...pathMatches, ...contentMatches].slice(0, limit);

  return {
    name: "searchFiles",
    success: true,
    query,
    baseDir,
    matches,
    message: `Found ${matches.length} match(es).`
  };
}
