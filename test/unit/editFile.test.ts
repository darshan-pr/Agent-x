import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { editFile } from "../../src/tools/editFile.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

describe("editFile", () => {
  it("applies patch and creates backup", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "aiagent-edit-"));
    tempDirs.push(tempRoot);

    await fs.writeFile(path.join(tempRoot, "sample.ts"), "const name = 'old';\n", "utf8");

    const result = await editFile(
      "sample.ts",
      {
        search: "old",
        replace: "new"
      },
      tempRoot,
      true
    );

    expect(result.success).toBe(true);
    expect(result.replacements).toBe(1);
    expect(result.backupPath).toBeDefined();

    const updated = await fs.readFile(path.join(tempRoot, "sample.ts"), "utf8");
    expect(updated).toContain("new");

    const backupAbsolute = path.join(tempRoot, result.backupPath ?? "");
    const backupStat = await fs.stat(backupAbsolute);
    expect(backupStat.isFile()).toBe(true);
  });

  it("blocks edits inside aiagent directory", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "aiagent-edit-guard-"));
    tempDirs.push(tempRoot);

    await fs.mkdir(path.join(tempRoot, "aiagent"), { recursive: true });
    await fs.writeFile(path.join(tempRoot, "aiagent", "main.ts"), "const x = 1;\n", "utf8");

    const result = await editFile(
      "aiagent/main.ts",
      {
        search: "1",
        replace: "2"
      },
      tempRoot,
      true
    );

    expect(result.success).toBe(false);
    expect(result.message).toContain("agent directory");
  });

  it("creates a new file when search text is empty and target does not exist", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "aiagent-edit-create-"));
    tempDirs.push(tempRoot);

    const result = await editFile(
      "generated/new_script.py",
      {
        search: "",
        replace: "print('hello from generated file')\n"
      },
      tempRoot,
      true
    );

    expect(result.success).toBe(true);
    expect(result.message).toContain("Created new file");

    const created = await fs.readFile(path.join(tempRoot, "generated", "new_script.py"), "utf8");
    expect(created).toContain("hello from generated file");
  });

  it("falls back to whitespace-tolerant matching when exact search is not found", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "aiagent-edit-flex-"));
    tempDirs.push(tempRoot);

    await fs.writeFile(
      path.join(tempRoot, "sample.html"),
      "<style>\n  body {\n    color: red;\n  }\n</style>\n",
      "utf8"
    );

    const result = await editFile(
      "sample.html",
      {
        search: "<style> body { color: red; } </style>",
        replace: "<style>\n  body {\n    color: blue;\n  }\n</style>"
      },
      tempRoot,
      false
    );

    expect(result.success).toBe(true);
    expect(result.replacements).toBe(1);
    const updated = await fs.readFile(path.join(tempRoot, "sample.html"), "utf8");
    expect(updated).toContain("color: blue;");
  });

  it("supports whitespace-tolerant matching for all replacements", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "aiagent-edit-flex-all-"));
    tempDirs.push(tempRoot);

    await fs.writeFile(
      path.join(tempRoot, "sample.css"),
      ".card {\n  padding: 8px;\n}\n\n.card {\n  padding: 8px;\n}\n",
      "utf8"
    );

    const result = await editFile(
      "sample.css",
      {
        search: ".card { padding: 8px; }",
        replace: ".card {\n  padding: 12px;\n}",
        all: true
      },
      tempRoot,
      false
    );

    expect(result.success).toBe(true);
    expect(result.replacements).toBe(2);
    const updated = await fs.readFile(path.join(tempRoot, "sample.css"), "utf8");
    expect(updated).not.toContain("padding: 8px");
    expect(updated.match(/padding: 12px/g)?.length).toBe(2);
  });
});
