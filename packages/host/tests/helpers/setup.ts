/* eslint-disable @cardstack/host/wrapped-setup-helpers-only */
// This is the one place we allow these to be used directly.

import { getSettledState, settled } from '@ember/test-helpers';

import { getPendingWaiterState } from '@ember/test-waiters';
import type { TestWaiterDebugInfo } from '@ember/test-waiters';

import {
  setupApplicationTest as emberSetupApplicationTest,
  setupRenderingTest as emberSetupRenderingTest,
} from 'ember-qunit';
import window from 'ember-window-mock';
import { setupWindowMock } from 'ember-window-mock/test-support';

import { clearHtmlComponentCache } from '@cardstack/host/lib/html-component';
import type ResetService from '@cardstack/host/services/reset';
import { AiAssistantOpen } from '@cardstack/host/utils/local-storage-keys';

import { clearRemoteRealmCache } from './realm-server-mock/routes';

import { cleanupMonacoEditorModels } from './index';

// Map of fetch calls currently in flight, keyed by a globally-unique per-call
// id so overlapping identical requests each occupy their own slot, and so a
// late `finally` from a prior test can never collide with the current test's
// ids. The map reference is constant; we `clear()` it between tests rather
// than reassigning, otherwise late-resolving fetches would mutate the next
// test's tracking container. Snapshotted by the unhandled-rejection
// diagnostics helper to surface what was outstanding when a rejection fired.
const inFlightFetches = new Map<number, string>();
let nextFetchId = 0;

// Track the most recent failed fetches per test so a "Promise rejected during X"
// failure (which surfaces the generic browser TypeError "A network error
// occurred." with no URL) can be correlated with the actual request that blew
// up. Each entry is `${method} ${url}: ${reason}`; cleared in beforeEach.
//
// Each fetch captures `currentTestEpoch` at start; on failure, we only push to
// the buffer when the captured epoch still matches the current one. Without
// that gate, a fetch from test N rejecting after test N+1's beforeEach has
// cleared the buffer would repopulate it and misattribute URLs to N+1.
const recentFailedFetches: string[] = [];
const RECENT_FAILED_FETCHES_LIMIT = 20;
let currentTestEpoch = 0;

// Lazily install a single global QUnit.testDone callback that fires the
// existing diagnostic dump when a failed test ran longer than 60s. Silent
// QUnit timeouts (e.g. a waitFor that never resolves) don't surface through
// `unhandledrejection` or `onUncaughtException`, so without this hook a
// timeout shows only accumulated `[test-fetch]` lines with no in-flight /
// recent-failed snapshot at the moment QUnit gave up. QUnit's logging
// callbacks have no deregistration API, hence the install-once pattern; the
// callback reads the live module-level fetch state, which is reset each
// beforeEach, so it is consistent with the per-test fetch lifecycle.
let timeoutDiagnosticsInstalled = false;
function installTimeoutDiagnosticsOnce() {
  if (timeoutDiagnosticsInstalled) return;
  startEventLoopLagSampler();
  let qunitGlobal = getQUnitWithCallbacks();
  if (!qunitGlobal || typeof qunitGlobal.testDone !== 'function') return;
  qunitGlobal.testDone((details: QUnitTestDoneDetails) => {
    if (
      details &&
      typeof details.failed === 'number' &&
      details.failed > 0 &&
      typeof details.runtime === 'number' &&
      details.runtime > 60_000
    ) {
      logRejectionDiagnostics(
        '[test-timeout]',
        `failed test "${details.module ?? '<unknown module>'} > ${
          details.name ?? '<unknown test>'
        }" ran for ${details.runtime}ms`,
      );
    }
  });
  timeoutDiagnosticsInstalled = true;
}

interface QUnitTestDoneDetails {
  name?: string;
  module?: string;
  failed?: number;
  passed?: number;
  total?: number;
  runtime?: number;
}

function getQUnitWithCallbacks():
  | { testDone?: (cb: (details: QUnitTestDoneDetails) => void) => void }
  | undefined {
  let q = (globalThis as { QUnit?: unknown }).QUnit;
  return q && typeof q === 'object'
    ? (q as {
        testDone?: (cb: (details: QUnitTestDoneDetails) => void) => void;
      })
    : undefined;
}

