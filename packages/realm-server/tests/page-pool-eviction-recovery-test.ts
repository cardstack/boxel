import { module, test } from 'qunit';
import { basename } from 'path';
import { PagePool } from '../prerender/page-pool';

// Eviction + shared-context recovery contracts (CS-11140).
//
// Pre-fix shape:
//   - `#evictLRUAffinity` used `disposeAffinity(awaitIdle: true)` so a
//     stuck `page.close()` (e.g. a Glimmer-tracking-loop render that
//     refused to release Chrome) blocked the standby-refill loop.
//   - `disposeAffinity` left the shared-context entry intact (with
//     `closing` unset) while awaiting the per-entry close loop.
//     A concurrent caller arriving in that window adopted a fresh
//     standby — and `#recordSharedContextForFirstPage` fired
//     `Shared-context invariant violated` because the affinity's
//     map entry still pointed to the in-flight-closing context.
//
// Post-fix contracts:
//   1. `disposeAffinity(awaitIdle: false)` returns without waiting
//      for the affinity's `BrowserContext.close()` to complete. The
//      async close work continues in the background — important for
//      CS-11140 because pre-fix the caller blocked on Chrome
//      acknowledging the close of a potentially-stuck page (a
//      Glimmer-tracking-loop render could hold it for the duration
//      of its own host-side 90s timeout, gating the standby-refill
//      loop on this server).
//   2. A concurrent `getPage` on an affinity whose `disposeAffinity`
//      is mid-flight does NOT fire the `Shared-context invariant
//      violated` warning. The old shared-context row is marked
//      `closing` upfront so `#recordSharedContextForFirstPage` takes
//      the replace-cleanly branch.
//   3. Cross-affinity reuse of a supplementary tab (entry-owned,
//      not the donor affinity's primary) does NOT decrement the
//      donor's primary `pageCount` — its bookkeeping stays intact.

interface CloseControl {
  blockContextClose: boolean;
  contextCloseStarts: number;
  contextCloseCompletes: number;
}

function makeBrowserStub(control: CloseControl) {
  let browser = {
    async createBrowserContext() {
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
        async close() {
          control.contextCloseStarts++;
          while (control.blockContextClose) {
            await new Promise<void>((r) => setTimeout(r, 5));
          }
          control.contextCloseCompletes++;
        },
      };
      return context;
    },
  };
  return {
    async getBrowser() {
      return browser as any;
    },
    async cleanupUserDataDirs() {},
  };
}

