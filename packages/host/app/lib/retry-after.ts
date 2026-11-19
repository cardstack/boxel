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
