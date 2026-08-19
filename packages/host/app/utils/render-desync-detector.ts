// DOM desync detector for prerender renders.
//
// The render route maps Ember route lifecycle onto the prerender's DOM
// signals. The contract is:
//
//   • [data-prerender-status="loading"] — render is in progress
//   • [data-prerender-status="ready"]   — render finished successfully
//   • [data-prerender-status="error"]   — recoverable render error
//   • [data-prerender-status="unusable"] — runloop-fatal error, page evicted
//
// The container element's data-prerender-status attribute is bound by
// Glimmer to @model.status. As model.status flips, Glimmer re-renders
// the binding and the prerender server reads the terminal state to
// capture HTML or surface the error.
//
// We've observed a class of production failures where this contract
// breaks. Concretely on the whitepaper render path:
//
//   1. The card's template throws during render (e.g. a getter or helper
//      compiles against a null/undefined helper reference and TypeError
//      escapes from the Glimmer encoder).
//   2. The Ember runloop catches the exception in a way that fires NO
//      JS-level event:
//
//        • window.error: not fired
//        • window.unhandledrejection: not fired
//        • RSVP.on('error'): not fired
//        • console.error: not called (from JS — Chrome's tracker logs
//          "Uncaught (in promise) ..." but that's a browser-internal
//          signal invisible to JavaScript)
//
//      The render route's existing error handlers cannot observe it.
//
//   3. After the throw, model() resolves cleanly and the route's
//      #waitForRenderLoadStability completes. modelState.isReady flips
//      to true, and modelState.state.set('status', 'ready') runs.
//      But Glimmer's binding for [data-prerender-status] never
//      re-renders (the failed template invalidates the render tree
//      mid-flight). The DOM stays at "loading" forever — the prerender
//      server waits the full cardRenderTimeout (90s) and surfaces a
//      misleading "Render timeout" error instead of the underlying bug.
//
// We CAN detect this state from JS, even though we can't observe the
// throw itself: it produces a deterministic desync where model.status
// is "ready" but the DOM attribute is still "loading". This module
// implements that detection.
//
// ──────────────────────────────────────────────────────────────────
//  False-positive analysis
// ──────────────────────────────────────────────────────────────────
//  The detector requires ALL gates simultaneously:
//
//    Gate 1: ctx.isReady() === true
//      → Model has reached the settle path successfully.
//        Filters: card legitimately still loading.
//
//    Gate 2: ctx.modelStatus() === 'ready'
//      → Specifically 'ready', not 'error'/'unusable'.
//        Filters: route.error path already wrote a terminal state.
//
//    Gate 3: DOM data-prerender-status === 'loading'
//      → Specifically 'loading', not 'ready'/'error'/'unusable'.
//        Filters: Glimmer's binding flushed; another handler wrote
//        a terminal state via Document API.
//
//    Gate 4: Backoff-poll Backburner's flush window before declaring a
//            verdict — drain microtasks, then sleep through a series of
//            macrotask hops, re-checking after each hop
//      → Ember/Glimmer schedule binding updates via Backburner's
//        Promise.resolve().then(...) microtask chain, then occasionally
//        a setTimeout(0). Yielding the same way gives them priority.
//        Under heavy parallel load (CI workers=3, contended Chrome
//        and Node event loops) Backburner's flush can lag tens to
//        hundreds of ms behind — short hops would produce false
//        positives. Hops back off (50ms → 200 → 500 → 1000 → 2000)
//        so healthy renders exit at the first hop, slow-but-correct
//        renders get up to ~3.75s of slack, and only renders that
//        stay desynced through the full grace window are declared
//        failures. Total grace is well under cardRenderTimeout (90s).
//        Filters: ordinary render that just hasn't flushed yet.
//
//  In healthy renders Gate 4 is immediate: Backburner's flush runs in a
//  handful of microtasks, the binding flips to 'ready', Gate 3 closes,
//  we exit cleanly before even reaching the first hop.
//
//  In-flight loads are filtered out upstream by
//  #waitForRenderLoadStability before we even call this detector — by
//  the time we reach here, the loader is quiescent.
//
//  We deliberately use Promise resolves + native setTimeout(0) instead
//  of requestAnimationFrame for the yield. RAF + Ember has a long
//  history of subtle breakages (RAF is throttled in headless / hidden
//  tabs and runs OUTSIDE the runloop, so it can race autotrack
//  invalidations). Microtask + macrotask yields are deterministic and
//  align with how Backburner sequences its own flushes.
//
// ──────────────────────────────────────────────────────────────────
//  When the detector fires
// ──────────────────────────────────────────────────────────────────
//  We write the prerender DOM signals directly via Document API rather
//  than going through Ember/Glimmer. The Glimmer binding is wedged for
//  this card; Ember's render queue can't deliver an update until the
//  next route activation. We use status='unusable' (which triggers
//  page eviction) because the fact that Glimmer's binding never
//  landed tells us the runloop stopped working mid-render — the
//  desynchronization between model.status and the DOM IS the signal
//  that the runloop is dead. Reusing the page would carry that broken
//  state into the next render, so the pool gets a fresh tab.
//
//  The error message names the failure class explicitly so the user
//  has a starting point. The render-runner separately enriches the
//  error doc with any captured console errors from puppeteer's
//  page.on('console') listener — including the CDP-reported stack
//  frames that the browser attached to the "Uncaught (in promise)"
//  log. That stack is the only pointer back at the offending template,
//  so it's worth preserving end-to-end.

