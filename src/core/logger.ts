export interface AgentLogger {
  log(event: string, payload?: Record<string, unknown>): void;
}

export function createLogger(enabled = true): AgentLogger {
  return {
    log(event: string, payload: Record<string, unknown> = {}): void {
      if (!enabled) {
        return;
      }
      const line = {
        ts: new Date().toISOString(),
        event,
        ...payload
      };
      console.log(JSON.stringify(line));
    }
  };
}
