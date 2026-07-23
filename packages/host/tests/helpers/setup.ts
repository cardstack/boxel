/* eslint-disable @cardstack/host/wrapped-setup-helpers-only */
// This is the one place we allow these to be used directly.

import { _backburner } from '@ember/runloop';

import { getContext, getSettledState, settled } from '@ember/test-helpers';

import { getPendingWaiterState } from '@ember/test-waiters';
import type { TestWaiterDebugInfo } from '@ember/test-waiters';

import {
  setupApplicationTest as emberSetupApplicationTest,
  setupRenderingTest as emberSetupRenderingTest,
} from 'ember-qunit';
import window from 'ember-window-mock';
import { setupWindowMock } from 'ember-window-mock/test-support';
import * as yaml from 'yaml';

import { clearHtmlComponentCache } from '@cardstack/host/lib/html-component';
import type SessionService from '@cardstack/host/services/session';
import { AiAssistantOpen } from '@cardstack/host/utils/local-storage-keys';

import { cleanupMonacoEditorModels } from './index';

// Pin `yaml` into the eager test bundle. `markdown-file-def` parses frontmatter
// with it, but the app shims `yaml` lazily (see `externals.ts`) so web users
// who never render markdown frontmatter don't download it. Under test that lazy
// `import('yaml')` is a per-render chunk fetch, and a single transient failure
// is cached by the engine as a permanent module rejection (only a page reload
// clears it), wedging every later render in the page. Importing it eagerly here
// — `setup.ts` loads at test-bundle boot — means the chunk is already resolved,
// so the app's lazy `import('yaml')` returns it without a fetch in tests; the
// app's lazy shim is untouched. The `parse` reference keeps the bundler from
// tree-shaking this import away (and asserts the module actually bundled).
if (typeof yaml.parse !== 'function') {
  throw new Error('expected `yaml` to be bundled into the host test build');
}

// Map of fetch calls currently in flight, keyed by a globally-unique per-call
// id so overlapping identical requests each occupy their own slot, and so a
// late `finally` from a prior test can never collide with the current test's
// ids. The map reference is constant; we `clear()` it between tests rather
// than reassigning, otherwise late-resolving fetches would mutate the next
// test's tracking container. Snapshotted by the unhandled-rejection
// diagnostics helper to surface what was outstanding when a rejection fired.
const inFlightFetches = new Map<number, { desc: string; startedAt: number }>();
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

// Module/name of the test currently running, captured from QUnit.testStart so a
// global error can be attributed to the test that produced it. Resets on page
// reload (i.e. per shard), which is exactly the lifetime over which the
// renderer-corruption tracking below is meaningful.
let currentTestLabel = '<unknown test>';

// An error thrown synchronously during render (e.g. a backtracking re-render
// assertion: "attempted to update X, but it had already been used previously in
// the same computation") leaves Ember's renderer in an unrecoverable state for
// the rest of the page load. Every later test that tries to render or fetch
// then fails too — typically as an opaque `settled()` timeout or `Failed to
// fetch` — with nothing tying it back to the test that actually broke the app.
// Remember the first such error so a later cascade victim's diagnostic can name
// the originating test instead of looking like an independent failure. Gated to
// the render-corruption signatures so a benign earlier rejection is never
// blamed for an unrelated downstream failure.
interface CapturedRenderError {
  epoch: number;
  label: string;
  message: string;
}
let firstRenderCorruptingError: CapturedRenderError | undefined;

function isRenderCorruptingError(message: string): boolean {
  return (
    message.includes(
      'had already been used previously in the same computation',
    ) ||
    message.includes('unrecoverable error occur during render') ||
    message.includes('Attempted to rerender')
  );
}

function rememberRenderCorruptingError(message: string) {
  if (firstRenderCorruptingError || !isRenderCorruptingError(message)) {
    return;
  }
  firstRenderCorruptingError = {
    epoch: currentTestEpoch,
    label: currentTestLabel,
    message,
  };
}