module(basename(__filename), function (hooks) {
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

  test('disposeAffinity(awaitIdle: false) returns before page.close() completes', async function (assert) {
    let control: CloseControl = {
      blockContextClose: false,
      contextCloseStarts: 0,
      contextCloseCompletes: 0,
    };
    let browserManager = makeBrowserStub(control);
    let pool = makePool({ maxPages: 2, browserManager });

    // Warm affinity 'A' with a tab.
    let aHeld = await pool.getPage('A');
    aHeld.release();

    // Block context-close so we can observe whether disposeAffinity
    // is gated on it.
    control.blockContextClose = true;
    let preStarts = control.contextCloseStarts;
    let preCompletes = control.contextCloseCompletes;

    let started = Date.now();
    await pool.disposeAffinity('A', { awaitIdle: false });
    let elapsed = Date.now() - started;

    // `disposeAffinity(awaitIdle: false)` returns without waiting
    // for the affinity's `BrowserContext.close()` to complete. The
    // background close work continues asynchronously.
    assert.true(
      elapsed < 100,
      `disposeAffinity returned in ${elapsed}ms despite blocked context.close`,
    );

    // Yield once so the scheduled background close microtask runs.
    await new Promise<void>((r) => setTimeout(r, 20));
    assert.true(
      control.contextCloseStarts > preStarts,
      'background context.close was started after a microtask yield',
    );
    assert.strictEqual(
      control.contextCloseCompletes,
      preCompletes,
      'background context.close has NOT completed yet (still gated on blockContextClose)',
    );

    // Unblock and confirm the background close eventually
    // completes, and the affinity is removed from `#affinityPages`
    // once its per-entry `.finally` fires.
    control.blockContextClose = false;
    await new Promise<void>((r) => setTimeout(r, 50));
    assert.true(
      control.contextCloseCompletes > preCompletes,
      'background context.close eventually completes',
    );
    assert.deepEqual(
      pool.getWarmAffinities(),
      [],
      "affinity 'A' is gone from #affinityPages once its context.close finishes",
    );
  });

  test('concurrent getPage on a mid-disposeAffinity affinity does not fire Shared-context invariant warning', async function (assert) {
    let control: CloseControl = {
      blockContextClose: false,
      contextCloseStarts: 0,
      contextCloseCompletes: 0,
    };
    let browserManager = makeBrowserStub(control);
    let pool = makePool({ maxPages: 3, browserManager });

    // Capture all `log.error` output during the test by intercepting
    // process stderr writes — PagePool's logger writes through the
    // global console fallback when no stderr-bound logger is wired.
    let originalStderrWrite = process.stderr.write.bind(process.stderr);
    let stderrBuffer: string[] = [];
    (process.stderr.write as any) = (chunk: any, ...rest: any[]) => {
      let text = typeof chunk === 'string' ? chunk : chunk.toString();
      stderrBuffer.push(text);
      return originalStderrWrite(chunk, ...rest);
    };

    try {
      // Warm 'A' with a tab.
      let aHeld = await pool.getPage('A');
      aHeld.release();

      // Block context-close so disposeAffinity's await spans long
      // enough for a concurrent getPage('A') to race in.
      control.blockContextClose = true;

      // Start disposing A (awaitIdle:true so the close path is the
      // one that historically held the race window open).
      let disposePromise = pool.disposeAffinity('A', { awaitIdle: true });

      // Yield to let disposeAffinity reach the await on context.close.
      // After this microtask, #affinityPages.delete has run,
      // #sharedContexts.get('A').closing === true, and the in-flight
      // close is awaiting (gated by our blockContextClose flag).
      await new Promise<void>((r) => setTimeout(r, 5));

      // Concurrent caller: arrives for the same affinity. Under the
      // pre-CS-11140 shape, this would have:
      //   - found no entry in #affinityPages (deleted by disposeAffinity)
      //   - tried tryClaimOrphan — failed (pageCount still > 0)
      //   - commandeered a fresh standby with a new BrowserContext
      //   - called #recordSharedContextForFirstPage(newCtx, 'A')
      //   - existing.closing === FALSE (still false pre-fix)
      //   - existing.context !== newCtx
      //   - log.error("Shared-context invariant violated ...")
      let concurrent = await pool.getPage('A');
      concurrent.release();

      // Unblock the original disposeAffinity so the test can wind
      // down cleanly.
      control.blockContextClose = false;
      await disposePromise;

      let invariantWarnings = stderrBuffer
        .join('')
        .split('\n')
        .filter((line) => line.includes('Shared-context invariant violated'));
      assert.strictEqual(
        invariantWarnings.length,
        0,
        `no Shared-context invariant warnings expected, got ${invariantWarnings.length}: ${invariantWarnings.join(' | ')}`,
      );
    } finally {
      (process.stderr.write as any) = originalStderrWrite;
    }
  });

  test("cross-affinity reuse of a supplementary tab does not corrupt the donor affinity's primary bookkeeping", async function (assert) {
    // CS-11140 added a guard in `#assignStandbyToAffinity` so a
    // second concurrent tab on an active affinity stays entry-owned
    // rather than overwriting the primary's `pageCount`. The
    // follow-up risk Codex flagged: if that supplementary entry is
    // later commandeered by another affinity via
    // `#reassignAffinityTab`, the old `#transferSharedContextBookkeeping`
    // would still decrement the donor affinity's primary `pageCount` —
    // even though the moving entry's context was NOT the primary.
    // That would wrongly evict the primary's bookkeeping while
    // sibling tabs are still using it. Fix: pass the entry's context
    // to `#transferSharedContextBookkeeping` and skip the decrement
    // when contexts don't match.
    let control: CloseControl = {
      blockContextClose: false,
      contextCloseStarts: 0,
      contextCloseCompletes: 0,
    };
    let browserManager = makeBrowserStub(control);
    // Small pool of 2 with `disableStandbyRefill: true` so the second
    // tab adoption drains standbys without triggering background
    // refill — leaving the subsequent getPage('B') to take the cross-
    // affinity-steal branch (no standbys left to commandeer).
    // `warmStandbys()` still seeds the initial 2 standbys because
    // `disableStandbyRefill` only kicks in once `activeTabs > 0`.
    let pool = makePool({
      maxPages: 2,
      browserManager,
      disableStandbyRefill: true,
    });
    await pool.warmStandbys();

    // 1. First call on affinity A — adopts a standby. The standby's
    //    BrowserContext gets registered as A's primary in
    //    `#sharedContexts`.
    let aFirst = await pool.getPage('A');

    // 2. Concurrent second call on A — adopts the remaining standby.
    //    With CS-11140's guard the standby's context is NOT
    //    registered as A's primary (it stays supplementary).
    let aSecond = await pool.getPage('A');

    let aPrimaryBefore = pool
      .getSharedContextSnapshot()
      .entries.find((s) => s.affinityKey === 'A');
    assert.ok(aPrimaryBefore, 'A has a primary shared-context row');
    assert.strictEqual(
      aPrimaryBefore?.pageCount,
      1,
      "A's primary pageCount is 1 (the supplementary tab does not contribute)",
    );

    // 3. Release the supplementary tab so it becomes an idle cross-
    //    affinity-stealable candidate.
    aSecond.release();

    // 4. Brand-new affinity B requests a tab. No standbys left; the
    //    cross-affinity scan in `#commandeerDormantTab` finds
    //    `aSecond` idle on A and reassigns it. That triggers
    //    `#reassignAffinityTab` →
    //    `#transferSharedContextBookkeeping('A', supplementary_ctx)`.
    //
    //    Pre-fix: that call unconditionally decremented A's primary
    //    `pageCount` to 0 and deleted A's `#sharedContexts` row,
    //    silently losing A's bookkeeping while `aFirst` was still
    //    using the primary context. Post-fix: the helper compares
    //    `entryContext` against the primary and skips the decrement
    //    when they don't match.
    let bLease = await pool.getPage('B');

    let aPrimaryAfter = pool
      .getSharedContextSnapshot()
      .entries.find((s) => s.affinityKey === 'A');
    assert.ok(
      aPrimaryAfter,
      "A's primary shared-context row is still present after cross-affinity steal of its supplementary tab",
    );
    assert.strictEqual(
      aPrimaryAfter?.pageCount,
      1,
      "A's primary pageCount is unchanged (still 1, owned by aFirst)",
    );

    bLease.release();
    aFirst.release();
  });
});