import { logger } from '@cardstack/runtime-common';

const renderDesyncLogger = logger('render-desync');

// Number of microtask yields before AND after each macrotask hop.
// Tuned to give Backburner several rounds of flush opportunity per
// hop without blowing past the deterministic flush window of a
// healthy render.
export const DEFAULT_MICROTASK_YIELDS = 5;

// Polling backoff (in ms) used between desync verdicts. After each
// hop we re-check the gates, so a render that flushes mid-budget
// exits clean — only renders that stay desynced through the full
// cumulative window are declared failures.
//
// Why a series of hops instead of one long sleep: under heavy parallel
// load (CI workers=3, contended Chrome / Node event loops) Backburner's
// flush can lag tens to hundreds of ms behind the model.status='ready'
// assignment. A single short hop produces false-positive desyncs that
// evict healthy pages and amplify pool churn. A single LONG hop
// delays detection for every render. Backoff polling gives the fast
// path a fast exit and the slow path real wall-clock slack — total
// budget here is ~3.75s, well under cardRenderTimeout (90s).
export const DEFAULT_SETTLE_HOPS_MS: readonly number[] = [
  50, 200, 500, 1000, 2000,
];

export const DESYNC_ERROR_TITLE = 'Render binding desync';
export const DESYNC_ERROR_MESSAGE =
  'Encountered an Ember rendering error while rendering this card. ' +
  'The template threw during render and the runloop swallowed the ' +
  'exception, so no JS-level error event fired. Browser console ' +
  'errors captured during the render (if any) are listed in the ' +
  'Additional Errors section below.';

export interface DesyncDetectorContext {
  cardId: string;
  nonce: string;
  // Returns true when the route or owner is being torn down — we skip
  // any further work to avoid writing to a dead DOM.
  isDestroyed: () => boolean;
  // Has the render route's settle path completed for this model?
  // We only act when settle reached the ready branch.
  isReady: () => boolean;
  // Current model.status as the route sees it. We act only when this
  // is 'ready' so we don't double-fire on error / unusable paths.
  modelStatus: () => string;
  // Schedule a timer that bypasses the prerender timer stub so the
  // detector keeps firing even when blocked timers are in effect.
  // Used once per hop in the backoff polling loop.
  scheduleNativeTimeout: (callback: () => void, delayMs: number) => unknown;
  // Returns the [data-prerender] container and [data-prerender-error]
  // element — creating them if absent. Same helper the existing error
  // path uses, kept on the route so this module stays DOM-shape-neutral.
  ensurePrerenderElements: () => {
    container: HTMLElement | null;
    errorElement: HTMLElement | null;
  };
  // Append the captured render-timer summary onto a stack string. Same
  // helper the existing error path uses.
  appendStackSummary: (stack: string | undefined) => string | undefined;
  // Override knob for tuning microtask yield count in CI / production.
  // Default 5 microtasks before and after each macrotask hop gives
  // Backburner ample flush opportunity per round.
  microtaskYields?: number;
  // Override knob for the hop-by-hop wallclock backoff used between
  // verdicts. Each entry is a ms delay scheduled via
  // ctx.scheduleNativeTimeout (so the prerender timer stub is bypassed
  // and the detector keeps firing even when blocked timers are in
  // effect). After each hop we re-run the desync fingerprint check
  // and exit early if the binding has caught up.
  settleHopsMs?: readonly number[];
}

