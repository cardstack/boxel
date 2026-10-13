import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { PagePool } from '../prerender/page-pool.ts';
import {
  fromAffinityKey,
  isAffinityOfRealm,
  realmAffinityKeyOf,
  toAffinityKey,
} from '../prerender/affinity.ts';
import { buildCreatePrerenderAuth } from '../prerender/auth.ts';

// A render hands its tab its sessions through localStorage, which belongs to
// the tab's BrowserContext. A context must therefore only ever carry one
// render session: a realm affinity is split by the sessions its render
// carries, and a tab is never stolen out of a context that still has another
// tab in it.

const REALM = 'http://localhost:4202/test/';
const REALM_KEY = `realm:${REALM}`;
const USER_1 = '@user-1:localhost';
const USER_2 = '@user-2:localhost';
const OWNER = '@owner:localhost';

const createPrerenderAuth = buildCreatePrerenderAuth(
  'page-pool-session-affinity-test-seed',
  'http://localhost:4202',
);
const permissions = { [REALM]: ['read' as const] };

const realmAuthorityAuth = createPrerenderAuth(OWNER, permissions, {
  realmAuthority: true,
});
const user1Auth = createPrerenderAuth(USER_1, permissions);
const user2Auth = createPrerenderAuth(USER_2, permissions);
const anonymousAuth = '{}';

const POOL_SIZING_ENV_KEYS = [
  'PRERENDER_PAGE_POOL_MIN',
  'PRERENDER_PAGE_POOL_MAX',
  'PRERENDER_PAGE_POOL_INITIAL',
  'PRERENDER_PAGE_POOL_HIGH_PRIORITY_MAX',
];

function realmKeyFor(auth: string) {
  return toAffinityKey({ affinityType: 'realm', affinityValue: REALM, auth });
}

// Every standby gets a BrowserContext of its own, unless `sharedContexts`
// says how many of the first standbys to put in one context together.
function makeBrowserStub(opts: { sharedContexts?: number } = {}) {
  let created = 0;
  let shared: any;
  let browser = {
    async createBrowserContext() {
      created++;
      if (opts.sharedContexts && created <= opts.sharedContexts && shared) {
        return shared;
      }
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
      if (opts.sharedContexts && created <= opts.sharedContexts) {
        shared = context;
      }
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
    // A pool sized by the environment could grow to give a render a fresh
    // tab, and these tests need it to hold at `maxPages`.
    let sizing = POOL_SIZING_ENV_KEYS.map((key) => [key, process.env[key]]);
    for (let key of POOL_SIZING_ENV_KEYS) {
      delete process.env[key];
    }
    try {
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
    } finally {
      for (let [key, value] of sizing) {
        if (value !== undefined) {
          process.env[key!] = value;
        }
      }
    }
  }

  module('the affinity key of a render', function () {
    test("a realm's own render keeps the realm's key", function (assert) {
      assert.strictEqual(realmKeyFor(realmAuthorityAuth), REALM_KEY);
    });

    test('every other session gets a key of its own under the realm', function (assert) {
      let keys = [user1Auth, user2Auth, anonymousAuth, 'not json'].map(
        realmKeyFor,
      );
      assert.strictEqual(
        new Set([REALM_KEY, ...keys]).size,
        5,
        `the keys are distinct: ${keys.join(', ')}`,
      );
      for (let key of keys) {
        assert.strictEqual(
          realmAffinityKeyOf(key),
          REALM_KEY,
          `${key} belongs to the realm`,
        );
        assert.true(isAffinityOfRealm(key, REALM_KEY));
        assert.strictEqual(fromAffinityKey(key)?.affinityValue, REALM);
      }
    });

    test('a user affinity is keyed by its user alone', function (assert) {
      assert.strictEqual(
        toAffinityKey({
          affinityType: 'user',
          affinityValue: USER_1,
          auth: user1Auth,
        }),
        `user:${USER_1}`,
      );
    });

    test("another realm's affinities do not belong to the realm", function (assert) {
      let other = toAffinityKey({
        affinityType: 'realm',
        affinityValue: 'http://localhost:4202/test-2/',
        auth: user1Auth,
      });
      assert.false(isAffinityOfRealm(other, REALM_KEY));
    });
  });

  test('renders of one realm by its own indexing, two users and an anonymous reader each get a BrowserContext of their own', async function (assert) {
    let pool = makePool({ maxPages: 4, browserManager: makeBrowserStub() });
    await pool.warmStandbys();
    // Each render releases its tab before the next one asks, so renders that
    // shared an affinity would share the tab.
    let contexts = new Set();
    for (let auth of [
      realmAuthorityAuth,
      user1Auth,
      user2Auth,
      anonymousAuth,
    ]) {
      let lease = await pool.getPage(realmKeyFor(auth));
      contexts.add((lease.page as any).browserContext());
      lease.release();
    }
    assert.strictEqual(contexts.size, 4, 'four BrowserContexts');
  });

  test('a cross-affinity steal does not take a tab whose BrowserContext has another tab in it', async function (assert) {
    // Both tabs of affinity A live in one BrowserContext. With no standby
    // left, a render of another affinity may only steal an idle tab, and
    // A's idle tab shares its storage with A's busy one.
    let pool = makePool({
      maxPages: 2,
      browserManager: makeBrowserStub({ sharedContexts: 2 }),
      disableStandbyRefill: true,
    });
    await pool.warmStandbys();
    let aBusy = await pool.getPage('A');
    let aIdle = await pool.getPage('A');
    assert.strictEqual(
      (aIdle.page as any).browserContext(),
      (aBusy.page as any).browserContext(),
      "A's two tabs share a BrowserContext",
    );
    aIdle.release();

    try {
      let b = await pool.getPage('B');
      b.release();
      assert.ok(false, `B took tab ${b.pageId}`);
    } catch (e: any) {
      assert.true(
        /No standby page available/.test(e.message),
        `B finds no tab it may take: ${e.message}`,
      );
    }
    assert.deepEqual(
      pool.getWarmAffinities(),
      ['A'],
      "both tabs are still A's",
    );
    aBusy.release();
  });

  test('a cross-affinity steal takes an idle tab that is alone in its BrowserContext', async function (assert) {
    let pool = makePool({
      maxPages: 2,
      browserManager: makeBrowserStub(),
      disableStandbyRefill: true,
    });
    await pool.warmStandbys();
    let aBusy = await pool.getPage('A');
    let aIdle = await pool.getPage('A');
    aIdle.release();

    let b = await pool.getPage('B');
    assert.strictEqual(b.pageId, aIdle.pageId, "B took A's idle tab");
    b.release();
    aBusy.release();
  });
});
