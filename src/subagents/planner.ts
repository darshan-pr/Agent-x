import { ChatModel } from "../llm/types.js";
import { PLANNER_SUBAGENT_PROMPT } from "../prompts/subagentPrompts.js";

function normalizeStep(step: string): string {
  return step
    .replace(/^\s*[-*•]\s*/, "")
    .replace(/^\s*\d+[\).\s-]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parsePlanResponse(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) {
    return [];
  }

  const firstBracket = trimmed.indexOf("[");
  const lastBracket = trimmed.lastIndexOf("]");
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    const maybeJson = trimmed.slice(firstBracket, lastBracket + 1);
    try {
      const parsed = JSON.parse(maybeJson) as unknown;
      if (Array.isArray(parsed)) {
        const steps = parsed
          .filter((item): item is string => typeof item === "string")
          .map(normalizeStep)
          .filter(Boolean);
        if (steps.length > 0) {
          return steps.slice(0, 6);
        }
      }
    } catch {
      // Fall through to line-based parsing.
    }
  }

  const lines = trimmed
    .split(/\r?\n/)
    .map(normalizeStep)
    .filter(Boolean);

  return lines.slice(0, 6);
}

export async function generateExecutionPlanWithPlannerSubagent(
  model: ChatModel,
  userInput: string
): Promise<string[]> {
  const response = await model.complete({
    temperature: 0.1,
    messages: [
      {
        role: "system",
        content:
          "You are a planning assistant for a coding CLI agent. " +
          "Create a short, practical plan tailored to the user's latest request. " +
          "Return ONLY a JSON array of 2-6 concise step strings. " +
          "Do not include markdown, explanation, or prose."
      },
      {
        role: "user",
        content: `User request: ${userInput}`
      }
    ]
  });

  return parsePlanResponse(response.content);
}

export async function planVerificationWithEditorSubagent(
  model: ChatModel,
  goal: string,
  editMessage: string
): Promise<string> {
  const response = await model.complete({
    temperature: 0.1,
    messages: [
      {
        role: "system",
        content: PLANNER_SUBAGENT_PROMPT
      },
      {
        role: "user",
        content: `User goal: ${goal}\n\nLatest edit result: ${editMessage}`
      }
    ]
  });

  return response.content.trim();
}
