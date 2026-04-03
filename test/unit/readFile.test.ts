import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readFile } from "../../src/tools/readFile.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

describe("readFile", () => {
  it("reads an exact line range", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "aiagent-read-"));
    tempDirs.push(tempRoot);

    const filePath = path.join(tempRoot, "file.ts");
    await fs.writeFile(filePath, "line1\nline2\nline3\nline4\n", "utf8");

    const result = await readFile("file.ts", tempRoot, 2, 3);

    expect(result.success).toBe(true);
    expect(result.content).toBe("line2\nline3");
    expect(result.startLine).toBe(2);
    expect(result.endLine).toBe(3);
  });
});
