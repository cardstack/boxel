import type { Page } from 'puppeteer';

// Bounded main-thread liveness probe for a pooled Chrome tab.
//
// Kept in its own module — free of every other prerender import — because
// both the timeout-diagnostics path (`utils.ts`) and the tab hand-off gate
// (`page-pool.ts`) need it, and `page-pool.ts` deliberately keeps a light
// dependency graph so its unit tests run against stub pages with no
// Chrome, no S3 artifact sink, and no profiler machinery.

export type ResponsivenessProbe = {
  // False when the trivial evaluate neither resolved nor rejected inside
  // the budget (thread wedged), and also when the CDP round-trip failed
  // outright (`error` is set) — in both cases the page did not run script
  // for us.
  responsive: boolean;
  // Wall time the probe took. Roughly the CDP round-trip on a healthy
  // page; equal to the budget when the thread never answered.
  elapsedMs: number;
  // The failure, when the evaluate threw or rejected rather than timing
  // out. Distinguishes "thread pegged" from "target closed / crashed /
  // execution context destroyed" for the caller's log line.
  error?: unknown;
  // True when the caller's signal, rather than the budget or the page,
  // ended the probe. `responsive` is false in that case but says nothing
  // about the page: the caller is going away and should not draw a
  // conclusion about the tab from an abandoned probe.
  aborted?: boolean;
};

// Races a trivial `page.evaluate` against a timer and, when given one, the
// caller's abort signal. A page whose JS thread is available answers in
// about a millisecond regardless of what its last render did, so a
// non-aborted failure means the thread cannot run script for us: a runaway
// synchronous loop, a never-settling render still holding the thread, or a
// dead target.
//
// Never throws. Callers run this while holding a tab lease, so a throw
// escaping here would strand the lease; every failure mode is reported
// through the return value instead — including a synchronous throw from
// `page.evaluate` itself (a page object that isn't a live puppeteer Page).
export async function probePageResponsive(
  page: Page,
  budgetMs: number,
  signal?: AbortSignal,
): Promise<ResponsivenessProbe> {
  let startedAt = Date.now();
  // Clear the loser timer so a fast `evaluate` doesn't leave a pending
  // timeout holding the event loop for the rest of the probe window, and
  // detach the abort listener so a long-lived signal doesn't accumulate
  // one per probe.
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    if (signal?.aborted) {
      return { responsive: false, elapsedMs: 0, aborted: true };
    }
    let error: unknown;
    let aborted = false;
    let evaluated: Promise<boolean>;
    try {
      evaluated = page
        .evaluate(() => true)
        .then(() => true)
        .catch((e: unknown) => {
          error = e;
          return false;
        });
    } catch (e) {
      // `page.evaluate` threw synchronously rather than returning a
      // promise. Same conclusion as a rejection: no answer from the page.
      return { responsive: false, elapsedMs: Date.now() - startedAt, error: e };
    }
    let responsive = await Promise.race([
      evaluated,
      new Promise<boolean>((r) => {
        timer = setTimeout(() => r(false), budgetMs);
      }),
      new Promise<boolean>((r) => {
        if (!signal) return;
        onAbort = () => {
          aborted = true;
          r(false);
        };
        signal.addEventListener('abort', onAbort, { once: true });
      }),
    ]);
    return {
      responsive,
      elapsedMs: Date.now() - startedAt,
      ...(error !== undefined ? { error } : {}),
      ...(aborted ? { aborted: true } : {}),
    };
  } catch (e) {
    // Defensive: the contract is "never throws", and callers hold a tab
    // lease that a throw here would strand.
    return { responsive: false, elapsedMs: Date.now() - startedAt, error: e };
  } finally {
    clearTimeout(timer);
    if (onAbort) {
      signal?.removeEventListener('abort', onAbort);
    }
  }
}
