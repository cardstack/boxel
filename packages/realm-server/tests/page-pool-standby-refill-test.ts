import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { PagePool } from '../prerender/page-pool.ts';

// The standby refill (`#ensureStandbyPool`) is deduplicated via the
// `#ensuringStandbys` promise so concurrent callers share one in-flight
// refill. Pre-CS-11139, `getPage` synchronously awaited this promise
// *before* selecting an entry, which meant every concurrent caller paid
// the slowest in-flight refill — including callers that would have
// landed on a warm reused tab and never needed a standby.
//
// These tests pin down the post-fix contract:
//
//   1. A `getPage` caller that finds a warm idle tab on its affinity
//      returns immediately and reports `tabStartupMs === 0`, even when
//      a background standby refill is still hung.
//   2. A `getPage` caller that has no warm tab and no commandeer-able
//      standby still waits — and that wait shows up in `tabStartupMs`
//      (rather than leaking into all callers).
//   3. The pre-acquire `void this.#ensureStandbyPool()` kick still
//      runs — the pool stays warmed for the next caller — but its
//      completion is not part of any caller's `launchMs`.

interface BrowserStubOptions {
  // Gate that every `browser.createBrowserContext` call awaits. Tests
  // toggle this to make standby refill arbitrarily slow.
  gate: () => Promise<void>;
  // Gate that every `context.newPage` call awaits, after the context exists.
  newPageGate?: () => Promise<void>;
  onContextCreated?: (context: unknown) => void;
  onContextClosed?: (context: unknown) => void;
}

function makeBrowserStub(opts: BrowserStubOptions) {
  let browser = {
    async createBrowserContext() {
      await opts.gate();
      let context: any;
      context = {
        async newPage() {
          await opts.newPageGate?.();
          return {
            async goto() {},
            async waitForFunction() {
              return true;
            },
            async evaluate(fn: any, ...args: any[]) {
              return fn(...args);
            },
            async close() {},
            browserContext() {
              return context;
            },
            removeAllListeners() {},
            on() {},
          };
        },
        async close() {
          opts.onContextClosed?.(context);
        },
      };
      opts.onContextCreated?.(context);
      return context;
    },
  };
  let browserManager = {
    async getBrowser() {
      return browser as any;
    },
    async cleanupUserDataDirs() {},
  };
  return browserManager;
}

function makeManualGate() {
  let waiters: Array<() => void> = [];
  let blocked = false;
  return {
    gate: () => {
      if (!blocked) return Promise.resolve();
      return new Promise<void>((resolve) => {
        waiters.push(resolve);
      });
    },
    block() {
      blocked = true;
    },
    unblockAll() {
      blocked = false;
      let toFire = waiters.splice(0);
      for (let resolve of toFire) resolve();
    },
    waiterCount() {
      return waiters.length;
    },
  };
}

