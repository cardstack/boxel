import { module, test } from 'qunit';
import { basename } from 'path';
import { PagePool } from '../prerender/page-pool';
import { toAffinityKey } from '../prerender/affinity';

// CS-10817: PagePool shares a BrowserContext per affinity so Chrome's
// HTTP cache + localStorage survive individual page churn. These tests
// exercise the context lifecycle directly against a mock Browser/Page
// harness so we can verify the shared-identity + retention invariants
// without needing a real Puppeteer/Chrome runtime.

type MockContextEvents = {
  onContextCreated?: (id: string) => void;
  onContextClosed?: (id: string) => void;
  onPageCreated?: (pageId: string, contextId: string) => void;
  onPageClosed?: (pageId: string, contextId: string) => void;
};

function makeMockBrowserManager(events: MockContextEvents = {}) {
  let contextCounter = 0;
  let pageCounter = 0;
  let openContextIds: string[] = [];
  let openPageIds: Array<{ pageId: string; contextId: string }> = [];
  let closedContextIds: string[] = [];
  let closedPageIds: Array<{ pageId: string; contextId: string }> = [];

  let browser = {
    async createBrowserContext() {
      let counter = ++contextCounter;
      let id = `ctx-${counter}`;
      openContextIds.push(id);
      events.onContextCreated?.(id);
      let localStore: Record<string, string> = {};
      let context: any;
      let pagesInContext = new Set<any>();
      context = {
        id,
        async newPage() {
          let pageCounter2 = ++pageCounter;
          let pageId = `page-${pageCounter2}`;
          let page: any = {
            id: pageId,
            async goto(_url: string, _opts?: any) {
              return;
            },
            async waitForFunction(_fn: any) {
              return true;
            },
            async evaluate(fn: (...args: any[]) => any, ...args: any[]) {
              let originalLocalStorage = (globalThis as any).localStorage;
              (globalThis as any).localStorage = {
                getItem: (key: string) => localStore[key] ?? null,
                setItem: (key: string, value: string) => {
                  localStore[key] = value;
                },
                removeItem: (key: string) => {
                  delete localStore[key];
                },
                clear: () => {
                  localStore = {};
                },
                key: (i: number) => Object.keys(localStore)[i] ?? null,
                length: Object.keys(localStore).length,
              };
              try {
                return await fn(...args);
              } finally {
                (globalThis as any).localStorage = originalLocalStorage;
              }
            },
            browserContext() {
              return context;
            },
            async close() {
              pagesInContext.delete(page);
              closedPageIds.push({ pageId, contextId: id });
              events.onPageClosed?.(pageId, id);
            },
            removeAllListeners() {
              return;
            },
            on() {
              return;
            },
          };
          pagesInContext.add(page);
          openPageIds.push({ pageId, contextId: id });
          events.onPageCreated?.(pageId, id);
          return page;
        },
        async close() {
          // Close the context closes all its pages too.
          for (let page of pagesInContext) {
            await page.close();
          }
          pagesInContext.clear();
          closedContextIds.push(id);
          events.onContextClosed?.(id);
        },
      };
      return context;
    },
  };
  return {
    browserManager: {
      async getBrowser() {
        return browser;
      },
      async cleanupUserDataDirs() {
        return;
      },
    } as any,
    state: {
      openContextIds,
      openPageIds,
      closedContextIds,
      closedPageIds,
      liveContextCount() {
        return openContextIds.length - closedContextIds.length;
      },
    },
  };
}

function makePool(opts?: {
  maxPages?: number;
  sharedContextCap?: number;
  events?: MockContextEvents;
}) {
  let { browserManager, state } = makeMockBrowserManager(opts?.events ?? {});
  let pool = new PagePool({
    maxPages: opts?.maxPages ?? 4,
    serverURL: 'http://localhost',
    browserManager,
    boxelHostURL: 'http://localhost:4200',
    standbyTimeoutMs: 100,
    disableStandbyRefill: true,
    sharedContextCap: opts?.sharedContextCap ?? 16,
  });
  return { pool, state };
}