// Runs a one-shot desync check. Drains microtasks, then polls the
// desync fingerprint with a backoff series of macrotask hops so
// Backburner / Glimmer have had real wallclock time to flush. The
// fast path exits at the first clean check; only renders that stay
// desynced through the full grace window write terminal state
// directly via Document API and surface a synthetic render error.
export async function runDomDesyncCheck(
  ctx: DesyncDetectorContext,
): Promise<void> {
  if (typeof document === 'undefined') {
    return;
  }
  // Clamp `microtaskYields` to a sane positive integer. The override knob
  // is sourced from `globalThis.__boxelDomDesyncMicrotaskYields` (untyped at
  // runtime), so a stray non-finite / non-positive / non-integer value
  // would silently shrink the flush-window guard below `DEFAULT_MICROTASK_YIELDS`
  // and bump false-positive risk. Round to integer, require >= 1 (a fractional
  // override like 0.5 would otherwise floor to 0 and disable the drain
  // entirely), otherwise fall back to the default.
  let rawYields = ctx.microtaskYields;
  let flooredYields =
    typeof rawYields === 'number' && Number.isFinite(rawYields)
      ? Math.floor(rawYields)
      : NaN;
  let yields =
    Number.isFinite(flooredYields) && flooredYields >= 1
      ? flooredYields
      : DEFAULT_MICROTASK_YIELDS;
  // Sanitise settleHopsMs the same way: the override is sourced from
  // globalThis (untyped), and a malformed value would either skip the
  // grace window entirely (false positives) or stretch it past the
  // prerender timeout. Keep only non-negative finite numbers; 0ms is
  // allowed because a 0-delay hop is still a useful macrotask boundary
  // (it drains queued macrotasks once and yields control). If nothing
  // valid survives, fall back to the default series.
  let rawHops = ctx.settleHopsMs;
  let hopsMs: readonly number[] =
    Array.isArray(rawHops) &&
    rawHops.length > 0 &&
    rawHops.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0)
      ? rawHops
      : DEFAULT_SETTLE_HOPS_MS;

  // Microtask drain #0: let Backburner's render flush land before we
  // even start the wallclock polling. Backburner schedules its flush
  // via Promise.resolve().then(...), so yielding the same way puts our
  // continuation behind theirs and gives the fast path a fast exit.
  for (let i = 0; i < yields; i++) {
    if (ctx.isDestroyed()) return;
    await Promise.resolve();
  }
  if (!isDesynced(ctx)) return;

  // Wallclock polling with backoff. After each macrotask hop we drain
  // microtasks again, then re-check the desync fingerprint. A render
  // that catches up mid-budget exits clean; only renders that stay
  // desynced through the full cumulative grace window are declared
  // failures and trigger emitDesyncError.
  for (let hopIndex = 0; hopIndex < hopsMs.length; hopIndex++) {
    let delay = hopsMs[hopIndex];
    if (ctx.isDestroyed()) return;
    await new Promise<void>((resolve) =>
      ctx.scheduleNativeTimeout(() => resolve(), delay),
    );
    for (let i = 0; i < yields; i++) {
      if (ctx.isDestroyed()) return;
      await Promise.resolve();
    }
    if (!isDesynced(ctx)) return;
  }

  // Final destruction guard: every iteration of the polling loop above
  // checks isDestroyed before scheduling its hop, but there is still a
  // small window between the last hop's check and this verdict where
  // the route can be torn down (e.g. owner destroy or beforeModel of
  // the next render). Re-check here so we don't write terminal state
  // into a DOM that no longer belongs to this render — emitDesyncError
  // mints DOM nodes via ensurePrerenderElements, which we don't want
  // to do mid-teardown.
  if (ctx.isDestroyed()) return;
  let totalGraceMs = hopsMs.reduce((a, b) => a + b, 0);
  renderDesyncLogger.warn(
    `dom desync detected cardId=${ctx.cardId}: model.status=ready but DOM data-prerender-status=loading after ${totalGraceMs}ms grace window — assuming the template threw and the runloop swallowed the exception`,
  );
  emitDesyncError(ctx);
}

