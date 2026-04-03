import { SessionContext } from "./types.js";
import { LlmMessage } from "../llm/types.js";
import { ToolResult } from "../tools/types.js";

export function createSessionContext(userGoal: string, initialMessages: LlmMessage[]): SessionContext {
  return {
    userGoal,
    recentMessages: [...initialMessages],
    fileSummaries: {},
    lastToolOutputs: [],
    plannerNotes: []
  };
}

export function recordMessage(session: SessionContext, message: LlmMessage): void {
  session.recentMessages.push(message);
}

export function recordToolResult(session: SessionContext, result: ToolResult): void {
  session.lastToolOutputs.push(result);
}

export function updateFileSummary(
  session: SessionContext,
  filePath: string,
  summary: string
): void {
  session.fileSummaries[filePath] = summary;
}

export function addPlannerNote(session: SessionContext, note: string): void {
  session.plannerNotes.push(note);
}