module(basename(__filename), function () {
  module('PagePool shared BrowserContext (CS-10817)', function () {
    const REALM_A = toAffinityKey({
      affinityType: 'realm',
      affinityValue: 'http://realm.example/a/',
    });
    const REALM_B = toAffinityKey({
      affinityType: 'realm',
      affinityValue: 'http://realm.example/b/',
    });

    test('two pages for the same affinity share the same BrowserContext', async function (assert) {
      let { pool } = makePool({
        maxPages: 4,
      });
      // Warm a standby so the first getPage can adopt it.
      await pool.warmStandbys();
      let first = await pool.getPage(REALM_A);
      let firstContextId = (first.page as any).browserContext().id;

      // Warm another standby, then acquire a second page concurrently.
      // Both pages must end up in the same BrowserContext for the
      // affinity (the first adopts, the second attaches).
      await pool.warmStandbys();
      let second = await pool.getPage(REALM_A);
      let secondContextId = (second.page as any).browserContext().id;

      assert.strictEqual(
        firstContextId,
        secondContextId,
        'both pages for REALM_A share a BrowserContext',
      );
      assert.strictEqual(
        pool.getSharedContextPageCount(REALM_A),
        2,
        'shared context tracks both live pages',
      );
      first.release();
      second.release();
      await pool.closeAll();
    });

    test('pages for different affinities use different BrowserContexts', async function (assert) {
      let { pool } = makePool({ maxPages: 4 });
      await pool.warmStandbys();
      let aPage = await pool.getPage(REALM_A);
      await pool.warmStandbys();
      let bPage = await pool.getPage(REALM_B);

      let aContextId = (aPage.page as any).browserContext().id;
      let bContextId = (bPage.page as any).browserContext().id;
      assert.notStrictEqual(
        aContextId,
        bContextId,
        'different affinities map to different contexts',
      );
      aPage.release();
      bPage.release();
      await pool.closeAll();
    });

    test('cross-affinity reassignment retains the old context as an orphan', async function (assert) {
      // The real "close a page, keep the context" path is cross-affinity
      // reassignment: PagePool closes the old affinity's page, spawns a
      // fresh page in the new affinity's context, and the old context
      // survives as an orphan (pageCount === 0) for any future attach
      // or until LRU eviction. Exercising this through the public API
      // via maxPages=1 forces a reassignment when the second affinity
      // arrives.
      let { pool, state } = makePool({ maxPages: 1 });
      await pool.warmStandbys();
      let first = await pool.getPage(REALM_A);
      let aContextId = (first.page as any).browserContext().id;
      first.release();

      // No standbys (maxPages=1 is exhausted), no room in REALM_A's
      // set, so #selectEntryForAffinity will reassign REALM_A's idle
      // entry onto REALM_B.
      let second = await pool.getPage(REALM_B);
      let bContextId = (second.page as any).browserContext().id;

      assert.notStrictEqual(
        aContextId,
        bContextId,
        'REALM_B gets its own fresh context',
      );
      assert.false(
        state.closedContextIds.includes(aContextId),
        'REALM_A context is NOT closed — it survives as an orphan',
      );
      assert.strictEqual(
        pool.getSharedContextPageCount(REALM_A),
        0,
        'REALM_A context pageCount decremented to 0 on reassignment',
      );
      assert.ok(
        pool.getSharedContext(REALM_A),
        'REALM_A context still tracked by PagePool',
      );
      second.release();
      await pool.closeAll();
    });

    test('disposeAffinity closes the shared context', async function (assert) {
      let { pool, state } = makePool({ maxPages: 4 });
      await pool.warmStandbys();
      let entry = await pool.getPage(REALM_A);
      let contextId = (entry.page as any).browserContext().id;
      entry.release();

      await pool.disposeAffinity(REALM_A);

      assert.true(
        state.closedContextIds.includes(contextId),
        'context is closed on affinity disposal',
      );
      assert.strictEqual(
        pool.getSharedContextPageCount(REALM_A),
        undefined,
        'shared-context cache entry is removed',
      );
      await pool.closeAll();
    });

    test('disposeAffinity awaitIdle:false detaches the context before closing it (no mid-render close of a replacement page)', async function (assert) {
      // Regression guard for the PR-review P1 race: in the non-awaiting
      // branch of disposeAffinity, pending entry closures run in the
      // background and THEN the shared context closes. If a concurrent
      // getPage() for the same affinity were allowed to attach a new
      // page to that context during the window, the delayed close would
      // kill it mid-render. The fix detaches the context from
      // #sharedContexts synchronously; a subsequent getPage() sees the
      // cache miss and creates a fresh context.
      let { pool, state } = makePool({ maxPages: 4 });
      await pool.warmStandbys();
      let first = await pool.getPage(REALM_A);
      let firstContextId = (first.page as any).browserContext().id;
      first.release();

      // Kick off background disposal (awaitIdle: false).
      let disposalPromise = pool.disposeAffinity(REALM_A, {
        awaitIdle: false,
      });

      // Immediately acquire a new page for the same affinity. The
      // shared-context cache must already be detached, so this creates
      // a FRESH context — not one that's about to be closed.
      await pool.warmStandbys();
      let replacement = await pool.getPage(REALM_A);
      let replacementContextId = (replacement.page as any).browserContext().id;
      assert.notStrictEqual(
        replacementContextId,
        firstContextId,
        'replacement attaches to a FRESH context, not the about-to-close one',
      );

      // Let the background close settle; the old context should close,
      // the replacement context should survive.
      await disposalPromise;
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.true(
        state.closedContextIds.includes(firstContextId),
        'old context eventually closes in the background',
      );
      assert.false(
        state.closedContextIds.includes(replacementContextId),
        'replacement context still alive',
      );

      replacement.release();
      await pool.closeAll();
    });

    test('after affinity disposal, next getPage creates a FRESH BrowserContext', async function (assert) {
      // This is the auth-rotation shape: render-runner calls
      // disposeAffinity when auth changes, then getPage for the same
      // affinity. The new context must be distinct from the old one.
      let { pool } = makePool({ maxPages: 4 });
      await pool.warmStandbys();
      let first = await pool.getPage(REALM_A);
      let firstContextId = (first.page as any).browserContext().id;
      first.release();
      await pool.disposeAffinity(REALM_A);

      await pool.warmStandbys();
      let second = await pool.getPage(REALM_A);
      let secondContextId = (second.page as any).browserContext().id;

      assert.notStrictEqual(
        firstContextId,
        secondContextId,
        'post-dispose context is a fresh instance',
      );
      second.release();
      await pool.closeAll();
    });

    test('closeAll closes every shared context (including orphans)', async function (assert) {
      let { pool, state } = makePool({ maxPages: 4 });
      await pool.warmStandbys();
      let aEntry = await pool.getPage(REALM_A);
      await pool.warmStandbys();
      let bEntry = await pool.getPage(REALM_B);
      let aCtx = (aEntry.page as any).browserContext().id;
      let bCtx = (bEntry.page as any).browserContext().id;
      aEntry.release();
      bEntry.release();

      await pool.closeAll();

      assert.true(
        state.closedContextIds.includes(aCtx),
        'REALM_A context closed',
      );
      assert.true(
        state.closedContextIds.includes(bCtx),
        'REALM_B context closed',
      );
      assert.strictEqual(
        pool.getSharedContextKeys().length,
        0,
        'shared-context cache is empty after closeAll',
      );
    });

    test('orphan context LRU evicts oldest when the total count exceeds the cap', async function (assert) {
      // Exercise #maybeEvictOrphanContexts directly: cap=2, produce 3
      // orphan contexts via cross-affinity reassignment (maxPages=1 so
      // each new affinity forces the previous one to shed its page and
      // become an orphan). Oldest-lastUsedAt orphan must be evicted.
      let { pool, state } = makePool({ maxPages: 1, sharedContextCap: 2 });
      let X = toAffinityKey({
        affinityType: 'realm',
        affinityValue: 'http://realm.example/x/',
      });
      let Y = toAffinityKey({
        affinityType: 'realm',
        affinityValue: 'http://realm.example/y/',
      });
      let Z = toAffinityKey({
        affinityType: 'realm',
        affinityValue: 'http://realm.example/z/',
      });

      await pool.warmStandbys();
      let x = await pool.getPage(X);
      let xCtx = (x.page as any).browserContext().id;
      x.release();

      // Reassignment from X → Y: X becomes an orphan (pageCount 0)
      let y = await pool.getPage(Y);
      let yCtx = (y.page as any).browserContext().id;
      y.release();
      // At this point: 2 shared contexts (X orphan, Y active) — at cap.
      assert.strictEqual(pool.getSharedContextKeys().length, 2);
      assert.false(
        state.closedContextIds.includes(xCtx),
        'X survives as orphan while under cap',
      );

      // Reassignment from Y → Z: Y becomes an orphan. Now we have 3
      // shared contexts (X + Y orphans, Z active) but cap is 2 — oldest
      // orphan (X) should be LRU-evicted.
      let z = await pool.getPage(Z);
      assert.true(
        state.closedContextIds.includes(xCtx),
        'oldest orphan X evicted when total count exceeds cap',
      );
      assert.false(
        state.closedContextIds.includes(yCtx),
        'newer orphan Y retained (still within cap after X eviction)',
      );
      assert.strictEqual(
        pool.getSharedContextKeys().length,
        2,
        'total shared-context count back at cap',
      );
      z.release();
      await pool.closeAll();
    });

    test('orphan LRU eviction does not evict an active context', async function (assert) {
      // Active contexts (pageCount > 0) must never be evicted. With
      // cap=1 and two contexts (one active, one orphan), only the
      // orphan can be evicted — the active one stays put.
      let { pool, state } = makePool({ maxPages: 2, sharedContextCap: 1 });
      let A = toAffinityKey({
        affinityType: 'realm',
        affinityValue: 'http://realm.example/a/',
      });
      let B = toAffinityKey({
        affinityType: 'realm',
        affinityValue: 'http://realm.example/b/',
      });

      await pool.warmStandbys();
      let a = await pool.getPage(A);
      let aCtx = (a.page as any).browserContext().id;
      // a is NOT released → A stays active (pageCount === 1)

      // Attempt to make B's context — eviction pass must not touch A.
      await pool.warmStandbys();
      let b = await pool.getPage(B);
      let bCtx = (b.page as any).browserContext().id;
      b.release();
      // B is now orphan. A + B → size=2 > cap=1. With only B eligible,
      // B should be the one evicted... once a release cycle fires.
      // Force the cycle by making-and-releasing a dummy C.
      let C = toAffinityKey({
        affinityType: 'realm',
        affinityValue: 'http://realm.example/c/',
      });
      await pool.warmStandbys();
      let c = await pool.getPage(C);
      c.release();
      // After c.release(), maybeEvictOrphanContexts ran with A active,
      // B + C orphans. Oldest orphan (B) is evicted; C survives at the
      // cap. A is untouched.
      assert.false(
        state.closedContextIds.includes(aCtx),
        'active context A is NOT evicted even while over cap',
      );
      assert.true(
        state.closedContextIds.includes(bCtx),
        'oldest orphan B evicted',
      );
      a.release();
      await pool.closeAll();
    });
  });
});