function isDesynced(ctx: DesyncDetectorContext): boolean {
  if (ctx.isDestroyed()) return false;
  if (!ctx.isReady()) return false;
  if (ctx.modelStatus() !== 'ready') return false;
  // Read-only fingerprint check: deliberately uses a direct
  // querySelector instead of ctx.ensurePrerenderElements() so we never
  // mint DOM nodes from the detection path. ensurePrerenderElements
  // creates-if-absent (the write-path semantic that emitDesyncError
  // depends on); calling it here would pollute every passing check
  // with empty container/error nodes.
  let container = document.querySelector(
    '[data-prerender]',
  ) as HTMLElement | null;
  if (!container) return false;
  // Race guard: the detector schedule fires async, so by the time
  // this check runs the prerender server may have moved on to a new
  // render that's reusing the same [data-prerender] container. The
  // closure-captured `ctx.cardId` and `ctx.nonce` identify the render
  // that scheduled this check.
  //
  // Card-id mismatch catches the cross-card reuse case (the container
  // is a singleton in the host's render route — successive renders for
  // different cards rewrite its dataset). Nonce mismatch catches the
  // same-card-next-attempt case: the prerender server can issue
  // multiple render attempts for the same cardId (e.g. retry-on-error
  // path) and `ctx.nonce` is the per-attempt token written by the
  // route. An in-flight check from attempt N polling against attempt
  // N+1's still-`loading` DOM would otherwise misclassify a healthy
  // in-progress render as a desync and write `unusable` for the wrong
  // attempt.
  let liveCardId = container.getAttribute('data-prerender-id');
  if (liveCardId && liveCardId !== ctx.cardId) return false;
  let liveNonce = container.getAttribute('data-prerender-nonce');
  if (liveNonce && liveNonce !== ctx.nonce) return false;
  return container.getAttribute('data-prerender-status') === 'loading';
}

function emitDesyncError(ctx: DesyncDetectorContext): void {
  let baseStack = new Error('render-route DOM desync detector').stack ?? '';
  let augmentedStack = ctx.appendStackSummary(baseStack) ?? baseStack;
  let stage = (globalThis as any).__boxelRenderStage ?? 'waiting-stability';
  let payload = {
    type: 'instance-error',
    error: {
      id: ctx.cardId,
      status: 500,
      title: DESYNC_ERROR_TITLE,
      message: DESYNC_ERROR_MESSAGE,
      stack: augmentedStack,
      // Structured diagnostics ride on the `diagnostics` field per
      // SerializedError; the indexer copies these onto
      // `boxel_index.diagnostics`.
      diagnostics: { renderStage: stage },
      deps: [ctx.cardId],
      additionalErrors: null,
    },
  };
  let serialized = JSON.stringify(payload, null, 2);
  // Write path: ensurePrerenderElements() intentionally creates the
  // [data-prerender] container and [data-prerender-error] element if
  // either is absent. By the time we get here we've already decided to
  // publish a terminal state, so we need a place to put it — even if
  // the parent template never rendered the scaffold (e.g. because the
  // throw happened before the parent template ran).
  let { container, errorElement } = ctx.ensurePrerenderElements();
  if (container) {
    // 'unusable' (not 'error'): the detector only fires when we've
    // proven Glimmer's runloop stopped advancing this card's render.
    // That's the "runloop is dead" signal; the pool must evict the
    // page so the next render gets a clean tab.
    container.dataset.prerenderStatus = 'unusable';
    container.dataset.prerenderId = ctx.cardId;
    container.dataset.prerenderNonce = ctx.nonce;
  }
  if (errorElement) {
    errorElement.dataset.prerenderId = ctx.cardId;
    errorElement.dataset.prerenderNonce = ctx.nonce;
    try {
      errorElement.textContent = serialized;
    } catch {
      // best-effort; avoid throwing while writing an error
    }
  }
}
