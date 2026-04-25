let restoreSetTimeout: typeof window.setTimeout | undefined;
let restoreSetInterval: typeof window.setInterval | undefined;
let invokeSetTimeout:
  | ((
      ...args: Parameters<typeof window.setTimeout>
    ) => ReturnType<typeof window.setTimeout>)
  | undefined;
let invokeSetInterval:
  | ((
      ...args: Parameters<typeof window.setInterval>
    ) => ReturnType<typeof window.setInterval>)
  | undefined;
const nativeClearTimeout =
  typeof globalThis.clearTimeout === 'function'
    ? globalThis.clearTimeout.bind(globalThis)
    : undefined;
const nativeClearInterval =
  typeof globalThis.clearInterval === 'function'
    ? globalThis.clearInterval.bind(globalThis)
    : undefined;
let stubDepth = 0;
let blockDepth = 0;
let warnedTimeout = false;
let warnedInterval = false;
type RenderTimerType = 'setTimeout' | 'setInterval';
type RenderTimerRecord = {
  type: RenderTimerType;
  delay?: number;
  callbackName?: string;
  stack?: string | null;
};
const TIMER_SUMMARY_HEADER = 'Timers blocked during prerender:';
let blockedTimers: RenderTimerRecord[] = [];
const TIMER_SUMMARY_GLOBAL = '__boxelRenderTimerSummary';

function registerTimerSummaryGlobal() {
  if (typeof globalThis === 'undefined') {
    return;
  }
  (globalThis as any)[TIMER_SUMMARY_GLOBAL] = () => getRenderTimerSummary();
}

function unregisterTimerSummaryGlobal() {
  if (typeof globalThis === 'undefined') {
    return;
  }
  delete (globalThis as any)[TIMER_SUMMARY_GLOBAL];
}

function recordBlockedTimer(
  type: RenderTimerType,
  args:
    | Parameters<typeof window.setTimeout>
    | Parameters<typeof window.setInterval>,
) {
  let delay =
    typeof args[1] === 'number' && Number.isFinite(args[1])
      ? args[1]
      : undefined;
  let callbackName =
    typeof args[0] === 'function' && args[0].name ? args[0].name : undefined;
  let stack: string | null = null;
  try {
    stack = new Error(`Timer blocked during prerender (${type})`).stack ?? null;
  } catch {
    stack = null;
  }
  blockedTimers.push({
    type,
    ...(delay !== undefined ? { delay } : {}),
    ...(callbackName ? { callbackName } : {}),
    stack,
  });
}

export function resetRenderTimerStats() {
  blockedTimers = [];
}

export function getRenderTimerSummary(): string | undefined {
  if (!blockedTimers.length) {
    return undefined;
  }
  let counts = blockedTimers.reduce(
    (acc, timer) => {
      acc[timer.type] += 1;
      return acc;
    },
    { setTimeout: 0, setInterval: 0 },
  );
  let lines = [
    TIMER_SUMMARY_HEADER,
    `Total timers blocked: ${blockedTimers.length}`,
    `setTimeout: ${counts.setTimeout}`,
    `setInterval: ${counts.setInterval}`,
    'Stacks (timer scheduling):',
  ];
  blockedTimers.forEach((timer, index) => {
    let label = `${index + 1}) ${timer.type}`;
    if (timer.delay !== undefined) {
      label += ` (${timer.delay}ms)`;
    }
    if (timer.callbackName) {
      label += ` callback: ${timer.callbackName}`;
    }
    lines.push(label);
    if (timer.stack) {
      for (let line of timer.stack.split('\n')) {
        lines.push(`  ${line}`);
      }
    }
  });
  return lines.join('\n');
}

export function appendRenderTimerSummaryToStack(
  stack: string | null | undefined,
): string | undefined {
  let summary = getRenderTimerSummary();
  if (!summary) {
    return stack ?? undefined;
  }
  if (stack && stack.includes(TIMER_SUMMARY_HEADER)) {
    return stack;
  }
  if (!stack) {
    return summary;
  }
  return `${stack}\n\n${summary}`;
}