// Only surfaced for a test that ran AFTER the corrupting one — the originating
// test's own diagnostic already prints the error directly, so flagging it there
// as a "cascade" would be misleading.
function summarizePriorRenderCorruption(): string | undefined {
  let prior = firstRenderCorruptingError;
  if (!prior || prior.epoch >= currentTestEpoch) {
    return undefined;
  }
  return (
    `prior render-corrupting error (in "${prior.label}") left Ember's renderer ` +
    `unrecoverable for the rest of this page load — this failure is likely a ` +
    `cascade of it, not an independent failure:\n  ${prior.message}`
  );
}

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
  if (typeof qunitGlobal.testStart === 'function') {
    qunitGlobal.testStart((details: QUnitTestStartDetails) => {
      currentTestLabel = `${details?.module ?? '<unknown module>'} > ${
        details?.name ?? '<unknown test>'
      }`;
    });
  }
  // QUnit pushes the "Test took longer than Nms; test timed out." failure
  // synchronously from its timeout handler, while the hung app is still
  // mounted and the test owner still exists. That instant — not testDone — is
  // when the evidence is intact: teardown hooks run in between and reset
  // services, re-render the login screen, and re-arm queues, so the
  // testDone-time dump below reports the post-teardown world (all settled,
  // teardown-era DOM) instead of what was actually stuck. Capture a full dump
  // at the moment of the first timeout; later timeouts of the same test (a
  // hung afterEach/teardown `settled()` re-arms QUnit's timer, so one test can
  // time out repeatedly) get a compact dump naming what teardown is stuck on.
  if (typeof qunitGlobal.log === 'function') {
    let lastTimeoutMomentTestLabel: string | undefined;
    qunitGlobal.log((details: QUnitLogDetails) => {
      if (
        !details ||
        details.result !== false ||
        typeof details.message !== 'string' ||
        !details.message.includes('test timed out')
      ) {
        return;
      }
      // Fall back to the testStart-maintained label when the log payload
      // carries neither module nor name — otherwise two different tests
      // whose payloads both lack metadata would collapse into one label and
      // the second test's full dump would be suppressed as a repeat.
      let label =
        details.module || details.name
          ? `${details.module ?? '<unknown module>'} > ${
              details.name ?? '<unknown test>'
            }`
          : currentTestLabel;
      if (lastTimeoutMomentTestLabel === label) {
        console.error(
          [
            '[test-timeout-moment+] same test timed out again (teardown also hung)',
            summarizeSettledState(),
            summarizePendingRunloopTimers(),
          ].join('\n'),
        );
        return;
      }
      lastTimeoutMomentTestLabel = label;
      logRejectionDiagnostics(
        '[test-timeout-moment]',
        `test "${label}" hit QUnit's timeout; state captured at the moment of timeout, before teardown hooks ran`,
      );
    });
  }
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

interface QUnitTestStartDetails {
  name?: string;
  module?: string;
}

interface QUnitLogDetails {
  result?: boolean;
  message?: string;
  name?: string;
  module?: string;
}