function setupFetchDebugging(hooks: NestedHooks) {
  let originalFetch: typeof globalThis.fetch | undefined;
  let wrappedFetch: typeof globalThis.fetch | undefined;

  hooks.beforeEach(function () {
    inFlightFetches.clear();
    recentFailedFetches.length = 0;
    currentTestEpoch++;
    installTimeoutDiagnosticsOnce();
    if (!globalThis.fetch) {
      return;
    }
    originalFetch = globalThis.fetch;
    let boundFetch = globalThis.fetch.bind(globalThis);
    wrappedFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      let { method, url } = describeFetchRequest(input, init);
      let id = nextFetchId++;
      let epoch = currentTestEpoch;
      inFlightFetches.set(id, `${method} ${url}`);
      try {
        return await boundFetch(input, init);
      } catch (error) {
        let reason = formatErrorForLog(error);
        console.error(`[test-fetch] ${method} ${url} failed: ${reason}`);
        rememberFailedFetch(epoch, method, url, reason);
        throw error;
      } finally {
        inFlightFetches.delete(id);
      }
    };
    globalThis.fetch = wrappedFetch;
  });

  hooks.afterEach(function () {
    if (originalFetch && globalThis.fetch === wrappedFetch) {
      globalThis.fetch = originalFetch;
    }
    originalFetch = undefined;
    wrappedFetch = undefined;
    // Don't clear inFlightFetches here: QUnit.testDone runs AFTER
    // afterEach, so clearing here would empty the snapshot exactly when
    // the timeout-diagnostics callback needs it. beforeEach already
    // resets the buffer at the start of the next test.
  });
}

function rememberFailedFetch(
  epoch: number,
  method: string,
  url: string,
  reason: string,
) {
  // Drop late rejections from a prior test — the buffer is per-test and would
  // otherwise contaminate the next test's diagnostic output.
  if (epoch !== currentTestEpoch) {
    return;
  }
  recentFailedFetches.push(`${method} ${url}: ${reason}`);
  if (recentFailedFetches.length > RECENT_FAILED_FETCHES_LIMIT) {
    recentFailedFetches.splice(
      0,
      recentFailedFetches.length - RECENT_FAILED_FETCHES_LIMIT,
    );
  }
}

// Resolve the qunit runtime object (the one the qunit package installs on the
// global) rather than the ES module namespace. Importing `import * as QUnit
// from 'qunit'` produces a frozen module record where `onUncaughtException`
// is a getter-only export — assignments throw `TypeError: Cannot set property
// onUncaughtException of #<Object> which has only a getter`. The runtime
// global is writable; `suspendGlobalErrorHook` (uncaught-exceptions.ts) reads
// and reassigns it the same way.
function getQUnitRuntime():
  | { onUncaughtException?: (error: unknown) => void }
  | undefined {
  let q = (globalThis as { QUnit?: unknown }).QUnit;
  return q && typeof q === 'object'
    ? (q as { onUncaughtException?: (error: unknown) => void })
    : undefined;
}

