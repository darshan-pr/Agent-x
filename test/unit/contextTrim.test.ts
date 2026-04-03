import { describe, expect, it } from "vitest";
import { trimMessages } from "../../src/context/trim.js";
import { LlmMessage } from "../../src/llm/types.js";

describe("trimMessages", () => {
  it("keeps system message and latest tail", () => {
    const messages: LlmMessage[] = [
      { role: "system", content: "system" },
      { role: "user", content: "u1" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "u2" },
      { role: "assistant", content: "a2" }
    ];

    const trimmed = trimMessages(messages, 3);

    expect(trimmed.length).toBe(3);
    expect(trimmed[0].role).toBe("system");
    expect(trimmed[2].content).toBe("a2");
  });
});
