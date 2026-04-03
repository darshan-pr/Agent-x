import { ChatModel } from "../llm/types.js";
import { READER_SUBAGENT_PROMPT } from "../prompts/subagentPrompts.js";

export async function summarizeFileWithReaderSubagent(
  model: ChatModel,
  filePath: string,
  fileContent: string
): Promise<string> {
  const truncated = fileContent.length > 6000 ? `${fileContent.slice(0, 6000)}\n...` : fileContent;

  const response = await model.complete({
    temperature: 0.1,
    messages: [
      {
        role: "system",
        content: READER_SUBAGENT_PROMPT
      },
      {
        role: "user",
        content: `File: ${filePath}\n\nContent:\n${truncated}`
      }
    ]
  });

  return response.content.trim();
}
