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

function createConfig(workspaceRoot: string, maxSteps = 4): AgentConfig {
  return {
    apiKey: "test",
    model: "test",
    temperature: 0,
    maxSteps,
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

describe("AgentOrchestrator", () => {
  it("stops after max steps", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "aiagent-orch-max-"));
    tempDirs.push(tempRoot);

    const model = new QueueChatModel([
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "1", name: "searchFiles", arguments: "{\"query\":\"x\"}" }]
      },
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "2", name: "searchFiles", arguments: "{\"query\":\"y\"}" }]
      }
    ]);

    const orchestrator = new AgentOrchestrator({
      model,
      config: createConfig(tempRoot, 2),
      logger: silentLogger,
      confirmCommand: async () => true,
      summarizeFile: async () => "",
      buildPlan: async () => [],
      planVerification: async () => ""
    });

    const result = await orchestrator.runTask("test max step");
    expect(result.output).toContain("Stopped after reaching max steps (2)");
  });

  it("handles malformed tool arguments gracefully", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "aiagent-orch-parse-"));
    tempDirs.push(tempRoot);

    const model = new QueueChatModel([
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "1", name: "readFile", arguments: "{bad-json" }]
      },
      {
        role: "assistant",
        content: "done"
      }
    ]);

    const orchestrator = new AgentOrchestrator({
      model,
      config: createConfig(tempRoot, 3),
      logger: silentLogger,
      confirmCommand: async () => true,
      summarizeFile: async () => "",
      buildPlan: async () => [],
      planVerification: async () => ""
    });

    const result = await orchestrator.runTask("malformed arg test");
    expect(result.output).toBe("done");
    expect(
      result.session.recentMessages.some(
        (message) => message.role === "tool" && message.content.includes("Malformed tool arguments")
      )
    ).toBe(true);
  });
});
