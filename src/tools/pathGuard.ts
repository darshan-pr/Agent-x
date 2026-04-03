import path from "node:path";

export function ensurePathWithinRoot(workspaceRoot: string, targetPath: string): string {
  const root = path.resolve(workspaceRoot);
  const resolved = path.resolve(root, targetPath);

  if (resolved === root) {
    return resolved;
  }

  if (!resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Path is outside workspace root: ${targetPath}`);
  }

  return resolved;
}

export function toWorkspaceRelative(workspaceRoot: string, absolutePath: string): string {
  return path.relative(path.resolve(workspaceRoot), absolutePath);
}
