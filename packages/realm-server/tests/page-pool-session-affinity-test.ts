import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { PagePool } from '../prerender/page-pool.ts';
import {
  fromAffinityKey,
  isAffinityOfRealm,
  isRealmAuthorityAffinityKey,
  isRunAffinityKey,
  realmAffinityKeyOf,
  renderSessionOf,
  toAffinityKey,
} from '../prerender/affinity.ts';
import { buildCreatePrerenderAuth } from '../prerender/auth.ts';
import { mintRunToken } from '../lib/run-token.ts';
import { buildCreateOAuthTabAuth } from '../lib/oauth-tab-token.ts';
import type { AutomationRun } from '@cardstack/runtime-common';

// A render hands its tab its sessions through localStorage, which belongs to
// the tab's BrowserContext, and runs code its realm holds, which can leave a
// timer in the page. A context must therefore only ever carry one render
// session: a realm affinity is split by the sessions its render carries, and
// a tab never moves to another affinity.

const REALM = 'http://localhost:4202/test/';
const REALM_KEY = `realm:${REALM}`;
const USER_1 = '@user-1:localhost';
const USER_2 = '@user-2:localhost';
const OWNER = '@owner:localhost';
const OTHER_OWNER = '@other-owner:localhost';

const createPrerenderAuth = buildCreatePrerenderAuth(
  'page-pool-session-affinity-test-seed',
  'http://localhost:4202',
);
const permissions = { [REALM]: ['read' as const] };

const realmAuthorityAuth = createPrerenderAuth(OWNER, permissions, {
  realmAuthority: true,
});
// Realm authority minted for another realm's owner, as a definition lookup
// from that realm renders this realm's modules under.
const otherOwnerAuthorityAuth = createPrerenderAuth(OTHER_OWNER, permissions, {
  realmAuthority: true,
});
const user1Auth = createPrerenderAuth(USER_1, permissions);
const user2Auth = createPrerenderAuth(USER_2, permissions);
const anonymousAuth = '{}';

// An OAuth app's tab auth: its tab tokens, one per realm, all for one grant.
const createOAuthTabAuth = buildCreateOAuthTabAuth(
  'page-pool-session-affinity-test-seed',
  { realmServerURL: 'http://localhost:4202' },
);
function oauthTabAuth(user: string, grantId = 'grant-1') {
  return createOAuthTabAuth({
    userId: user,
    permissions: {
      [REALM]: ['read'],
      'http://localhost:4202/other/': ['read'],
    },
    grantId,
    scopes: ['boxel:read'],
    purpose: 'run-command',
    permissionCeiling: 'read',
  });
}