// surface unhandled rejections during tests with full stacks + in-flight URLs
function setupUnhandledRejectionDiagnostics(hooks: NestedHooks) {
  let handler: ((event: PromiseRejectionEvent) => void) | undefined;
  let target: Window | undefined;
  let originalOnUncaughtException:
    | ((error: unknown) => void)
    | undefined
    | null;
  let wrappedOnUncaughtException: ((error: unknown) => void) | undefined;

  hooks.beforeEach(function () {
    // Host tests run in the browser; if `window` is missing or doesn't expose
    // an event listener API for some reason, skip rather than throw.
    target =
      typeof window !== 'undefined' &&
      typeof window.addEventListener === 'function'
        ? window
        : undefined;
    if (target) {
      handler = (event: PromiseRejectionEvent) => {
        // Observation only — do NOT call event.preventDefault(). QUnit's own
        // unhandled-rejection handling must still run and fail the test.
        logRejectionDiagnostics(
          '[test-unhandled-rejection]',
          formatRejectionReason(event.reason),
        );
      };
      target.addEventListener('unhandledrejection', handler);
    }

    // Wrap QUnit.onUncaughtException so QUnit-handled rejections (e.g.,
    // "Promise rejected during X: A network error occurred." — which propagates
    // via the test's awaited promise chain rather than firing a global
    // `unhandledrejection` event) also dump in-flight + recently-failed fetch
    // context. Without this hook, the failure message exposes only the generic
    // browser TypeError with no URL, making field-playground / code-submode
    // network-error flakes effectively unattributable.
    let qunitGlobal = getQUnitRuntime();
    if (qunitGlobal) {
      originalOnUncaughtException = qunitGlobal.onUncaughtException;
      wrappedOnUncaughtException = (error: unknown) => {
        try {
          logRejectionDiagnostics(
            '[test-qunit-uncaught]',
            formatRejectionReason(error),
          );
        } catch (_e) {
          // never let diagnostic logging swallow the original failure
        }
        if (typeof originalOnUncaughtException === 'function') {
          // Preserve QUnit as the receiver in case any future hook reads
          // `this` — current QUnit 2.x reads `config` from closure scope, but
          // calling via `.call(qunitGlobal, ...)` keeps the wrapper's behavior
          // identical to the unwrapped path regardless.
          originalOnUncaughtException.call(qunitGlobal, error);
        }
      };
      qunitGlobal.onUncaughtException = wrappedOnUncaughtException;
    }
  });

  hooks.afterEach(function () {
    if (target && handler) {
      target.removeEventListener('unhandledrejection', handler);
    }
    handler = undefined;
    target = undefined;

    let qunitGlobal = getQUnitRuntime();
    if (
      qunitGlobal &&
      qunitGlobal.onUncaughtException === wrappedOnUncaughtException
    ) {
      qunitGlobal.onUncaughtException = originalOnUncaughtException as
        | ((error: unknown) => void)
        | undefined;
    }
    wrappedOnUncaughtException = undefined;
    originalOnUncaughtException = undefined;
  });
}

function logRejectionDiagnostics(prefix: string, formattedReason: string) {
  let inFlightSnapshot = Array.from(inFlightFetches.values());
  let recent = recentFailedFetches.slice();
  console.error(
    [
      prefix,
      formattedReason,
      inFlightSnapshot.length
        ? `in-flight fetches at rejection time (${inFlightSnapshot.length}):\n  ${inFlightSnapshot.join('\n  ')}`
        : 'in-flight fetches at rejection time: <none>',
      recent.length
        ? `recent failed fetches this test (${recent.length}):\n  ${recent.join('\n  ')}`
        : 'recent failed fetches this test: <none>',
      summarizeSettledState(),
      summarizeEventLoopLag(),
      summarizeDomSnapshot(),
    ].join('\n'),
  );
}

// Sample event-loop lag across the whole suite so a silent timeout can be
// attributed. Flat lag while a single await never resolves points at a real
// code/render hang; lag spiking to seconds points at runner CPU/GC contention
// — the suite was simply too slow to beat the 60s budget, not stuck. Uses a
// raw setInterval, which is invisible to Ember's `settled()`, so it never
// perturbs the state it measures.
const EVENT_LOOP_LAG_SAMPLES_MS: number[] = [];
const EVENT_LOOP_LAG_SAMPLE_LIMIT = 12;
const EVENT_LOOP_LAG_INTERVAL_MS = 500;
let eventLoopLagLastTick = 0;
let eventLoopLagSamplerStarted = false;
function startEventLoopLagSampler() {
  if (eventLoopLagSamplerStarted) return;
  eventLoopLagSamplerStarted = true;
  eventLoopLagLastTick = performance.now();
  setInterval(() => {
    let now = performance.now();
    let lag = Math.max(
      0,
      now - eventLoopLagLastTick - EVENT_LOOP_LAG_INTERVAL_MS,
    );
    eventLoopLagLastTick = now;
    EVENT_LOOP_LAG_SAMPLES_MS.push(Math.round(lag));
    if (EVENT_LOOP_LAG_SAMPLES_MS.length > EVENT_LOOP_LAG_SAMPLE_LIMIT) {
      EVENT_LOOP_LAG_SAMPLES_MS.shift();
    }
  }, EVENT_LOOP_LAG_INTERVAL_MS);
}

