// Cancellation plumbing shared across the prerender server.
//
// The manager wires a `ctxt.res` close listener into the upstream
// `AbortController` so a worker that gives up at 150 s propagates
// through to whichever attempt is live. The prerender server takes
// that signal from its Koa handler and threads it down through
// `Prerenderer` → `RenderRunner` → `PagePool.getPage` so queued
// waits (render semaphore, per-affinity tab queue) can bail out
// without entering render, and in-flight render steps race the
// signal (`withTimeout` / `abortable`) so a mid-render abort
// interrupts the step immediately — even against a wedged renderer
// whose CDP calls would otherwise pin the visit until a protocol
// timeout — and the Prerenderer tears the tab down.
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

// Races `run()` against the signal so a page operation that can't
// observe cancellation itself (a CDP evaluate against a wedged
// renderer never returns) is abandoned the moment the caller goes
// away, throwing `PrerenderCancelledError` instead of waiting on the
// operation's own (protocol-level) timeout. The abandoned promise
// keeps running until the cancel handler disposes the page — its
// eventual rejection is absorbed by the race, never surfacing as an
// unhandled rejection.
export async function abortable<T>(
  signal: AbortSignal | undefined,
  run: () => Promise<T>,
  state: PrerenderCancelState = 'rendering',
): Promise<T> {
  if (!signal) {
    return run();
  }
  throwIfAborted(signal, state);
  let onAbort: (() => void) | undefined;
  try {
    return await Promise.race([
      run(),
      new Promise<never>((_resolve, reject) => {
        onAbort = () =>
          reject(
            new PrerenderCancelledError({
              state,
              reason:
                typeof signal.reason === 'string' ? signal.reason : undefined,
            }),
          );
        // AbortSignal never replays `abort` for listeners attached
        // after the fact, so re-check before attaching. No await
        // separates the entry check above from this attach, so no
        // abort can land between them — the re-check keeps the
        // no-missed-abort guarantee local instead of resting on that
        // ordering.
        if (signal.aborted) {
          onAbort();
        } else {
          signal.addEventListener('abort', onAbort, { once: true });
        }
      }),
    ]);
  } finally {
    // The signal outlives any one operation (it spans the whole
    // request), so every race must detach its listener or a visit's
    // worth of steps accumulates listeners on the shared signal.
    if (onAbort) {
      signal.removeEventListener('abort', onAbort);
    }
  }
}
