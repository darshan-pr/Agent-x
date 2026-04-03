import { describe, expect, it } from "vitest";
import { defaultExecutionPolicy } from "../../src/config/policy.js";
import { runCommand } from "../../src/tools/runCommand.js";

describe("runCommand", () => {
  it("rejects disallowed commands", async () => {
    const policy = defaultExecutionPolicy(false);
    const result = await runCommand(
      "rm -rf /",
      process.cwd(),
      policy,
      async () => true
    );

    expect(result.success).toBe(false);
    expect(result.blocked).toBe(true);
  });

  it("runs allowed commands", async () => {
    const policy = defaultExecutionPolicy(false);
    const result = await runCommand(
      "node -e \"console.log('ok')\"",
      process.cwd(),
      policy,
      async () => true
    );

    expect(result.success).toBe(true);
    expect(result.stdout.trim()).toBe("ok");
  });
});
