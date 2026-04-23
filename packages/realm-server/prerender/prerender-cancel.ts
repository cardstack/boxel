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

// Which phase of the render the cancellation interrupted. `queued`
// is the saturation win — the render never started, so the only
// cost was the time spent waiting on the semaphore/tab queue.
// `rendering` means we already had a page and were inside the
// render body; the tab state is uncertain and the Prerenderer will
// dispose the affinity so the next render starts clean.
// `releasing` is the narrow window after render completed but
// before we serialized the response; the result is still valid,
// but the client isn't listening, so we just drop the bytes.
export type PrerenderCancelState = 'queued' | 'rendering' | 'releasing';

export class PrerenderCancelledError extends Error {
  name = 'PrerenderCancelledError';
  state: PrerenderCancelState;
  constructor(
    opts?: { state?: PrerenderCancelState; reason?: string } | string,
  ) {
    let reason: string | undefined;
    let state: PrerenderCancelState = 'queued';
    if (typeof opts === 'string') {
      reason = opts;
    } else if (opts) {
      reason = opts.reason;
      state = opts.state ?? 'queued';
    }
    super(reason ? `prerender cancelled: ${reason}` : 'prerender cancelled');
    this.state = state;
  }
}

export function isPrerenderCancellation(err: unknown): boolean {
  return err instanceof PrerenderCancelledError;
}

export function throwIfAborted(
  signal: AbortSignal | undefined,
  state: PrerenderCancelState = 'queued',
): void {
  if (signal?.aborted) {
    throw new PrerenderCancelledError({
      state,
      reason: typeof signal.reason === 'string' ? signal.reason : undefined,
    });
  }
}