function getQUnitWithCallbacks():
  | {
      testDone?: (cb: (details: QUnitTestDoneDetails) => void) => void;
      testStart?: (cb: (details: QUnitTestStartDetails) => void) => void;
      log?: (cb: (details: QUnitLogDetails) => void) => void;
    }
  | undefined {
  let q = (globalThis as { QUnit?: unknown }).QUnit;
  return q && typeof q === 'object'
    ? (q as {
        testDone?: (cb: (details: QUnitTestDoneDetails) => void) => void;
        testStart?: (cb: (details: QUnitTestStartDetails) => void) => void;
        log?: (cb: (details: QUnitLogDetails) => void) => void;
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
      inFlightFetches.set(id, {
        desc: `${method} ${url}`,
        startedAt: Date.now(),
      });
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
        let reason = formatRejectionReason(event.reason);
        rememberRenderCorruptingError(reason);
        logRejectionDiagnostics('[test-unhandled-rejection]', reason);
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
          let reason = formatRejectionReason(error);
          rememberRenderCorruptingError(reason);
          logRejectionDiagnostics('[test-qunit-uncaught]', reason);
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
  // Include how long each fetch has been outstanding — a request hung for most
  // of the test's lifetime (vs one just dispatched) is the wedge signature, and
  // pairing the age with the `recent failed fetches` list below shows whether
  // earlier retry attempts of the same URL rejected before this one stuck.
  let now = Date.now();
  let inFlightSnapshot = Array.from(inFlightFetches.values()).map(
    (f) => `${f.desc} (outstanding ${now - f.startedAt}ms)`,
  );
  let recent = recentFailedFetches.slice();
  let priorCorruption = summarizePriorRenderCorruption();
  console.error(
    [
      prefix,
      formattedReason,
      priorCorruption,
      inFlightSnapshot.length
        ? `in-flight fetches at rejection time (${inFlightSnapshot.length}):\n  ${inFlightSnapshot.join('\n  ')}`
        : 'in-flight fetches at rejection time: <none>',
      recent.length
        ? `recent failed fetches this test (${recent.length}):\n  ${recent.join('\n  ')}`
        : 'recent failed fetches this test: <none>',
      summarizeSettledState(),
      summarizePendingRunloopTimers(),
      summarizeRealmAuth(),
      summarizeLoginReadiness(),
      summarizeEventLoopLag(),
      summarizeDomSnapshot(),
    ]
      .filter((line): line is string => Boolean(line))
      .join('\n'),
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
// Last substantial #ember-testing HTML captured while a test was still
// mounted. On a silent timeout the dump runs at QUnit.testDone — after the app
// is torn down and the live container is empty — so this preserves what the
// hung test was actually rendering ~during the stall.
let lastMountedDomSnapshot = '';
// Last matrix login-readiness + `postLoginCompleted` transition provenance
// captured while a test was still mounted. Sampled here (rather than read at
// QUnit.testDone) for the same reason as the DOM snapshot — the owner is torn
// down by then — and because the CI console output is a rolling buffer that
// evicts the causal reset before the post-timeout diagnostic runs. Preserving
// which caller last flipped `postLoginCompleted` turns an opaque cold-boot
// login-screen timeout (DOM shows the login form, `postLoginCompleted:false`)
// into one that names the reset.
let lastLoginReadinessSnapshot = '';
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
    try {
      let root = document.querySelector('#ember-testing');
      let html = root ? root.innerHTML.replace(/\s+/g, ' ').trim() : '';
      // Only keep substantial renders so a between-tests empty container
      // doesn't clobber the last real one.
      if (html.length > 60) {
        lastMountedDomSnapshot = html;
      }
    } catch {
      // never let diagnostics sampling throw
    }
    try {
      let snapshot = captureLoginReadinessSnapshot();
      // Only overwrite with a real reading so a between-tests / post-teardown
      // tick (owner gone) doesn't clobber the last mounted snapshot.
      if (snapshot) {
        lastLoginReadinessSnapshot = snapshot;
      }
    } catch {
      // never let diagnostics sampling throw
    }
  }, EVENT_LOOP_LAG_INTERVAL_MS);
}

interface PostLoginTransitionDebug {
  to: boolean;
  reason: string;
  msAgo: number;
  stack: string;
}

// Read the current test's matrix login-readiness from the container cache
// (never `lookup`, so sampling can't instantiate the service for a test that
// doesn't use it) and format it, including a compact tail of each recent
// `postLoginCompleted` transition's stack. Returns undefined when there is no
// active owner or the service was never instantiated.
function captureLoginReadinessSnapshot(): string | undefined {
  let owner = (
    getContext() as
      | { owner?: { __container__?: { cache?: Record<string, unknown> } } }
      | undefined
  )?.owner;
  let service = owner?.__container__?.cache?.['service:matrix-service'] as
    | {
        loginReadinessDebug?: unknown;
        postLoginTransitionsDebug?: PostLoginTransitionDebug[];
      }
    | undefined;
  if (!service) {
    return undefined;
  }
  let readiness = service.loginReadinessDebug;
  let transitions = service.postLoginTransitionsDebug ?? [];
  let transitionLines = transitions.length
    ? transitions
        .map((t) => {
          // Skip the Error header + the setter frame; keep the caller chain
          // that identifies who flipped the flag (start-success / logout /
          // resetState → afterEach, etc.).
          let frames = (t.stack ?? '')
            .split('\n')
            .slice(2, 6)
            .map((f) => f.trim())
            .filter(Boolean);
          return `${t.to ? '→true' : '→false'} via ${t.reason} (${t.msAgo}ms ago)${
            frames.length ? `\n      ${frames.join('\n      ')}` : ''
          }`;
        })
        .join('\n    ')
    : '<none recorded>';
  return [
    `flags: ${JSON.stringify(readiness)}`,
    `postLoginCompleted transitions (most recent last):\n    ${transitionLines}`,
  ].join('\n  ');
}

// Matrix login-readiness at failure time — the missing half of a cold-boot
// login-screen timeout. The DOM snapshot shows the login form rendered; this
// shows WHY (`postLoginCompleted:false` despite `clientLoggedIn:true`) and
// which caller reset it. Prefers a live read when the owner is still around
// (during-test rejection paths); on QUnit's post-teardown timeout path the
// owner is gone, so it falls back to the last value sampled while mounted.
function summarizeLoginReadiness(): string {
  try {
    let snapshot =
      captureLoginReadinessSnapshot() ?? lastLoginReadinessSnapshot;
    if (!snapshot) {
      return 'matrix login readiness: <unavailable>';
    }
    return `matrix login readiness:\n  ${snapshot}`;
  } catch (error) {
    return `matrix login readiness: <unavailable: ${formatErrorForLog(error)}>`;
  }
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
    let live = root ? root.innerHTML.replace(/\s+/g, ' ').trim() : '';
    // At QUnit.testDone the app is already torn down, so the live container is
    // empty; fall back to the last substantial DOM the sampler captured while
    // the test was still mounted (i.e. ~during the hang).
    let useSampled =
      live.length <= 60 && lastMountedDomSnapshot.length > live.length;
    let html = useSampled ? lastMountedDomSnapshot : live;
    let source = useSampled ? 'last sampled while mounted' : 'live';
    const LIMIT = 4000;
    let body =
      html.length > LIMIT
        ? `${html.slice(0, LIMIT)}… (+${html.length - LIMIT} more chars)`
        : html;
    return `dom snapshot (#ember-testing, ${source}, ${html.length} chars):\n  ${body}`;
  } catch (error) {
    return `dom snapshot: <unavailable: ${formatErrorForLog(error)}>`;
  }
}

