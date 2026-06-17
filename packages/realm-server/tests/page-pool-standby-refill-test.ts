import { module, test } from 'qunit';
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
        async close() {},
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
});
