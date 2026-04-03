import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultExecutionPolicy } from "../../src/config/policy.js";
import { AgentConfig } from "../../src/config/types.js";
import { AgentOrchestrator } from "../../src/core/orchestrator.js";
import { QueueChatModel } from "../helpers/fakeModel.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

function createConfig(workspaceRoot: string): AgentConfig {
  return {
    apiKey: "test",
    model: "test",
    temperature: 0,
    maxSteps: 6,
    maxMessages: 20,
    workspaceRoot,
    executionPolicy: defaultExecutionPolicy(false),
    rateLimit: {
      maxRetries: 0,
      baseDelayMs: 500,
      maxDelayMs: 1000
    }
  };
}

const silentLogger = { log: () => undefined };

describe("E2E scenarios", () => {
  it("finds and summarizes a file", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "aiagent-e2e-find-"));
    tempDirs.push(tempRoot);
    await fs.writeFile(path.join(tempRoot, "target.ts"), "export const value = 42;\n", "utf8");

    const model = new QueueChatModel([
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "1", name: "searchFiles", arguments: "{\"query\":\"target.ts\"}" }]
      },
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "2", name: "readFile", arguments: "{\"path\":\"target.ts\"}" }]
      },
      {
        role: "assistant",
        content: "Summary complete"
      }
    ]);

    const orchestrator = new AgentOrchestrator({
      model,
      config: createConfig(tempRoot),
      logger: silentLogger,
      confirmCommand: async () => true,
      summarizeFile: async () => "- Exports a constant named value",
      buildPlan: async () => [],
      planVerification: async () => ""
    });

    const result = await orchestrator.runTask("find and summarize");

    expect(result.output).toBe("Summary complete");
    expect(result.session.fileSummaries["target.ts"]).toContain("Exports a constant");
  });

  it("edits a file and creates backup", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "aiagent-e2e-edit-"));
    tempDirs.push(tempRoot);
    const filePath = path.join(tempRoot, "logic.ts");
    await fs.writeFile(filePath, "function oldName() { return 1; }\n", "utf8");

    const model = new QueueChatModel([
      {
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "1",
            name: "editFile",
            arguments:
              "{\"path\":\"logic.ts\",\"patchSpec\":{\"search\":\"oldName\",\"replace\":\"newName\"},\"createBackup\":true}"
          }
        ]
      },
      {
        role: "assistant",
        content: "Edit complete"
      }
    ]);

    const orchestrator = new AgentOrchestrator({
      model,
      config: createConfig(tempRoot),
      logger: silentLogger,
      confirmCommand: async () => true,
      summarizeFile: async () => "",
      buildPlan: async () => [],
      planVerification: async () => "- Run npm test"
    });

    const result = await orchestrator.runTask("rename function");

    const updated = await fs.readFile(filePath, "utf8");
    expect(updated).toContain("newName");
    expect(result.output).toBe("Edit complete");

    const backupDir = path.join(tempRoot, ".aiagent_backups");
    const backupFiles = await fs.readdir(backupDir);
    expect(backupFiles.length).toBeGreaterThan(0);
    expect(result.session.plannerNotes.length).toBe(1);
  });

  it("runs allowed npm test command", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "aiagent-e2e-run-"));
    tempDirs.push(tempRoot);

    await fs.writeFile(
      path.join(tempRoot, "package.json"),
      JSON.stringify(
        {
          name: "fixture",
          version: "1.0.0",
          scripts: {
            test: "echo test-ok"
          }
        },
        null,
        2
      ),
      "utf8"
    );

    const model = new QueueChatModel([
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "1", name: "runCommand", arguments: "{\"command\":\"npm test\"}" }]
      },
      {
        role: "assistant",
        content: "Run complete"
      }
    ]);

    const orchestrator = new AgentOrchestrator({
      model,
      config: createConfig(tempRoot),
      logger: silentLogger,
      confirmCommand: async () => true,
      summarizeFile: async () => "",
      buildPlan: async () => [],
      planVerification: async () => ""
    });

    const result = await orchestrator.runTask("run tests");

    const runOutput = result.session.lastToolOutputs.find((item) => item.name === "runCommand");
    expect(runOutput?.success).toBe(true);
    expect(result.output).toBe("Run complete");
  });

  it("rejects blocked command", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "aiagent-e2e-block-"));
    tempDirs.push(tempRoot);

    const model = new QueueChatModel([
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "1", name: "runCommand", arguments: "{\"command\":\"rm -rf /\"}" }]
      },
      {
        role: "assistant",
        content: "Blocked command handled"
      }
    ]);

    const orchestrator = new AgentOrchestrator({
      model,
      config: createConfig(tempRoot),
      logger: silentLogger,
      confirmCommand: async () => true,
      summarizeFile: async () => "",
      buildPlan: async () => [],
      planVerification: async () => ""
    });

    const result = await orchestrator.runTask("try dangerous command");

    const runOutput = result.session.lastToolOutputs.find((item) => item.name === "runCommand");
    expect(runOutput?.success).toBe(false);
    expect(runOutput && "blocked" in runOutput ? runOutput.blocked : false).toBe(true);
    expect(result.output).toBe("Blocked command handled");
  });
});