// A silent QUnit timeout (e.g. a `waitFor`/`settled` that never resolves)
// usually shows no in-flight fetches — the awaited `settled()` is blocked on
// something other than the network. Snapshot Ember's settledness metrics and,
// when a test waiter is the culprit, name it (with any captured begin-async
// origin) so the next timeout points at the stuck gate instead of being opaque.
// `realm.canWrite(url)` drives whether the card editor renders its fields
// editable; it reads the realm session JWT claims, which populate
// asynchronously once the realm token is minted. A silent timeout — or a
// `fillIn`-on-disabled failure with everything settled — is consistent with
// the editor having rendered before the session resolved, so report each realm
// resource's auth/permission state at failure time. Read-only, and only looked
// up on failure, so it never instantiates the service for tests that don't use
// it. Note: on QUnit's post-teardown timeout path the owner is already gone,
// so this reports `<no active test owner>` there; the during-test uncaught /
// unhandled-rejection paths still capture it.
function summarizeRealmAuth(): string {
  try {
    let owner = (
      getContext() as { owner?: { lookup(name: string): unknown } } | undefined
    )?.owner;
    if (!owner) {
      return 'realm auth: <no active test owner>';
    }
    let realmService = owner.lookup('service:realm') as
      | {
          realms?: ReadonlyMap<
            string,
            {
              url: string;
              isLoggedIn: boolean;
              canRead: boolean;
              canWrite: boolean;
            }
          >;
        }
      | undefined;
    let realms = realmService?.realms;
    if (!realms) {
      return 'realm auth: <no realm service>';
    }
    let lines: string[] = [];
    for (let resource of realms.values()) {
      lines.push(
        `${resource.url} loggedIn=${resource.isLoggedIn} canRead=${resource.canRead} canWrite=${resource.canWrite}`,
      );
    }
    return lines.length
      ? `realm auth:\n  ${lines.join('\n  ')}`
      : 'realm auth: <no realm resources>';
  } catch (error) {
    return `realm auth: <unavailable: ${formatErrorForLog(error)}>`;
  }
}

