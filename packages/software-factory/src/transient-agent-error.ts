/**
 * Retry wrapper for transient Agent SDK / network faults on a single
 * agent turn. Observed cause: an SDK "Stream idle timeout - partial
 * response received" crashed a whole multi-hour factory run 5 issues
 * deep (wardrobe, 2026-07-17) — no code defect involved, just a network
 * blip during a long-running turn. `runIssueLoop` has no retry around
 * `agent.run()`, so any exception there — transient or not — propagates
 * straight up through the CLI and kills the process.
 *
 * This does NOT catch agent logic errors, tool failures, or validation
 * failures — those are real signal the loop already handles (blocked
 * status, iteration retry, defect issues). It only retries the narrow
 * set of errors that mean "the network hiccuped," identified by message
 * pattern since the Agent SDK doesn't expose a typed error class for
 * them.
 */

const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_BASE_DELAY_MS = 2_000;

const TRANSIENT_PATTERNS = [
  /stream idle timeout/i,
  /econnreset/i,
  /etimedout/i,
  /econnrefused/i,
  /socket hang up/i,
  /fetch failed/i,
  /network error/i,
  /premature close/i,
];

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** True for the narrow set of errors that mean "the network hiccuped," not a real failure. */
export function isTransientAgentError(error: unknown): boolean {
  let message = errorMessage(error);
  return TRANSIENT_PATTERNS.some((pattern) => pattern.test(message));
}

export interface RetryTransientAgentErrorOptions {
  /** Retries after the first attempt. Default 2 (3 attempts total). */
  maxRetries?: number;
  /** Base delay before the first retry; doubles each subsequent retry. Default 2000ms. */
  baseDelayMs?: number;
  /** Override for tests — avoids real sleeps. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Call `attempt` and retry on a transient error, with exponential
 * backoff. A non-transient error (or the final retry's transient error)
 * rethrows immediately — callers see the same exception shape as an
 * unwrapped `attempt()` call, just with transient faults absorbed.
 */
export async function retryTransientAgentError<T>(
  attempt: () => Promise<T>,
  onRetry?: (attemptNumber: number, error: unknown) => void,
  options: RetryTransientAgentErrorOptions = {},
): Promise<T> {
  let maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  let baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  let sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  let attemptNumber = 0;
  for (;;) {
    try {
      return await attempt();
    } catch (error) {
      if (!isTransientAgentError(error) || attemptNumber >= maxRetries) {
        throw error;
      }
      attemptNumber++;
      onRetry?.(attemptNumber, error);
      await sleep(baseDelayMs * 2 ** (attemptNumber - 1));
    }
  }
}
