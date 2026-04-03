import { describe, expect, it } from "vitest";
import {
  computeRetryDelayMs,
  isRetryableError,
  readRetryAfterMs
} from "../../src/llm/rateLimit.js";

describe("rateLimit helpers", () => {
  it("identifies retryable status codes", () => {
    expect(isRetryableError({ status: 429 })).toBe(true);
    expect(isRetryableError({ status: 503 })).toBe(true);
    expect(isRetryableError({ status: 400 })).toBe(false);
  });

  it("reads retry-after header in seconds", () => {
    const ms = readRetryAfterMs({ headers: { "retry-after": "3" } });
    expect(ms).toBe(3000);
  });

  it("computes bounded exponential backoff", () => {
    const delay = computeRetryDelayMs(
      3,
      {
        maxRetries: 4,
        baseDelayMs: 500,
        maxDelayMs: 2500
      },
      null
    );

    expect(delay).toBeGreaterThanOrEqual(500);
    expect(delay).toBeLessThanOrEqual(2500);
  });
});
