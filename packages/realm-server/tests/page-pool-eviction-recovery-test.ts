import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { PagePool } from '../prerender/page-pool.ts';

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
});