// An automation run's tab auth: its run token, alone, for its realm.
function runAuth(user: string, runId = 'run-1') {
  let now = new Date().toISOString();
  let run = {
    id: runId,
    actsAs: user,
    attempt: 1,
    state: 'running',
    startedAt: now,
  } as AutomationRun;
  return JSON.stringify({
    [REALM]: mintRunToken({
      realmSecretSeed: 'page-pool-session-affinity-test-seed',
      run,
      realmURL: REALM,
      readRealms: [],
      writesCap: 10,
      realmServerURL: 'http://localhost:4202/',
      timeLimitSeconds: 60,
    }),
  });
}

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
    fileAdmission?: boolean;
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
        disableFileAdmission: !opts.fileAdmission,
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
    test('a key built without auth is the realm key', function (assert) {
      assert.strictEqual(
        toAffinityKey({ affinityType: 'realm', affinityValue: REALM }),
        REALM_KEY,
      );
    });

    test('every session gets a key of its own under the realm', function (assert) {
      let keys = [
        realmAuthorityAuth,
        otherOwnerAuthorityAuth,
        user1Auth,
        user2Auth,
        anonymousAuth,
        'not json',
      ].map(realmKeyFor);
      assert.strictEqual(
        new Set([REALM_KEY, ...keys]).size,
        7,
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

    test('only realm-authority sessions are keyed as realm authority', function (assert) {
      assert.true(isRealmAuthorityAffinityKey(realmKeyFor(realmAuthorityAuth)));
      assert.true(
        isRealmAuthorityAffinityKey(realmKeyFor(otherOwnerAuthorityAuth)),
      );
      for (let auth of [user1Auth, anonymousAuth, 'not json']) {
        assert.false(isRealmAuthorityAffinityKey(realmKeyFor(auth)));
      }
    });

    test("an automation run's tab is keyed by its realm and its run's identity", function (assert) {
      let key = realmKeyFor(runAuth(USER_1));
      assert.strictEqual(key, `${REALM_KEY}#run:${USER_1}`);
      assert.true(isRunAffinityKey(key), 'it is a run affinity');
      assert.strictEqual(
        realmKeyFor(runAuth(USER_1, 'run-2')),
        key,
        'another run of the realm and identity shares the affinity',
      );
      assert.notStrictEqual(
        realmKeyFor(runAuth(USER_2)),
        key,
        'a run of another identity does not',
      );
      assert.notStrictEqual(
        realmKeyFor(user1Auth),
        key,
        "the identity's own sessions never share a run's affinity",
      );
      for (let auth of [realmAuthorityAuth, user1Auth, anonymousAuth]) {
        assert.false(isRunAffinityKey(realmKeyFor(auth)));
      }
      assert.strictEqual(realmAffinityKeyOf(key), REALM_KEY);
    });

    test('a run token beside any other session is unreadable', function (assert) {
      let mixed = JSON.stringify({
        ...JSON.parse(runAuth(USER_1)),
        'http://localhost:4202/other/': JSON.parse(user1Auth)[REALM],
      });
      assert.strictEqual(renderSessionOf(mixed).kind, 'unreadable');
      assert.false(isRunAffinityKey(realmKeyFor(mixed)));
    });

    test("an OAuth app's tab is keyed by its user and grant, apart from the user's sessions", function (assert) {
      let auth = oauthTabAuth(USER_1);
      assert.deepEqual(renderSessionOf(auth), {
        kind: 'oauth-tab',
        user: USER_1,
        grant: 'grant-1',
      });
      let key = realmKeyFor(auth);
      assert.strictEqual(key, `${REALM_KEY}#oauth:${USER_1}:grant-1`);
      assert.notStrictEqual(
        realmKeyFor(user1Auth),
        key,
        "the user's own sessions never share it",
      );
      assert.notStrictEqual(
        realmKeyFor(oauthTabAuth(USER_1, 'grant-2')),
        key,
        "another grant's tab tokens never share it",
      );
      assert.false(isRealmAuthorityAffinityKey(key));
      assert.false(isRunAffinityKey(key));
      assert.strictEqual(realmAffinityKeyOf(key), REALM_KEY);

      // A command runs on its user's affinity, which a tab token splits too.
      let userKey = toAffinityKey({
        affinityType: 'user',
        affinityValue: USER_1,
        auth,
      });
      assert.strictEqual(userKey, `user:${USER_1}#oauth:grant-1`);
      assert.strictEqual(
        realmAffinityKeyOf(userKey),
        `user:${USER_1}`,
        'it is reported to the manager as the user',
      );
      assert.deepEqual(fromAffinityKey(userKey), {
        affinityType: 'user',
        affinityValue: USER_1,
        session: 'oauth:grant-1',
      });
    });

    test('a tab token beside any other session is unreadable', function (assert) {
      let besideSession = JSON.stringify({
        ...JSON.parse(oauthTabAuth(USER_1)),
        'http://localhost:4202/third/': JSON.parse(user1Auth)[REALM],
      });
      assert.strictEqual(renderSessionOf(besideSession).kind, 'unreadable');
      let twoGrants = JSON.stringify({
        ...JSON.parse(oauthTabAuth(USER_1, 'grant-2')),
        [REALM]: JSON.parse(oauthTabAuth(USER_1))[REALM],
      });
      assert.strictEqual(renderSessionOf(twoGrants).kind, 'unreadable');
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

  // A tab never moves to another affinity: its page may hold a timer code
  // from an earlier render left, which would read what the next render hands
  // it, and a tab taken from another affinity would hold what that
  // affinity's renders left.
  for (let [idleName, idleAuth, takerName, takerAuth] of [
    [
      'an index render',
      () => realmAuthorityAuth,
      "a user's render",
      () => user1Auth,
    ],
    [
      "a user's render",
      () => user1Auth,
      'an index render',
      () => realmAuthorityAuth,
    ],
    [
      "an OAuth app's render",
      () => oauthTabAuth(USER_1),
      "the user's render",
      () => user1Auth,
    ],
    [
      "the user's render",
      () => user1Auth,
      "an OAuth app's render",
      () => oauthTabAuth(USER_1),
    ],
    [
      "another realm owner's index render",
      () => otherOwnerAuthorityAuth,
      'an index render',
      () => realmAuthorityAuth,
    ],
  ] as [string, () => string, string, () => string][]) {
    test(`${takerName} never takes the idle tab of ${idleName}, even with no standby left`, async function (assert) {
      let pool = makePool({
        maxPages: 2,
        browserManager: makeBrowserStub(),
        disableStandbyRefill: true,
      });
      await pool.warmStandbys();
      let idleKey = realmKeyFor(idleAuth());
      let busy = await pool.getPage('A');
      let idle = await pool.getPage(idleKey);
      idle.release();

      try {
        let taken = await pool.getPage(realmKeyFor(takerAuth()));
        taken.release();
        assert.ok(false, `${takerName} took tab ${taken.pageId}`);
      } catch (e: any) {
        assert.true(
          /No standby page available/.test(e.message),
          `${takerName} finds no tab it may take: ${e.message}`,
        );
      }
      assert.true(
        pool.getWarmAffinities().includes(idleKey),
        `the idle tab is still ${idleName}'s`,
      );
      busy.release();
    });
  }

  test("at the pool's ceiling, a render waits for a fresh standby rather than take another affinity's idle tab", async function (assert) {
    let pool = makePool({ maxPages: 2, browserManager: makeBrowserStub() });
    await pool.warmStandbys();
    let busy = await pool.getPage(realmKeyFor(realmAuthorityAuth));
    let idle = await pool.getPage(realmKeyFor(otherOwnerAuthorityAuth));
    idle.release();

    let user = await pool.getPage(realmKeyFor(user1Auth));
    assert.notStrictEqual(user.pageId, idle.pageId, 'not the idle tab');
    assert.notStrictEqual(user.pageId, busy.pageId, 'not the busy tab');
    assert.notStrictEqual(
      (user.page as any).browserContext(),
      (idle.page as any).browserContext(),
      'a BrowserContext of its own',
    );
    user.release();
    busy.release();
  });

  test("renders of one realm by its own indexing, another realm's owner, two users and an anonymous reader each get a BrowserContext of their own", async function (assert) {
    let pool = makePool({ maxPages: 5, browserManager: makeBrowserStub() });
    await pool.warmStandbys();
    // Each render releases its tab before the next one asks, so renders that
    // shared an affinity would share the tab.
    let contexts = new Set();
    for (let auth of [
      realmAuthorityAuth,
      otherOwnerAuthorityAuth,
      user1Auth,
      user2Auth,
      anonymousAuth,
    ]) {
      let lease = await pool.getPage(realmKeyFor(auth));
      contexts.add((lease.page as any).browserContext());
      lease.release();
    }
    assert.strictEqual(contexts.size, 5, 'five BrowserContexts');
  });

  test("an automation run's affinity holds one tab, and its runs take turns on it", async function (assert) {
    let pool = makePool({ maxPages: 4, browserManager: makeBrowserStub() });
    await pool.warmStandbys();
    let key = realmKeyFor(runAuth(USER_1));
    let first = await pool.getPage(key, 'command');
    let secondHeld = false;
    let second = pool.getPage(key, 'command').then((lease) => {
      secondHeld = true;
      return lease;
    });
    // Long enough for a render with a free standby to take it.
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.false(
      secondHeld,
      'a second run of the realm and identity waits, though standbys are free',
    );
    first.release();
    let lease = await second;
    assert.strictEqual(lease.pageId, first.pageId, 'it runs on the same tab');
    lease.release();

    let user = await pool.getPage('user:A', 'command');
    let otherUser = await pool.getPage('user:A', 'command');
    assert.notStrictEqual(
      user.pageId,
      otherUser.pageId,
      'an ordinary command affinity still takes a second tab',
    );
    user.release();
    otherUser.release();
  });

  test("a realm's sessions share one file-admission cap, and a module render under realm authority still gets a tab", async function (assert) {
    // Two tabs per affinity leaves room for one file render at a time.
    let previousTabMax = process.env.PRERENDER_AFFINITY_TAB_MAX;
    process.env.PRERENDER_AFFINITY_TAB_MAX = '2';
    let pool: PagePool;
    try {
      pool = makePool({
        maxPages: 3,
        browserManager: makeBrowserStub(),
        fileAdmission: true,
      });
    } finally {
      if (previousTabMax === undefined) {
        delete process.env.PRERENDER_AFFINITY_TAB_MAX;
      } else {
        process.env.PRERENDER_AFFINITY_TAB_MAX = previousTabMax;
      }
    }
    await pool.warmStandbys();
    let user1Capture = await pool.getPage(realmKeyFor(user1Auth), 'file');

    let user2Admitted = false;
    let user2Capture = pool
      .getPage(realmKeyFor(user2Auth), 'file')
      .then((lease) => {
        user2Admitted = true;
        return lease;
      });
    let moduleRender = await pool.getPage(
      realmKeyFor(realmAuthorityAuth),
      'module',
    );
    // Long enough for a capture with a free admission slot to get its tab.
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.false(
      user2Admitted,
      "another reader's capture of the realm waits for the first",
    );
    assert.ok(
      moduleRender.pageId,
      'the module render the capture waits on gets a tab',
    );

    moduleRender.release();
    user1Capture.release();
    (await user2Capture).release();
    assert.true(user2Admitted, 'the second capture runs once the first ends');
  });
});
