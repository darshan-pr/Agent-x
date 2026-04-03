import { RateLimitConfig } from "../config/types.js";

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isRetryableError(error: unknown): boolean {
  const status = (error as { status?: number })?.status;
  if (typeof status === "number") {
    return status === 429 || status >= 500;
  }

  const code = (error as { code?: string })?.code;
  return code === "ECONNRESET" || code === "ETIMEDOUT";
}

export function readRetryAfterMs(error: unknown): number | null {
  const headers = (error as { headers?: Record<string, string | null | undefined> })?.headers;
  const retryAfterRaw = headers?.["retry-after"];
  if (!retryAfterRaw) {
    return null;
  }

  const numeric = Number(retryAfterRaw);
  if (Number.isFinite(numeric) && numeric >= 0) {
    return numeric * 1000;
  }

  const retryDate = Date.parse(retryAfterRaw);
  if (Number.isNaN(retryDate)) {
    return null;
  }

  return Math.max(0, retryDate - Date.now());
}

export function computeRetryDelayMs(
  attempt: number,
  config: RateLimitConfig,
  retryAfterMs: number | null
): number {
  if (retryAfterMs !== null) {
    return Math.min(Math.max(retryAfterMs, config.baseDelayMs), config.maxDelayMs);
  }

  const backoff = config.baseDelayMs * 2 ** attempt;
  const jitter = Math.floor(Math.random() * 300);
  return Math.min(backoff + jitter, config.maxDelayMs);
}
