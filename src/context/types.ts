import { LlmMessage } from "../llm/types.js";
import { ToolResult } from "../tools/types.js";

export interface SessionContext {
  userGoal: string;
  recentMessages: LlmMessage[];
  fileSummaries: Record<string, string>;
  lastToolOutputs: ToolResult[];
  plannerNotes: string[];
}
