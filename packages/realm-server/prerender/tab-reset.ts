import { logger } from '@cardstack/runtime-common';
import type { Page } from 'puppeteer';
import { prerenderRenderTimeoutMs } from './prerender-constants.ts';

const log = logger('prerenderer');

// Post-render tab reset.
//
// A pooled tab outlives the render it served: the visit captures its HTML
// and hands the tab back to the pool with the card still mounted on the
// host's render route. Everything that card started keeps running there,
// between visits, on the renderer's main thread: ember-concurrency loops,
// `later` chains, live search resources re-querying the realm, a
// `MessageChannel` or `requestAnimationFrame` loop. The render route's timer
// stub stops a card's raw `setTimeout` / `setInterval` while it renders, but
// nothing stops work scheduled through anything else, and nothing at all
// stops it once the render is over. A busy card then holds the main thread
// of its tab (and of every tab sharing its renderer process) while the pool
// considers the tab idle, and the next render routed there stalls behind it
// until the render timeout ends it.
//
// The reset moves the tab to the host's empty `standby` route — the route
// every pooled tab boots on — before the visit releases it. Leaving the
// render route destroys the rendered card's component tree, and with it
// everything Ember ties to those components' lifetimes: destructors run,
// tasks are cancelled, resources are torn down. The host app itself, its
// loader and module cache, the store's identity map and the BrowserContext's
// HTTP cache all stay warm, so the next visit pays one route entry it would
// otherwise skip, not a cold start.
//
// The wait for the standby marker uses a MutationObserver rather than a
// timer: the render route replaces `setTimeout` while it is active, and a
// timer-polled wait on a page whose stub is still installed would never poll.
//
// The reset takes no abort signal. A caller that leaves once its render is
// done has nothing left to wait for, but the tab still goes back to the pool,
// and it must not go back with its card mounted or a transition half run.
// The budget bounds what the reset costs either way.
//
// A reset that does not land inside its budget means the page could not run
// one route transition — its main thread is pinned, or the host would not
// leave the render route. Either way the tab is not fit to be handed to the
// next render, and the caller retires it.

// The visit waits out the reset before it answers, and a render queued for
// the same tab waits behind it, so the budget is paid in full on every
// render whose card holds its tab's main thread: the case the reset exists
// for. A healthy reset is one route transition and one component teardown,
// well inside a second; the budget leaves headroom over that for a loaded
// machine, where a false timeout costs the realm a warm tab (its replacement
// keeps the BrowserContext and its HTTP cache). `postRenderResetMs` in a
// row's diagnostics records what each reset actually took.
export const DEFAULT_POST_RENDER_RESET_MS = 1000;
// Floor for an operator-supplied budget, as for the reuse probe's
// (`MIN_TAB_HEALTH_PROBE_MS` in `page-pool.ts`): below it the budget is
// under the CDP round trip and transition it is timing, so every reset
// fails and the pool retires its whole warm fleet.
const MIN_POST_RENDER_RESET_MS = 250;

export type TabResetOutcome =
  | { status: 'reset'; elapsedMs: number }
  // The page has no transition helper, or the transition threw. Says the host
  // couldn't leave the render route, not that the thread is busy.
  | { status: 'failed'; elapsedMs: number; error?: string }
  // The page did not reach the standby route inside the budget.
  | { status: 'timed-out'; elapsedMs: number };

// `PRERENDER_POST_RENDER_RESET_MS`: the budget for the reset. `0` turns the
// reset off (the kill switch). Anything else outside
// [`MIN_POST_RENDER_RESET_MS`, render timeout) falls back to the default
// rather than to the boundary, as the reuse probe's budget does: below the
// floor every reset fails, and at or above the render timeout a stuck reset
// holds the tab longer than the render it follows was allowed to take.
export function parsePostRenderResetMs(): number {
  let raw = process.env.PRERENDER_POST_RENDER_RESET_MS;
  if (raw === undefined || raw.trim() === '') {
    return DEFAULT_POST_RENDER_RESET_MS;
  }
  let n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    log.warn(
      `PRERENDER_POST_RENDER_RESET_MS=${raw} invalid (must be an integer >= 0; 0 disables the post-render reset); using ${DEFAULT_POST_RENDER_RESET_MS}`,
    );
    return DEFAULT_POST_RENDER_RESET_MS;
  }
  if (n === 0) {
    return 0;
  }
  if (n < MIN_POST_RENDER_RESET_MS || n >= prerenderRenderTimeoutMs) {
    log.warn(
      `PRERENDER_POST_RENDER_RESET_MS=${n} out of range (must be 0, or between ${MIN_POST_RENDER_RESET_MS} and ${prerenderRenderTimeoutMs - 1}ms); using ${DEFAULT_POST_RENDER_RESET_MS}`,
    );
    return DEFAULT_POST_RENDER_RESET_MS;
  }
  return n;
}

export async function resetTabToStandby(
  page: Page,
  budgetMs: number,
): Promise<TabResetOutcome> {
  let startedAt = Date.now();
  let elapsed = () => Date.now() - startedAt;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    let reset: Promise<TabResetOutcome> = page
      .evaluate(
        () =>
          new Promise<string | true>((resolve) => {
            let ready = () => document.querySelector('#standby-ready') !== null;
            let transition = (globalThis as any).boxelTransitionTo;
            if (typeof transition !== 'function') {
              resolve('no boxelTransitionTo helper on the page');
              return;
            }
            try {
              transition('standby');
            } catch (e: any) {
              resolve(`transition to standby threw: ${e?.message ?? e}`);
              return;
            }
            if (ready()) {
              resolve(true);
              return;
            }
            let observer = new MutationObserver(() => {
              if (ready()) {
                observer.disconnect();
                resolve(true);
              }
            });
            observer.observe(document.documentElement, {
              childList: true,
              subtree: true,
            });
          }),
      )
      .then(
        (result): TabResetOutcome =>
          result === true
            ? { status: 'reset', elapsedMs: elapsed() }
            : { status: 'failed', elapsedMs: elapsed(), error: result },
      )
      .catch(
        (e: unknown): TabResetOutcome => ({
          status: 'failed',
          elapsedMs: elapsed(),
          error: e instanceof Error ? e.message : String(e),
        }),
      );
    return await Promise.race([
      reset,
      new Promise<TabResetOutcome>((resolve) => {
        timer = setTimeout(
          () => resolve({ status: 'timed-out', elapsedMs: elapsed() }),
          budgetMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