// Poll for a condition instead of sleeping a guessed interval, so a test that
// needs the pool to reach a state waits exactly as long as that takes.
async function waitUntil(
  predicate: () => boolean,
  description: string,
  timeoutMs = 2000,
): Promise<void> {
  let deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${description}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

module(basename(import.meta.filename), function (hooks) {
  let pools: PagePool[] = [];

  hooks.afterEach(async () => {
    for (let pool of pools.splice(0)) {
      try {
        await pool.closeAll();
      } catch {
        // best-effort
      }
    }
  });

  function makePool(opts: {
    maxPages: number;
    browserManager: any;
    disableStandbyRefill?: boolean;
    standbyCreationTimeoutMs?: number;
    standbyRefillWaitMs?: number;
  }): PagePool {
    let pool = new PagePool({
      maxPages: opts.maxPages,
      serverURL: 'http://localhost',
      browserManager: opts.browserManager,
      boxelHostURL: 'http://localhost:4200',
      standbyTimeoutMs: 500,
      disableFileAdmission: true,
      disableStandbyRefill: opts.disableStandbyRefill ?? false,
      standbyCreationTimeoutMs: opts.standbyCreationTimeoutMs,
      standbyRefillWaitMs: opts.standbyRefillWaitMs,
    });
    pools.push(pool);
    return pool;
  }

  test('reused-tab caller is not blocked by an in-flight slow standby refill', async function (assert) {
    let gate = makeManualGate();
    let browserManager = makeBrowserStub({ gate: gate.gate });
    let pool = makePool({ maxPages: 2, browserManager });

    // First getPage: spawns the initial standby (fast — gate is open).
    let first = await pool.getPage('A');
    first.release();

    // Now block all subsequent context creations. The fire-and-forget
    // refill that fires when we re-enter `getPage` will hang on this
    // gate. Under the pre-CS-11139 shape, the next `getPage` caller
    // would await `#ensureStandbyPool` and pay the full hang time;
    // under the new shape, a warm-tab caller skips the await entirely.
    gate.block();

    let second = await pool.getPage('A');

    // `tabStartupMs === 0` is the deterministic contract proof: the
    // caller never reached the path that awaits `#ensureStandbyPool`.
    // Wall-clock assertions would be timing-flaky under slow CI.
    assert.true(
      second.reused,
      'second getPage on the same affinity finds the warm tab (reused === true)',
    );
    assert.strictEqual(
      second.waits.tabStartupMs,
      0,
      'tabStartupMs is 0 because the caller never awaited #ensureStandbyPool',
    );

    second.release();
    gate.unblockAll();
  });

  test('caller that needs a fresh standby (no warm tab) still blocks and reports tabStartupMs', async function (assert) {
    let gate = makeManualGate();
    let browserManager = makeBrowserStub({ gate: gate.gate });
    let pool = makePool({ maxPages: 2, browserManager });

    // Block creations immediately. The very first getPage has no warm
    // tab and no commandeer-able standby; it must hit the awaited-
    // refill last-resort path in `#selectEntryForAffinity`. We unblock
    // after a short delay so the test doesn't hang — and assert that
    // the unblock actually fired before getPage resolved, proving
    // the caller was genuinely awaiting the refill (not just spinning
    // through fast paths).
    gate.block();
    let unblockFired = false;
    setTimeout(() => {
      unblockFired = true;
      gate.unblockAll();
    }, 60);

    let result = await pool.getPage('A');

    assert.true(
      unblockFired,
      'unblock timer fired before getPage resolved — getPage was genuinely awaiting the standby refill',
    );
    assert.false(
      result.reused,
      'no warm tab existed; caller got a freshly commandeered standby',
    );
    assert.true(
      result.waits.tabStartupMs >= 50,
      `tabStartupMs reflects actual standby wait (was ${result.waits.tabStartupMs}ms, expected >=50)`,
    );

    result.release();
  });

  // The refill takes one generation snapshot and threads it downstream. It has
  // to, because it yields between taking it and reaching the retry loop: a
  // close landing in that window has already bumped the counter, so a second
  // read there would compare the new value against itself, see no change, and
  // work through every attempt — leaving the close waiting for exactly the
  // retries it cancelled.
  test('a close during standby preparation still cancels the retries', async function (assert) {
    let attempts = 0;
    let browserManager = makeBrowserStub({
      gate: async () => {
        attempts++;
        throw new Error('standby creation failed');
      },
    });
    let pool = makePool({ maxPages: 2, browserManager });

    // Not awaited: the refill runs to its first await — inside
    // `#prepareSlotForStandby`, before any context is created — and the close
    // below lands in that window.
    let refill = pool.warmStandbys();
    await pool.closeAll();
    await refill;

    assert.strictEqual(
      attempts,
      0,
      'the refill gave up without attempting a creation the close had already ruled out',
    );
  });

  // The other side of that contract: waiting for the refill must not mean
  // waiting out its retries. A refill whose attempts keep failing runs
  // `STANDBY_CREATION_RETRIES` of them, each bounded only by the standby
  // navigation timeout, with backoff in between — so a caller that closes the
  // pool in order to shut down (`Prerenderer.stop`, and the prerender server's
  // teardown behind it) would sit behind attempts it has already decided it
  // doesn't want, long enough to overrun its own shutdown budget and leave the
  // process alive with its ports still bound.
  test('closeAll ends a failing refill rather than waiting out its retries', async function (assert) {
    let attempts = 0;
    let browserManager = makeBrowserStub({
      gate: async () => {
        attempts++;
        throw new Error('standby creation failed');
      },
    });
    let pool = makePool({ maxPages: 2, browserManager });

    let refill = pool.warmStandbys();
    await waitUntil(
      () => attempts >= 1,
      'the first standby creation attempt to fail',
    );

    // Called during the backoff that follows the failed attempt. Attempt count
    // rather than elapsed time is the assertion: it distinguishes "the close
    // ended the retries" from "the close outlasted them" without depending on
    // how long a retry takes.
    await pool.closeAll();
    await refill;

    assert.strictEqual(
      attempts,
      1,
      'no further creation attempt was made once closeAll began',
    );
  });

  // A caller can close the pool in order to replace the browser under it: the
  // prerender server's host-shell recycle does that on a boot where the
  // initial warm is usually still running, and the restart of a browser that
  // stopped answering does it while a creation is stuck on that browser. A
  // standby whose creation finished after the close would land in the live
  // standby set holding a page on a browser that no longer exists, and its
  // `#creatingStandbys` decrement would go below the zero `closeAll` resets.
  // Waiting for the creation to end avoids both, but on a browser that stopped
  // answering it holds the restart for the full creation deadline. So
  // `closeAll` abandons the creation: the count is released before the reset,
  // and whatever the creation makes later is closed.
  test('closeAll abandons an in-flight standby creation, and closes what it makes later', async function (assert) {
    let gate = makeManualGate();
    let created = 0;
    let closed = 0;
    let browserManager = makeBrowserStub({
      gate: gate.gate,
      onContextCreated: () => created++,
      onContextClosed: () => closed++,
    });
    let pool = makePool({ maxPages: 2, browserManager });

    // Park the refill inside `createBrowserContext`, so it is provably
    // mid-creation — not merely scheduled — when `closeAll` runs.
    gate.block();
    let refill = pool.warmStandbys();
    await waitUntil(
      () => gate.waiterCount() > 0,
      'the standby refill to park on the gate',
    );
    assert.strictEqual(created, 0, 'no context exists yet');

    // The creation is still parked on its browser call, as it is on a
    // browser that has stopped answering, the usual reason to close the pool.
    // closeAll must not wait for it.
    await pool.closeAll();
    await refill;
    assert.strictEqual(
      gate.waiterCount(),
      1,
      'closeAll settled while the creation was still waiting on its browser call',
    );

    // The browser call answers after the close. The creation finishes, and
    // what it made is closed instead of joining the closed pool's standbys.
    gate.unblockAll();
    await waitUntil(
      () => created > 0 && closed === created,
      'the late standby context to be closed',
    );
    assert.strictEqual(
      closed,
      created,
      'every context the abandoned creation made was closed',
    );
  });

  test('a stalled refill on affinity A does not block a concurrent reused-tab caller on affinity B', async function (assert) {
    let gate = makeManualGate();
    let browserManager = makeBrowserStub({ gate: gate.gate });
    let pool = makePool({ maxPages: 4, browserManager });

    // Warm both affinities with their own tabs (gate is open).
    let warmA = await pool.getPage('A');
    warmA.release();
    let warmB = await pool.getPage('B');
    warmB.release();

    // Block all subsequent context creations. Both affinities have
    // warm tabs in `#affinityPages`; either caller hitting their
    // warm-tab fast path inside `#selectEntryForAffinity` should
    // return without awaiting the (hung) `#ensureStandbyPool`.
    gate.block();

    let [resA, resB] = await Promise.all([
      pool.getPage('A'),
      pool.getPage('B'),
    ]);

    // `tabStartupMs === 0` on both callers is the deterministic
    // proof that neither awaited `#ensureStandbyPool`. Pre-fix, a
    // single shared `#ensuringStandbys` promise would have leaked
    // its hang into both callers and produced non-zero values here.
    assert.true(resA.reused, 'A: reused warm tab');
    assert.true(resB.reused, 'B: reused warm tab');
    assert.strictEqual(resA.waits.tabStartupMs, 0, 'A: tabStartupMs === 0');
    assert.strictEqual(resB.waits.tabStartupMs, 0, 'B: tabStartupMs === 0');

    resA.release();
    resB.release();
    gate.unblockAll();
  });

  // The file-admission cap reserves a slot per-affinity for module / command
  // work, but only as a *cap* on file callers — it doesn't itself produce
  // the reserved tab. `#selectEntryForAffinity` for a non-file caller used
  // to fall through to `#selectLeastPendingTab` when both the orphan-claim
  // and the standby-commandeer paths missed, queueing the caller behind
  // the busy file render that was waiting on it: the self-referential
  // prerender deadlock. The fix unconditionally awaits `#ensureStandbyPool`
  // and retries commandeer for module / command callers under the
  // per-affinity cap, regardless of priority.
  test('module call on an existing affinity with all owned tabs busy materializes a fresh tab', async function (assert) {
    let gate = makeManualGate();
    let browserManager = makeBrowserStub({ gate: gate.gate });
    let pool = makePool({ maxPages: 2, browserManager });

    // File render acquires the only tab on affinity A and holds it.
    let held = await pool.getPage('A', 'file');
    assert.ok(held.pageId, 'first getPage on A returned a page');

    // A module sub-render arrives for the same affinity while A1 is busy.
    // Pre-fix: this would queue behind A1 on its per-tab queue (the
    // deadlock state). Post-fix: a fresh tab is materialized.
    let modCall = pool.getPage('A', 'module');

    // Race the module call against the held tab — if the test ever hangs
    // waiting on `modCall`, that's the deadlock regression returning.
    // Bound with a 2s timeout so a regression fails the test cleanly.
    let timeoutFired = false;
    let timeoutHandle: NodeJS.Timeout | undefined;
    let timer = new Promise<'timeout'>((resolve) => {
      timeoutHandle = setTimeout(() => {
        timeoutFired = true;
        resolve('timeout');
      }, 2000);
    });
    let winner = await Promise.race([
      modCall.then((r) => ({ kind: 'mod' as const, result: r })),
      timer,
    ]);
    if (timeoutHandle) clearTimeout(timeoutHandle);

    assert.false(
      timeoutFired,
      'module call did not block on the held file-render tab (no deadlock)',
    );
    if (winner !== 'timeout') {
      assert.strictEqual(
        winner.kind,
        'mod',
        'module call resolved without waiting on the file render',
      );
      // The module render must land on a different tab than the held one
      // (which is still in use by the file render).
      assert.notStrictEqual(
        winner.result.pageId,
        held.pageId,
        'module call got its own tab, distinct from the held file-render tab',
      );
      winner.result.release();
    }
    held.release();
    gate.unblockAll();
  });

  // Without a deadline, a CDP call inside a standby creation that never
  // answers holds the refill open for the life of the process:
  // `#creatingStandbys` stays at one, the refill never reports a failure,
  // and a caller with no tab parks until its own abort. Every render on the
  // server then fails by timeout while the server keeps reporting itself
  // healthy. The creation deadline
  // turns that hang into a refill failure, which the caller answers by
  // throwing, and a throw from a render makes the Prerenderer restart the
  // browser.
  test('a standby creation that never finishes fails the refill, and a caller with no tab throws instead of waiting for its abort', async function (assert) {
    let gate = makeManualGate();
    let browserManager = makeBrowserStub({ gate: gate.gate });
    let pool = makePool({
      maxPages: 1,
      browserManager,
      standbyCreationTimeoutMs: 100,
      standbyRefillWaitMs: 50,
    });
    gate.block();

    let abortAfterMs = 5000;
    let controller = new AbortController();
    let abortTimer = setTimeout(() => controller.abort(), abortAfterMs);
    let start = Date.now();
    try {
      await pool.getPage('A', 'file', { signal: controller.signal });
      assert.ok(false, 'getPage should not get a tab while creation hangs');
    } catch (e) {
      let elapsed = Date.now() - start;
      assert.false(
        controller.signal.aborted,
        `getPage failed before its own abort (after ${elapsed}ms)`,
      );
      assert.true(
        /No standby page available for prerender/.test(String(e)),
        `getPage threw the no-tab error that restarts the browser (got: ${String(e)})`,
      );
    } finally {
      clearTimeout(abortTimer);
      gate.unblockAll();
    }
  });

  // Puppeteer's `context.newPage()` waits, with no timeout, for Chrome to
  // report a URL for the new page target. When Chrome never does, the context
  // exists and the page never arrives. That hang is one step later than the
  // context creation the test above holds.
  test('a standby creation stuck in newPage fails the refill, and a caller with no tab throws instead of waiting for its abort', async function (assert) {
    let contextGate = makeManualGate();
    let pageGate = makeManualGate();
    let created = 0;
    let browserManager = makeBrowserStub({
      gate: contextGate.gate,
      newPageGate: pageGate.gate,
      onContextCreated: () => created++,
    });
    let pool = makePool({
      maxPages: 1,
      browserManager,
      standbyCreationTimeoutMs: 100,
      standbyRefillWaitMs: 50,
    });
    pageGate.block();

    let controller = new AbortController();
    let abortTimer = setTimeout(() => controller.abort(), 5000);
    let start = Date.now();
    try {
      await pool.getPage('A', 'file', { signal: controller.signal });
      assert.ok(false, 'getPage should not get a tab while newPage hangs');
    } catch (e) {
      let elapsed = Date.now() - start;
      assert.true(created > 0, 'the context was created before newPage hung');
      assert.true(
        pageGate.waiterCount() > 0,
        'a creation is still waiting in newPage',
      );
      assert.false(
        controller.signal.aborted,
        `getPage failed before its own abort (after ${elapsed}ms)`,
      );
      assert.true(
        /No standby page available for prerender/.test(String(e)),
        `getPage threw the no-tab error that restarts the browser (got: ${String(e)})`,
      );
    } finally {
      clearTimeout(abortTimer);
      pageGate.unblockAll();
    }
  });

  test('a standby creation that finishes after its deadline is closed and never joins the pool', async function (assert) {
    let gate = makeManualGate();
    let contexts: unknown[] = [];
    let closedContexts = new Set<unknown>();
    let browserManager = makeBrowserStub({
      gate: gate.gate,
      onContextCreated: (context) => contexts.push(context),
      onContextClosed: (context) => closedContexts.add(context),
    });
    let pool = makePool({
      maxPages: 1,
      browserManager,
      standbyCreationTimeoutMs: 100,
    });
    gate.block();

    // The refill settles once its creation passes the deadline, though the
    // browser call it made is still unanswered.
    await pool.warmStandbys();
    assert.strictEqual(
      gate.waiterCount(),
      1,
      'the abandoned creation is still waiting on its browser call',
    );

    // The browser answers late. The creation finishes, and what it made is
    // closed instead of joining the pool.
    gate.unblockAll();
    await waitUntil(
      () => contexts.length > 0 && closedContexts.has(contexts[0]),
      'the late standby context to be closed',
    );
    let abandoned = contexts[0];

    // The pool still makes tabs once the browser answers. The refill may make
    // a spare standby beside the one getPage takes, so the test identifies
    // the tab by its context rather than by counting creations.
    let result = await pool.getPage('A');
    let context = result.page.browserContext();
    assert.notStrictEqual(
      context,
      abandoned,
      'getPage got a tab from a new creation, not from the abandoned one',
    );
    assert.false(closedContexts.has(context), 'the new tab is still open');
    result.release();
  });
});
