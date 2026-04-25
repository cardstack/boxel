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
//    Gate 4: Drain N microtasks + cross 1 macrotask boundary before
//            checking, so Backburner's render flush has had time to land
//      → Ember/Glimmer schedule binding updates via Backburner's
//        Promise.resolve().then(...) microtask chain, then occasionally
//        a setTimeout(0). Yielding the same way gives them priority.
//        Filters: ordinary render that just hasn't flushed yet.
//
//  In healthy renders Gate 4 is immediate: Backburner's flush runs in a
//  handful of microtasks, the binding flips to 'ready', Gate 3 closes,
//  we exit cleanly.
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
//  Contrast with the timer-stub error threading path, which catches
//  Backburner's `setTimeout(throw, 0)` runloop-rescue throw and
//  dispatches it via the `boxel-render-error` CustomEvent. That's
//  runloop-recoverable because Backburner has already finished its
//  rescue cleanup by the time the rescue-timer fires — the runloop
//  survived. Desync is the opposite: we detect it BECAUSE the runloop
//  didn't survive the render.
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

// Number of microtask yields before AND after the macrotask boundary.
// Tuned to give Backburner several rounds of flush opportunity without
// blowing past the deterministic flush window of a healthy render.
export const DEFAULT_MICROTASK_YIELDS = 5;

export const DESYNC_ERROR_TITLE = 'Render binding desync';
export const DESYNC_ERROR_MESSAGE =
  "Render route flipped model.status to 'ready' but the " +
  '[data-prerender-status] DOM attribute never updated to match. ' +
  "This means Glimmer's template binding for the prerender " +
  'container did not re-render, which only happens when the ' +
  "card's template threw during render and the Ember runloop " +
  'caught the exception in a way that no JS-level event ' +
  '(window.error / unhandledrejection / RSVP.on(error)) fires. ' +
  "Chrome's DevTools console typically shows 'Uncaught (in " +
  "promise) ...' for this class of failure, but that signal is " +
  'browser-internal and invisible to JavaScript. Inspect the card ' +
  "template — and any captured console errors in this doc's " +
  '`additionalErrors` — for a getter, helper, or computed that ' +
  'throws on the model state at render time.';

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
  // Used exactly once, to cross a single macrotask boundary.
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
  // Default 5 microtasks before and after the single macrotask boundary
  // gives Backburner ample flush opportunity.
  microtaskYields?: number;
}

// Runs a one-shot desync check. Yields microtasks + a single macrotask
// boundary so Backburner / Glimmer have had time to flush, then reads
// the [data-prerender-status] attribute. If the desync fingerprint
// persists, writes terminal state directly via Document API and
// surfaces a synthetic render error.
export async function runDomDesyncCheck(
  ctx: DesyncDetectorContext,
): Promise<void> {
  if (typeof document === 'undefined') {
    return;
  }
  let yields = ctx.microtaskYields ?? DEFAULT_MICROTASK_YIELDS;

  // Microtask drain #1: lets Backburner's render flush land. Backburner
  // schedules its flush via Promise.resolve().then(...), so yielding the
  // same way puts our continuation behind theirs.
  for (let i = 0; i < yields; i++) {
    if (ctx.isDestroyed()) return;
    await Promise.resolve();
  }

  // Macrotask boundary: ensures any setTimeout(0) deferral inside
  // Backburner's flush has fired before we read DOM state.
  await new Promise<void>((resolve) =>
    ctx.scheduleNativeTimeout(() => resolve(), 0),
  );

  // Microtask drain #2: lets any new microtasks scheduled during the
  // macrotask flush land before we read DOM state.
  for (let i = 0; i < yields; i++) {
    if (ctx.isDestroyed()) return;
    await Promise.resolve();
  }

  if (!isDesynced(ctx)) {
    return;
  }

  renderDesyncLogger.warn(
    `dom desync detected cardId=${ctx.cardId}: model.status=ready but DOM data-prerender-status=loading after Backburner flush window — assuming the template threw and the runloop swallowed the exception`,
  );
  emitDesyncError(ctx);
}

function isDesynced(ctx: DesyncDetectorContext): boolean {
  if (ctx.isDestroyed()) return false;
  if (!ctx.isReady()) return false;
  if (ctx.modelStatus() !== 'ready') return false;
  let container = document.querySelector(
    '[data-prerender]',
  ) as HTMLElement | null;
  if (!container) return false;
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
      // `boxel_index.timing_diagnostics`.
      diagnostics: { renderStage: stage },
      deps: [ctx.cardId],
      additionalErrors: null,
    },
  };
  let serialized = JSON.stringify(payload, null, 2);
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
