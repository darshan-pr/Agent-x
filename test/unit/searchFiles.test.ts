import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { searchFiles } from "../../src/tools/searchFiles.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

describe("searchFiles", () => {
  it("finds file path and content matches", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "aiagent-search-"));
    tempDirs.push(tempRoot);

    await fs.mkdir(path.join(tempRoot, "src"), { recursive: true });
    await fs.writeFile(path.join(tempRoot, "src", "sample.ts"), "export const hello = 'world';\n", "utf8");
    await fs.writeFile(path.join(tempRoot, "src", "other.ts"), "const value = 123;\n", "utf8");

    const result = await searchFiles("hello", ".", 10, tempRoot);

    expect(result.success).toBe(true);
    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.matches.some((match) => match.path.includes("sample.ts"))).toBe(true);
  });

  it("prioritizes direct path matches and ignores virtualenv directories", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "aiagent-search-priority-"));
    tempDirs.push(tempRoot);

    await fs.writeFile(path.join(tempRoot, "timetable.html"), "<html>timetable</html>\n", "utf8");
    await fs.mkdir(path.join(tempRoot, ".venv", "lib"), { recursive: true });
    await fs.writeFile(
      path.join(tempRoot, ".venv", "lib", "noise.py"),
      "timetable timetable timetable\n",
      "utf8"
    );

    const result = await searchFiles("timetable", ".", 5, tempRoot);

    expect(result.success).toBe(true);
    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.matches[0].path).toBe("timetable.html");
    expect(result.matches.some((match) => match.path.includes(".venv"))).toBe(false);
  });
});