function timersBlocked() {
  return stubDepth > 0 && blockDepth > 0;
}

// Backburner's runloop error rescue path is `setTimeout(() => { throw err }, 0)`,
// used to turn an exception caught by the runloop into a top-level uncaught
// error that surfaces via `window.error`. When the timer stub is active and we
// no-op those callbacks, the throw never fires — every render-route handler
// that listens on `window.error` / `unhandledrejection` / RSVP error stays
// quiet, and the prerender hangs at data-prerender-status="loading" until
// cardRenderTimeout. Surface the captured exception by writing the prerender
// DOM signals directly via Document API.
//
// We deliberately do NOT route through window.dispatchEvent('error', ...) or
// the boxel-render-error CustomEvent: those would trigger the render route's
// processRenderError path, which aborts in-flight transitions and the auth-
// fetch race that's currently building the model. Aborting cascades into
// in-flight network requests and surfaces as a misleading "Failed to fetch"
// error instead of the underlying timer throw. By the time this rescue-timer
// fires, Backburner has already cleaned up its internal runloop state — the
// runloop is alive — so the right move is just to publish the error to the
// prerender server without further Ember interaction. We write
// data-prerender-status="error" (NOT "unusable") because the runloop is
// recoverable; the page stays reusable for subsequent renders.
function surfaceTimerError(err: unknown) {
  if (typeof document === 'undefined') {
    return;
  }
  let message =
    err && typeof err === 'object' && 'message' in (err as object)
      ? String((err as { message: unknown }).message)
      : String(err);
  let stack =
    err && typeof err === 'object' && 'stack' in (err as object)
      ? String((err as { stack: unknown }).stack)
      : undefined;
  let payload = {
    type: 'instance-error',
    error: {
      status: 500,
      title: 'Render error rescued from prerender timer',
      message,
      stack: appendRenderTimerSummaryToStack(stack) ?? stack,
      additionalErrors: null,
    },
  };
  let serialized = JSON.stringify(payload, null, 2);
  let container = document.querySelector(
    '[data-prerender]',
  ) as HTMLElement | null;
  if (!container) {
    container = document.createElement('div');
    container.setAttribute('data-prerender', '');
    document.body.appendChild(container);
  }
  let errorElement = document.querySelector(
    '[data-prerender-error]',
  ) as HTMLElement | null;
  if (!errorElement) {
    errorElement = document.createElement('pre');
    errorElement.setAttribute('data-prerender-error', '');
    container.appendChild(errorElement);
  }
  container.dataset.prerenderStatus = 'error';
  try {
    errorElement.textContent = serialized;
  } catch {
    // best-effort; avoid throwing while writing an error
  }
}