function summarizeEventLoopLag(): string {
  if (!EVENT_LOOP_LAG_SAMPLES_MS.length) {
    return 'event-loop lag: <no samples>';
  }
  let samples = EVENT_LOOP_LAG_SAMPLES_MS.slice();
  let max = Math.max(...samples);
  return `event-loop lag (last ${samples.length} @ ${EVENT_LOOP_LAG_INTERVAL_MS}ms, max=${max}ms): ${samples.join(',')}ms`;
}

// On a silent timeout the client is usually fully settled, so the real failure
// is "the awaited DOM never appeared" rather than a hung promise. Capturing the
// rendered test container shows what DID render (an error card, an empty stack,
// a spinner) in place of the element the test was waiting for.
function summarizeDomSnapshot(): string {
  try {
    let root = document.querySelector('#ember-testing') ?? document.body;
    if (!root) {
      return 'dom snapshot: <no test container>';
    }
    let html = root.innerHTML.replace(/\s+/g, ' ').trim();
    const LIMIT = 4000;
    let body =
      html.length > LIMIT
        ? `${html.slice(0, LIMIT)}… (+${html.length - LIMIT} more chars)`
        : html;
    return `dom snapshot (#ember-testing, ${html.length} chars):\n  ${body}`;
  } catch (error) {
    return `dom snapshot: <unavailable: ${formatErrorForLog(error)}>`;
  }
}

// A silent QUnit timeout (e.g. a `waitFor`/`settled` that never resolves)
// usually shows no in-flight fetches — the awaited `settled()` is blocked on
// something other than the network. Snapshot Ember's settledness metrics and,
// when a test waiter is the culprit, name it (with any captured begin-async
// origin) so the next timeout points at the stuck gate instead of being opaque.
function summarizeSettledState(): string {
  try {
    let state = getSettledState();
    let metrics = [
      `hasRunLoop=${state.hasRunLoop}`,
      `hasPendingTimers=${state.hasPendingTimers}`,
      `hasPendingWaiters=${state.hasPendingWaiters}`,
      `hasPendingRequests=${state.hasPendingRequests}`,
      `isRenderPending=${state.isRenderPending}`,
      `pendingRequestCount=${state.pendingRequestCount}`,
    ].join(' ');
    let lines = [`settled state: ${metrics}`];
    if (state.hasPendingWaiters) {
      let { pending, waiters } = getPendingWaiterState();
      let names = Object.keys(waiters);
      lines.push(
        names.length
          ? `pending test waiters (${pending}):\n  ${names
              .map((name) => describePendingWaiter(name, waiters[name]))
              .join('\n  ')}`
          : `pending test waiters (${pending}): <none reported>`,
      );
    }
    return lines.join('\n');
  } catch (error) {
    // Diagnostics must never mask the original failure.
    return `settled state: <unavailable: ${formatErrorForLog(error)}>`;
  }
}

// `debugInfo` is `true` when stack capture is disabled, otherwise one entry per
// still-open `beginAsync` token. Each entry's `label`/`stack` points at the
// call site that opened the waiter and never closed it.
function describePendingWaiter(
  name: string,
  debugInfo: TestWaiterDebugInfo[] | true,
): string {
  if (debugInfo === true || debugInfo.length === 0) {
    return name;
  }
  let origins = debugInfo
    .map((info) => info.label ?? firstMeaningfulFrame(info.stack))
    .filter((origin): origin is string => Boolean(origin));
  return origins.length
    ? `${name} (${debugInfo.length}): ${origins.join(' | ')}`
    : `${name} (${debugInfo.length})`;
}

// Pull the first stack frame that isn't internal test-waiter/framework noise so
// the logged origin lands on the app code that opened the waiter.
function firstMeaningfulFrame(stack: string | undefined): string | undefined {
  if (!stack) return undefined;
  let frames = stack
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  let frame = frames.find(
    (line) =>
      line.startsWith('at ') &&
      !line.includes('test-waiters') &&
      !line.includes('buildWaiter'),
  );
  return frame ?? frames[0];
}

