// The wait a `Retry-After` header asks for, in ms, capped at `maxSeconds`,
// with jitter so the clients turned away together don't all come back
// together. A missing header counts as no wait beyond the jitter, and an
// unparseable one (the HTTP-date form, say) as one second.
export function retryAfterDelayMs(
  retryAfter: string | null,
  maxSeconds: number,
): number {
  let seconds = Number(retryAfter);
  if (!Number.isFinite(seconds) || seconds < 0) {
    seconds = 1;
  }
  seconds = Math.min(seconds, maxSeconds);
  return seconds * 1000 + Math.random() * 250;
}

// Whether a failed request was turned away for now rather than refused: a 503
// that says when to come back. The realm answers a card read this way while
// the card's type definition is still being rendered, which says nothing
// about the card itself. `responseHeaders` is where `CardService.fetchJSON`
// puts the failed response's headers.
export function isRetryableUnavailable(err: unknown): boolean {
  let { status, responseHeaders } =
    (err as { status?: unknown; responseHeaders?: unknown } | null) ?? {};
  return (
    status === 503 &&
    typeof (responseHeaders as Headers | undefined)?.has === 'function' &&
    (responseHeaders as Headers).has('Retry-After')
  );
}

// How a read the realm turned away for now (a 503 with `Retry-After`) is
// tried again: after the interval the realm names, capped at five seconds, at
// most three times, and only while the retry would start within thirty
// seconds of the first send. Each try is a new request the realm may hold
// until its own deadline before turning it away again, so a read it keeps
// turning away surfaces its refusal within those thirty seconds plus one such
// hold.
export const MAX_UNAVAILABLE_READ_RETRIES = 3;
export const MAX_UNAVAILABLE_RETRY_AFTER_SECONDS = 5;
export const UNAVAILABLE_READ_RETRY_WINDOW_MS = 30_000;

// The wait before trying again a read the realm turned away for now, given
// the `Retry-After` it answered with, the retries already sent, and the time
// since the first send. Undefined when the read is not to be tried again.
export function unavailableReadRetryDelayMs(
  retryAfter: string | null,
  retriesSent: number,
  elapsedMs: number,
): number | undefined {
  if (retryAfter === null || retriesSent >= MAX_UNAVAILABLE_READ_RETRIES) {
    return undefined;
  }
  let delayMs = retryAfterDelayMs(
    retryAfter,
    MAX_UNAVAILABLE_RETRY_AFTER_SECONDS,
  );
  return elapsedMs + delayMs <= UNAVAILABLE_READ_RETRY_WINDOW_MS
    ? delayMs
    : undefined;
}
