// Cancellation plumbing shared across the prerender server.
//
// The manager wires a `ctxt.res` close listener into the upstream
// `AbortController` so a worker that gives up at 150 s propagates
// through to whichever attempt is live. The prerender server takes
// that signal from its Koa handler and threads it down through
// `Prerenderer` → `RenderRunner` → `PagePool.getPage` so queued
// waits (render semaphore, per-affinity tab queue) can bail out
// without entering render, and an in-flight render can be torn
// down cleanly via `#maybeEvict`.
//
// `PrerenderCancelledError` is the distinct-named rejection
// callers look for to decide "this is a user cancel, route the tab
// through eviction" rather than "this is a hard error, propagate
// up".

export class PrerenderCancelledError extends Error {
  name = 'PrerenderCancelledError';
  constructor(reason?: string) {
    super(reason ? `prerender cancelled: ${reason}` : 'prerender cancelled');
  }
}

export function isPrerenderCancellation(err: unknown): boolean {
  return err instanceof PrerenderCancelledError;
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new PrerenderCancelledError(
      typeof signal.reason === 'string' ? signal.reason : undefined,
    );
  }
}
