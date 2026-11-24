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
  onContextCreated?: () => void;
  onContextClosed?: () => void;
  // Stands in for the `#standby-ready` wait. A promise that never settles
  // makes the creation run into the pool's standby timeout.
  ready?: () => Promise<boolean>;
}

function makeBrowserStub(opts: BrowserStubOptions) {
  let browser = {
    async createBrowserContext() {
      await opts.gate();
      opts.onContextCreated?.();
      let context: any;
      context = {
        async newPage() {
          return {
            async goto() {},
            async waitForFunction() {
              return opts.ready ? await opts.ready() : true;
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
          opts.onContextClosed?.();
        },
      };
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
    // Lets the oldest parked creation through and keeps the gate shut for
    // the rest.
    releaseOne() {
      waiters.shift()?.();
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
  // The dynamic-pool env vars override `maxPages`, and CI and a dev shell
  // set them, so each test starts from the fixed-size pool it asks for.
  let poolEnvKeys = [
    'PRERENDER_PAGE_POOL_MIN',
    'PRERENDER_PAGE_POOL_MAX',
    'PRERENDER_PAGE_POOL_INITIAL',
  ];
  let savedPoolEnv: Record<string, string | undefined> = {};

  hooks.beforeEach(() => {
    for (let key of poolEnvKeys) {
      savedPoolEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  hooks.afterEach(async () => {
    for (let key of poolEnvKeys) {
      if (savedPoolEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedPoolEnv[key];
      }
    }
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
  }): PagePool {
    let pool = new PagePool({
      maxPages: opts.maxPages,
      serverURL: 'http://localhost',
      browserManager: opts.browserManager,
      boxelHostURL: 'http://localhost:4200',
      standbyTimeoutMs: 500,
      disableFileAdmission: true,
      disableStandbyRefill: opts.disableStandbyRefill ?? false,
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

  // `closeAll` awaiting the in-flight refill is a contract rather than
  // teardown hygiene, because a caller can be closing the pool in order to
  // replace the browser under it: the prerender server's host-shell recycle
  // does exactly that, on a boot where the initial warm is usually still
  // running. If `closeAll` returned first, the browser would be replaced while
  // a standby was still being created, and that standby would land in the live
  // standby set holding a page on a browser that no longer exists — a tab a
  // later `getPage` can commandeer.
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

  test('closeAll waits for an in-flight standby refill and closes what it created', async function (assert) {
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

    let closeAllSettled = false;
    let closeAll = pool.closeAll().then(() => {
      closeAllSettled = true;
    });
    // Everything else `closeAll` does resolves within a few turns of the
    // event loop against an empty pool, so still-pending here isolates the
    // await being asserted.
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.false(
      closeAllSettled,
      'closeAll is still pending while a standby is mid-creation',
    );

    gate.unblockAll();
    await closeAll;
    await refill;

    assert.true(created > 0, 'the refill created at least one context');
    assert.strictEqual(
      closed,
      created,
      'every context the refill created was closed by closeAll',
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

  // A failed creation hands its slot back: the context it opened is closed,
  // the in-flight count it took is returned, and the retry that follows has
  // the whole budget to work with. The prerender server hits this whenever
  // Chrome is too slow to boot a standby inside the standby timeout.
  test('a standby creation that times out leaves the context budget balanced', async function (assert) {
    let readyCalls = 0;
    let created = 0;
    let closed = 0;
    let browserManager = makeBrowserStub({
      gate: () => Promise.resolve(),
      onContextCreated: () => created++,
      onContextClosed: () => closed++,
      // The first standby never boots, so its creation times out.
      ready: () =>
        readyCalls++ === 0
          ? new Promise<boolean>(() => {})
          : Promise.resolve(true),
    });
    let pool = makePool({ maxPages: 2, browserManager });

    await pool.warmStandbys();

    let budget = pool.__test_contextBudget();
    assert.strictEqual(budget.creating, 0, 'no creation is counted in flight');
    assert.strictEqual(
      budget.standbys,
      2,
      'the retry after the timeout filled the standby target',
    );
    assert.strictEqual(
      budget.used,
      budget.standbys,
      'the budget counts the live standbys and nothing else',
    );
    assert.strictEqual(closed, 1, 'the timed-out creation closed its context');
    assert.strictEqual(created, 3, 'one failed creation and two that landed');

    let page = await pool.getPage('A');
    assert.false(page.reused, 'the pool still hands out a fresh tab');
    page.release();
  });

  // A browser restart closes the pool while renders keep arriving, and each
  // of them kicks the refill. `closeAll` clears the refill slot before it
  // waits, so one of those kicks starts a refill on the browser being
  // replaced while the close is still running, and that creation is still in
  // flight when the close finishes. The close used to reset the in-flight
  // count to zero under it, so the creation's own decrement then took the
  // count to -1 for the life of the process (seen in production as
  // `creating=-1` and "page pool capacity -2/13"): a spent budget read as
  // free, and callers that should have waited for a tab threw "No standby
  // page available" instead.
  test('a refill kicked during closeAll leaves the context budget balanced and adds no standby from the closed pool', async function (assert) {
    let gate = makeManualGate();
    let created = 0;
    let closed = 0;
    let browserManager = makeBrowserStub({
      gate: gate.gate,
      onContextCreated: () => created++,
      onContextClosed: () => closed++,
    });
    let pool = makePool({ maxPages: 2, browserManager });

    gate.block();
    let firstRefill = pool.warmStandbys();
    await waitUntil(
      () => gate.waiterCount() === 1,
      'the first refill to park mid-creation',
    );

    let closing = pool.closeAll();
    // Kicked after the close began, the way a render arriving mid-restart
    // kicks it from `getPage`.
    let lateRefill = pool.warmStandbys();
    await waitUntil(
      () => gate.waiterCount() === 2,
      'the refill kicked during the close to park mid-creation',
    );
    assert.strictEqual(
      pool.__test_contextBudget().creating,
      2,
      'both creations are counted while in flight',
    );

    // The close waits out the first refill's creation and then finishes,
    // while the late refill's creation is still in flight.
    gate.releaseOne();
    await closing;
    assert.strictEqual(
      pool.__test_contextBudget().creating,
      1,
      'the creation still in flight stays counted after the close',
    );

    gate.unblockAll();
    await lateRefill;
    await firstRefill;

    let budget = pool.__test_contextBudget();
    assert.strictEqual(budget.creating, 0, 'the in-flight count is back to 0');
    assert.strictEqual(
      budget.standbys,
      0,
      'no standby created on the closed pool was added to it',
    );
    assert.strictEqual(budget.used, 0, 'the whole budget is free');
    assert.strictEqual(
      closed,
      created,
      'every context created across the close was closed',
    );

    let page = await pool.getPage('A');
    assert.ok(page.pageId, 'the pool creates a tab again after the close');
    let after = pool.__test_contextBudget();
    assert.true(after.used >= 1, 'the budget counts the new tab');
    assert.true(
      after.used <= after.budget,
      `the budget stays within its cap (${after.used}/${after.budget})`,
    );
    page.release();
  });
});