// `hasPendingTimers=true` alone can't say WHICH `later`/`debounce` is keeping
// `settled()` from resolving — and a continuously re-armed debounce blocks a
// test forever with no console output at all. Name each pending runloop timer
// (its target class and method) so a silent settled() hang points at the code
// that scheduled it. Reads backburner's private `_timers` flat array (stride
// 6: executeAt, id, target, method, args, stack — see backburner.js); fully
// defensive since the layout is an implementation detail.
function summarizePendingRunloopTimers(): string {
  try {
    let bb = _backburner as unknown as {
      _timers?: unknown[];
      _autorun?: unknown;
    };
    let timers = bb._timers ?? [];
    if (timers.length === 0) {
      return `pending runloop timers: <none>${bb._autorun ? ' (autorun pending)' : ''}`;
    }
    let now = Date.now();
    let lines: string[] = [];
    const STRIDE = 6;
    const LIMIT = 10;
    for (let i = 0; i < timers.length && lines.length < LIMIT; i += STRIDE) {
      let executeAt = timers[i];
      let target = timers[i + 2];
      let method = timers[i + 3];
      let methodName =
        typeof method === 'function'
          ? method.name || '<anonymous fn>'
          : String(method);
      let targetName =
        target === null || target === undefined
          ? '<no target>'
          : ((target as object).constructor?.name ?? typeof target);
      let due =
        typeof executeAt === 'number' ? `${executeAt - now}ms` : '<unknown>';
      lines.push(`${targetName}#${methodName} (due in ${due})`);
    }
    let count = Math.floor(timers.length / STRIDE);
    let suffix = count > LIMIT ? `\n  … +${count - LIMIT} more` : '';
    return `pending runloop timers (${count}):\n  ${lines.join('\n  ')}${suffix}`;
  } catch (error) {
    return `pending runloop timers: <unavailable: ${formatErrorForLog(error)}>`;
  }
}

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
    let session = this.owner.lookup('service:session') as
      | SessionService
      | undefined;
    session?.notifySessionEnded();
    cleanupMonacoEditorModels();
    clearHtmlComponentCache();
    failOnParticipantErrors(session);
  });
}

// A SessionParticipant whose resetState()/sessionStarted() threw during this
// test was buffered by SessionService rather than thrown or floated (a
// synchronous throw is swallowed by MatrixService.start()/logout(); a floated
// rejection can be blamed on the next test). Drain the buffer here — after the
// teardown notifySessionEnded() above has run — so the failure lands
// deterministically on the test that actually caused it.
function failOnParticipantErrors(session: SessionService | undefined) {
  let errors = session?.takeParticipantErrorsForTest?.() ?? [];
  if (errors.length > 0) {
    throw errors[0];
  }
}

export function setupRenderingTest(hooks: NestedHooks) {
  emberSetupRenderingTest(hooks);
  setupWindowMock(hooks);
  seedAiAssistantClosed(hooks);
  setupFetchDebugging(hooks);
  setupUnhandledRejectionDiagnostics(hooks);
  hooks.afterEach(async function () {
    // MatrixService is the session orchestrator, not a participant, so
    // notifySessionEnded() no longer resets it. Reset it explicitly (as
    // setupApplicationTest does) so its client/room state doesn't bleed
    // across rendering tests. Reset the AI panel first — its resetState()
    // cancels an in-flight loadRoomsTask, so cancelling before
    // MatrixService.resetState() replaces the initial-sync barrier avoids a
    // task hanging on a deferred nothing re-fulfills.
    resetServiceIfPresent(this.owner, 'service:ai-assistant-panel-service');
    resetServiceIfPresent(this.owner, 'service:matrix-service');
    await settled();
    let session = this.owner.lookup('service:session') as
      | SessionService
      | undefined;
    session?.notifySessionEnded();
    cleanupMonacoEditorModels();
    clearHtmlComponentCache();
    failOnParticipantErrors(session);
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