function installStubs() {
  if (typeof window === 'undefined') {
    return;
  }
  if (restoreSetTimeout) {
    return;
  }
  registerTimerSummaryGlobal();
  restoreSetTimeout = window.setTimeout;
  restoreSetInterval = window.setInterval;
  invokeSetTimeout = window.setTimeout.bind(window);
  invokeSetInterval = window.setInterval.bind(window);

  window.setTimeout = ((...args: Parameters<typeof window.setTimeout>) => {
    if (!timersBlocked() || !invokeSetTimeout) {
      return invokeSetTimeout ? invokeSetTimeout(...args) : (0 as const);
    }
    recordBlockedTimer('setTimeout', args);
    let originalCallback = args[0];
    let delay = args[1] as number | undefined;
    // Zero-delay timers are typically Backburner runloop continuations or its
    // error-rescue throw path. Run them through the real setTimeout but wrap
    // in try/catch and route any thrown exception through surfaceTimerError —
    // see that function below for why we publish via Document API rather
    // than dispatching a window event. Without this, render errors that
    // Backburner forwards via `setTimeout(throw, 0)` are swallowed and the
    // prerender hangs at data-prerender-status="loading" until
    // cardRenderTimeout.
    if (
      typeof originalCallback === 'function' &&
      (delay === undefined || delay === 0)
    ) {
      let safeCallback = (...cbArgs: any[]) => {
        try {
          (originalCallback as (...a: any[]) => unknown)(...cbArgs);
        } catch (err) {
          surfaceTimerError(err);
        }
      };
      return invokeSetTimeout(safeCallback, delay);
    }
    if (!warnedTimeout) {
      console.warn(
        '[boxel] setTimeout is disabled while prerendering to prevent runaway timers',
      );
      warnedTimeout = true;
    }
    // Return a syntactically valid timeout handle but immediately clear it so
    // no timer keeps running while prerendering.
    let handle = invokeSetTimeout(() => {}, delay);
    nativeClearTimeout?.(handle as unknown as number | undefined);
    return handle;
  }) as typeof window.setTimeout;

  // Note: we intentionally do NOT thread errors through setInterval the way we
  // do for setTimeout above. Backburner's runloop error-rescue path uses
  // setTimeout(throw, 0) specifically — setInterval isn't part of its error
  // surfacing protocol. setInterval callers in our codebase are pollers and
  // animation loops where allowing even a single tick to fire would defeat
  // the purpose of suppressing runaway intervals during prerender. If we ever
  // discover a real-world case of a render error escaping via setInterval
  // we can revisit, but the symmetry isn't worth breaking the suppression
  // contract today.
  window.setInterval = ((...args: Parameters<typeof window.setInterval>) => {
    if (!timersBlocked() || !invokeSetInterval) {
      return invokeSetInterval ? invokeSetInterval(...args) : (0 as const);
    }
    recordBlockedTimer('setInterval', args);
    if (!warnedInterval) {
      console.warn(
        '[boxel] setInterval is disabled while prerendering to prevent runaway timers',
      );
      warnedInterval = true;
    }
    // Likewise for intervals: issue and clear right away to satisfy callers.
    let handle = invokeSetInterval(() => {}, args[1] as number | undefined);
    nativeClearInterval?.(handle as unknown as number | undefined);
    return handle;
  }) as typeof window.setInterval;
}

function restoreStubs() {
  if (typeof window === 'undefined') {
    return;
  }
  if (stubDepth === 0 && restoreSetTimeout && restoreSetInterval) {
    window.setTimeout = restoreSetTimeout;
    window.setInterval = restoreSetInterval;
    restoreSetTimeout = undefined;
    restoreSetInterval = undefined;
    invokeSetTimeout = undefined;
    invokeSetInterval = undefined;
    warnedTimeout = false;
    warnedInterval = false;
    resetRenderTimerStats();
    unregisterTimerSummaryGlobal();
  }
}

export function enableRenderTimerStub(): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }
  stubDepth++;
  installStubs();
  return () => {
    stubDepth = Math.max(stubDepth - 1, 0);
    if (stubDepth === 0) {
      blockDepth = 0;
      restoreStubs();
    }
  };
}

export function beginTimerBlock(): () => void {
  blockDepth++;
  return () => {
    blockDepth = Math.max(blockDepth - 1, 0);
  };
}

export async function withTimersBlocked<T>(
  cb: () => Promise<T> | T,
): Promise<T> {
  let release = beginTimerBlock();
  try {
    return await cb();
  } finally {
    release();
  }
}

/**
 * Schedule a callback via the native (unblocked) setTimeout, bypassing the
 * prerender timer stub. This is intended for the render-ready stability loop
 * which needs a real timer to avoid being blocked by the prerender stub while
 * still not relying on requestAnimationFrame (which is throttled in background
 * tabs and headless browsers).
 */
export function scheduleNativeTimeout(
  callback: () => void,
  delay?: number,
): ReturnType<typeof window.setTimeout> {
  let fn = invokeSetTimeout ?? globalThis.setTimeout;
  return fn(callback, delay);
}