function formatRejectionReason(reason: unknown): string {
  let lines: string[] = [];
  let seen = new Set<unknown>();
  let current: unknown = reason;
  let depth = 0;
  while (current && !seen.has(current) && depth < 5) {
    seen.add(current);
    let prefix = depth === 0 ? 'reason' : `cause[${depth}]`;
    if (current instanceof Error) {
      let header = current.name
        ? `${current.name}: ${current.message}`
        : current.message;
      let stack = current.stack?.trim();
      lines.push(`${prefix}: ${header}`);
      if (stack) {
        lines.push(stack);
      }
      current = (current as { cause?: unknown }).cause;
    } else if (typeof current === 'string') {
      lines.push(`${prefix}: ${current}`);
      current = undefined;
    } else {
      try {
        lines.push(`${prefix}: ${JSON.stringify(current)}`);
      } catch (_e) {
        lines.push(`${prefix}: ${String(current)}`);
      }
      current = undefined;
    }
    depth++;
  }
  if (lines.length === 0) {
    lines.push(`reason: ${String(reason)}`);
  }
  return lines.join('\n');
}

function describeFetchRequest(input: RequestInfo | URL, init?: RequestInit) {
  if (input instanceof Request) {
    return { method: input.method, url: input.url };
  }
  let url = input instanceof URL ? input.href : String(input);
  let method = init?.method ?? 'GET';
  return { method, url };
}

function formatErrorForLog(error: unknown): string {
  if (error instanceof Error) {
    let header = error.name ? `${error.name}: ${error.message}` : error.message;
    let stack = error.stack?.trim();
    if (stack && !stack.includes(header)) {
      return `${header}\n${stack}`;
    }
    return stack ?? header ?? 'Unknown error';
  }
  if (typeof error === 'string') {
    return error;
  }
  try {
    let serialized = JSON.stringify(error);
    if (serialized && serialized !== '{}') {
      return serialized;
    }
  } catch (_e) {
    // fall through to string coercion
  }
  return String(error);
}

// Seed the AI Assistant open/closed preference to 'false' before each test so
// the existing test helpers (which click to open) are not double-toggled by
// the persistence behavior added in CS-11071. Keeping tests deterministic and
// matching the historical default of "panel closed until the test opens it".
function seedAiAssistantClosed(hooks: NestedHooks) {
  hooks.beforeEach(function () {
    window.localStorage.setItem(AiAssistantOpen, 'false');
  });
}

export function setupApplicationTest(hooks: NestedHooks) {
  emberSetupApplicationTest(hooks);
  setupWindowMock(hooks);
  seedAiAssistantClosed(hooks);
  setupFetchDebugging(hooks);
  setupUnhandledRejectionDiagnostics(hooks);
  hooks.afterEach(async function () {
    resetServiceIfPresent(this.owner, 'service:ai-assistant-panel-service');
    resetServiceIfPresent(this.owner, 'service:matrix-service');
    resetServiceIfPresent(this.owner, 'service:operator-mode-state-service');
    await settled();
    (
      this.owner.lookup('service:reset') as ResetService | undefined
    )?.resetAll();
    cleanupMonacoEditorModels();
    clearHtmlComponentCache();
    clearRemoteRealmCache();
  });
}

export function setupRenderingTest(hooks: NestedHooks) {
  emberSetupRenderingTest(hooks);
  setupWindowMock(hooks);
  seedAiAssistantClosed(hooks);
  setupFetchDebugging(hooks);
  setupUnhandledRejectionDiagnostics(hooks);
  hooks.afterEach(async function () {
    await settled();
    (
      this.owner.lookup('service:reset') as ResetService | undefined
    )?.resetAll();
    cleanupMonacoEditorModels();
    clearHtmlComponentCache();
    clearRemoteRealmCache();
  });
}

function resetServiceIfPresent(
  owner: {
    __container__?: { cache?: Record<string, unknown> };
    lookup(name: string): unknown;
  },
  name: string,
) {
  (
    owner.__container__?.cache?.[name] as
      | { resetState?: () => void }
      | undefined
  )?.resetState?.();
}
