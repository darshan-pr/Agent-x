# AgentX TypeScript v1 (Groq)

A learning-friendly, production-style CLI agent built with small files and clear architecture.

It can:
- search files,
- read files,
- understand files (reader subagent summaries),
- edit files with backup,
- run allowlisted commands with confirmation.
- run in a persistent interactive CLI session (Claude-style workflow).
- stream a live activity timeline (plan, tool calls, file reads/edits, and line-change stats).
- generate request-specific plans at runtime (not static templates).

## Architecture (Small, Modular)

```text
src/
  cli/
    main.ts            # CLI entrypoint: parses task and prints final response
    confirm.ts         # Interactive yes/no confirmation for command execution

  config/
    env.ts             # Loads .env and builds AgentConfig
    policy.ts          # Command allowlist + blocked safety patterns
    types.ts           # AgentConfig and ExecutionPolicy types

  llm/
    groqClient.ts      # Official Groq SDK wrapper implementing ChatModel
    types.ts           # Model-agnostic chat/tool message contracts

  prompts/
    systemPrompt.ts    # Main agent behavior prompt
    toolPolicyPrompt.ts# Runtime policy instructions for safe execution
    subagentPrompts.ts # Reader/Planner subagent prompts

  context/
    session.ts         # SessionContext creation + updates
    trim.ts            # Context window trimming
    types.ts           # SessionContext type

  tools/
    index.ts           # Tool schemas + argument parsing + dispatch
    pathGuard.ts       # Workspace boundary safety checks
    searchFiles.ts     # searchFiles(query, baseDir, limit)
    readFile.ts        # readFile(path, startLine?, endLine?)
    editFile.ts        # editFile(path, patchSpec, createBackup)
    runCommand.ts      # runCommand(command, cwd?) with allowlist/confirm
    types.ts           # ToolName, ToolResult, runtime context

  subagents/
    analyzer.ts        # Reader subagent (file summaries)
    planner.ts         # Planner subagent (post-edit verification hints)

  core/
    orchestrator.ts    # Main loop: plan -> tool call -> observe -> continue
    logger.ts          # Structured JSON logs
```

## Agent Loop

```text
User task
  -> System + Policy prompts
  -> Groq model decides: final response OR tool call(s)
  -> Tool dispatcher executes safe tool
  -> Tool results fed back to model
  -> Reader/Planner subagents add context notes
  -> Repeat until final response or max step limit
```

## Tool Contracts

- `searchFiles(query, baseDir, limit)`
- `readFile(path, startLine?, endLine?)`
- `editFile(path, patchSpec, createBackup=true)`
- `runCommand(command, cwd?)`

`editFile` uses patch-style replacement (`search`, `replace`, optional `all`) and stores backups under `.aiagent_backups/`.

## Safety Defaults

- Workspace root guard prevents reads/writes outside `WORKSPACE_ROOT`.
- Agent cannot edit files inside the `aiagent/` directory (self-protection).
- Command policy blocks dangerous patterns.
- Only allowlisted command prefixes can run.
- Command execution requires confirmation by default.
- Orchestrator has a max-step cap to avoid runaway loops.
- Built-in retry with exponential backoff for rate-limit and transient API failures.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create env file:

```bash
cp .env.example .env
```

3. Update `.env`:

```env
GROQ_API_KEY=your_groq_api_key_here
GROQ_MODEL=llama-3.3-70b-versatile
GROQ_TEMPERATURE=0.2
AGENT_MAX_STEPS=8
RATE_LIMIT_MAX_RETRIES=4
RATE_LIMIT_BASE_DELAY_MS=1200
RATE_LIMIT_MAX_DELAY_MS=15000
WORKSPACE_ROOT=..
CONFIRM_COMMANDS=true
```

## Run

Interactive mode:

```bash
npm run agent
```

The CLI now shows:
- request understanding + a short plan,
- real-time tool activity (`searchFiles`, `readFile`, `editFile`, `runCommand`),
- file-level edit stats (`+added / -removed` line counts),
- green `AgentX` label in the interactive terminal output,
- final completion status by step.

Start interactive mode with first prompt:

```bash
npm run agent -- "Find auth route file and summarize it"
```

One-shot mode:

```bash
npm run agent -- --once "Find auth route file and summarize it"
```

## Development Commands

```bash
npm run lint
npm test
npm run build
```

## Walkthrough Example

Prompt:

```text
Find file with login route, rename old function to new one, then run npm test.
```

Expected flow:
1. Agent calls `searchFiles` to locate candidate files.
2. Agent calls `readFile` to inspect exact content.
3. Agent calls `editFile` with patch spec and writes backup.
4. Agent asks for confirmation and calls `runCommand`.
5. Agent returns final summary with what changed and command output.

## Testing

This repo includes:
- unit tests for `searchFiles`, `readFile`, `editFile`, `runCommand`,
- orchestrator tests for max-step control and malformed tool arguments,
- e2e fixture scenarios matching learning goals.
