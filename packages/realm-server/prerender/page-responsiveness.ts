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
  // outright (`error` is set) — in both cases the page cannot run script
  // for us right now.
  responsive: boolean;
  // Wall time the probe took. Roughly the CDP round-trip on a healthy
  // page; equal to the budget when the thread never answered.
  elapsedMs: number;
  // The rejection, when the evaluate failed rather than timed out.
  // Distinguishes "thread pegged" from "target closed / crashed /
  // execution context destroyed" for the caller's log line.
  error?: unknown;
};

// Races a trivial `page.evaluate` against a timer. A page whose JS thread
// is available answers in about a millisecond regardless of what its last
// render did, so a failure means the thread cannot run script for us: a
// runaway synchronous loop, a never-settling render still holding the
// thread, or a dead target. Never throws — the outcome is the return
// value.
export async function probePageResponsive(
  page: Page,
  budgetMs: number,
): Promise<ResponsivenessProbe> {
  let startedAt = Date.now();
  // Clear the loser timer so a fast `evaluate` doesn't leave a pending
  // timeout holding the event loop for the rest of the probe window.
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    let error: unknown;
    let responsive = await Promise.race([
      page
        .evaluate(() => true)
        .then(() => true)
        .catch((e: unknown) => {
          error = e;
          return false;
        }),
      new Promise<boolean>((r) => {
        timer = setTimeout(() => r(false), budgetMs);
      }),
    ]);
    return {
      responsive,
      elapsedMs: Date.now() - startedAt,
      ...(error !== undefined ? { error } : {}),
    };
  } finally {
    clearTimeout(timer);
  }
}
