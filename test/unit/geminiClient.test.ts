import { describe, expect, it } from "vitest";
import { toGeminiRequest } from "../../src/llm/geminiClient.js";
import { CompleteChatParams } from "../../src/llm/types.js";

function extractContents(request: Record<string, unknown>): Array<Record<string, unknown>> {
  return (request.contents as Array<Record<string, unknown>> | undefined) ?? [];
}

describe("toGeminiRequest", () => {
  it("keeps valid function call/response ordering", () => {
    const params: CompleteChatParams = {
      temperature: 0.1,
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "read file" },
        {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "call-1", name: "readFile", arguments: "{\"path\":\"timetable.html\"}" }]
        },
        {
          role: "tool",
          toolCallId: "call-1",
          content: "{\"name\":\"readFile\",\"success\":true}"
        },
        { role: "assistant", content: "done" }
      ],
      tools: [
        {
          name: "readFile",
          description: "Read file",
          parameters: {
            type: "object",
            properties: {
              path: { type: "string" }
            },
            required: ["path"]
          }
        }
      ]
    };

    const request = toGeminiRequest(params);
    const contents = extractContents(request);
    expect(contents.map((item) => item.role)).toEqual(["user", "model", "user", "model"]);
  });

  it("drops orphan function call turns when tool responses are missing", () => {
    const params: CompleteChatParams = {
      temperature: 0.1,
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "do something" },
        {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "call-1", name: "editFile", arguments: "{\"path\":\"x\",\"patchSpec\":{}}" }]
        },
        { role: "assistant", content: "fallback text response" }
      ]
    };

    const request = toGeminiRequest(params);
    const contents = extractContents(request);
    expect(contents.map((item) => item.role)).toEqual(["user", "model"]);

    const modelParts = (contents[1]?.parts as Array<Record<string, unknown>> | undefined) ?? [];
    const hasFunctionCall = modelParts.some((part) => "functionCall" in part);
    expect(hasFunctionCall).toBe(false);
  });
});
