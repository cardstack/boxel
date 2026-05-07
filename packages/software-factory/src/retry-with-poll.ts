/**
 * Retry-with-poll helper for callers that read indexed state right after
 * a write. Realm-side indexing for source POSTs is async, so a search /
 * list immediately after a write may see a stale snapshot. Wrap the
 * call with `retryWithPoll` to bounded-poll until the result satisfies
 * a readiness predicate, so an agent or test that just pushed cards
 * isn't penalised for indexing latency.
 *
 * Use sparingly. The realm broadcasts a matrix `incremental` event when
 * indexing settles; long-lived consumers should subscribe to that
 * event stream rather than poll. This helper is for one-shot CLI /
 * agent / test paths where event subscription isn't practical.
 */

const DEFAULT_TOTAL_WAIT_MS = 30_000;
const DEFAULT_POLL_MS = 250;

export interface RetryWithPollOptions {
  /** Total time to keep retrying before giving up. Default 30s. */
  totalWaitMs?: number;
  /** Sleep between attempts. Default 250ms. */
  pollMs?: number;
}

/**
 * Call `attempt` repeatedly until `needsRetry` returns false or the
 * deadline elapses. Returns the latest result regardless — callers
 * decide how to interpret a still-unsatisfied result after the
 * deadline (typically "indexing didn't catch up; treat as if nothing
 * is there").
 *
 * Example: retry a `client.search` call while it returns no results
 *
 * ```ts
 * let result = await retryWithPoll(
 *   () => client.search(realmUrl, query),
 *   (r) => r.ok && (r.data?.length ?? 0) === 0,
 * );
 * ```
 */
export async function retryWithPoll<T>(
  attempt: () => Promise<T>,
  needsRetry: (result: T) => boolean,
  options: RetryWithPollOptions = {},
): Promise<T> {
  const totalWaitMs = options.totalWaitMs ?? DEFAULT_TOTAL_WAIT_MS;
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  const deadline = Date.now() + totalWaitMs;
  let result = await attempt();
  while (needsRetry(result) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollMs));
    result = await attempt();
  }
  return result;
}

/**
 * Match the realm's "module URL not found" load failure — the signature
 * of an in-flight indexing race where the source is on disk but the
 * in-memory module map hasn't been populated yet. Once the indexer
 * settles (success OR with an error_doc), the realm surfaces a
 * different error class — TypeError, parse error, or the indexed
 * error_doc message — so this predicate stops matching and retries
 * stop. Any caller that retries on the indexing race should match on
 * this and only this.
 */
export function isTransientIndexNotFound(error: string | undefined): boolean {
  if (!error) return false;
  return /\bnot found\b/i.test(error);
}
