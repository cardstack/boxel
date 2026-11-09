import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { PagePool } from '../prerender/page-pool.ts';
import { toAffinityKey } from '../prerender/affinity.ts';

// A realm whose visits time out has its file-admission cap halved, and the
// cap comes back one step at a time as its visits finish in time. Other
// realms keep their cap.

const REALM_A = 'http://localhost:4202/slow/';
const REALM_B = 'http://localhost:4202/other/';

const POOL_SIZING_ENV_KEYS = [
  'PRERENDER_PAGE_POOL_MIN',
  'PRERENDER_PAGE_POOL_MAX',
  'PRERENDER_PAGE_POOL_INITIAL',
  'PRERENDER_PAGE_POOL_HIGH_PRIORITY_MAX',
  'PRERENDER_AFFINITY_TAB_MAX',
  'PRERENDER_AFFINITY_FILE_CONCURRENCY',
];

function keyFor(realm: string) {
  return toAffinityKey({
    affinityType: 'realm',
    affinityValue: realm,
    auth: '{}',
  });
}

function makeBrowserStub() {
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
        async close() {},
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

  // A fixed pool of 8 tabs. With 4 tabs per realm (the default) it admits 3
  // file renders of one realm at a time; with 5 it admits 4.
  function makePool(tabMax = 4): PagePool {
    let saved = POOL_SIZING_ENV_KEYS.map((key) => [key, process.env[key]]);
    for (let key of POOL_SIZING_ENV_KEYS) {
      delete process.env[key];
    }
    process.env.PRERENDER_AFFINITY_TAB_MAX = String(tabMax);
    try {
      let pool = new PagePool({
        maxPages: 8,
        serverURL: 'http://localhost',
        browserManager: makeBrowserStub() as any,
        boxelHostURL: 'http://localhost:4200',
        standbyTimeoutMs: 500,
      });
      pools.push(pool);
      return pool;
    } finally {
      for (let [key, value] of saved) {
        if (value === undefined) {
          delete process.env[key!];
        } else {
          process.env[key!] = value;
        }
      }
    }
  }

  // Asks for `count` file renders of the realm at once and returns how many
  // got a tab before the rest gave up waiting. Every render it started has
  // ended by the time it returns, so the realm is idle again.
  async function admittedAtOnce(pool: PagePool, realm: string, count = 4) {
    let waiting = new AbortController();
    let leases = Array.from({ length: count }, () =>
      pool.getPage(keyFor(realm), 'file', { signal: waiting.signal }),
    );
    // Long enough for a render with a free admission slot to get its tab.
    await new Promise((resolve) => setTimeout(resolve, 200));
    waiting.abort();
    let admitted = 0;
    for (let result of await Promise.allSettled(leases)) {
      if (result.status === 'fulfilled') {
        admitted++;
        result.value.release();
      }
    }
    return admitted;
  }

  // Reports how a render that holds `lease` ended.
  function report(
    pool: PagePool,
    realm: string,
    lease: { fileAdmissionGeneration?: number },
    outcome: 'in-time' | 'timed-out',
  ) {
    pool.recordVisitOutcome(
      keyFor(realm),
      outcome,
      lease.fileAdmissionGeneration!,
    );
  }

  // One visit of the realm, admitted under its current cap, that ends with
  // `outcome`.
  async function visit(
    pool: PagePool,
    realm: string,
    outcome: 'in-time' | 'timed-out',
  ) {
    let lease = await pool.getPage(keyFor(realm), 'file');
    report(pool, realm, lease, outcome);
    lease.release();
  }

  test("a timed-out visit halves its realm's file admission, and visits in time bring it back", async function (assert) {
    let pool = makePool();
    await pool.warmStandbys();
    assert.strictEqual(
      await admittedAtOnce(pool, REALM_A),
      3,
      'a realm starts with its full cap',
    );

    await visit(pool, REALM_A, 'timed-out');
    assert.strictEqual(
      await admittedAtOnce(pool, REALM_A),
      1,
      'a timeout halves the cap, and the lower cap holds after the realm goes idle',
    );
    assert.strictEqual(
      await admittedAtOnce(pool, REALM_B),
      3,
      'another realm keeps its full cap',
    );

    await visit(pool, REALM_A, 'in-time');
    await visit(pool, REALM_A, 'in-time');
    assert.strictEqual(
      await admittedAtOnce(pool, REALM_A),
      1,
      'two visits in time are not enough to raise the cap',
    );
    await visit(pool, REALM_A, 'in-time');
    assert.strictEqual(
      await admittedAtOnce(pool, REALM_A),
      2,
      'the third visit in time raises the cap by one',
    );

    await visit(pool, REALM_A, 'in-time');
    await visit(pool, REALM_A, 'timed-out');
    await visit(pool, REALM_A, 'in-time');
    await visit(pool, REALM_A, 'in-time');
    assert.strictEqual(
      await admittedAtOnce(pool, REALM_A),
      1,
      'a timeout starts the count of visits in time again',
    );
    await visit(pool, REALM_A, 'in-time');
    assert.strictEqual(
      await admittedAtOnce(pool, REALM_A),
      2,
      'three visits in time after the timeout raise the cap',
    );

    for (let i = 0; i < 6; i++) {
      await visit(pool, REALM_A, 'in-time');
    }
    assert.strictEqual(
      await admittedAtOnce(pool, REALM_A),
      3,
      'the cap never goes past the full cap',
    );
  });

  test('a timeout lowers the cap without taking a tab from a render already admitted', async function (assert) {
    let pool = makePool();
    await pool.warmStandbys();
    let held = await Promise.all(
      Array.from({ length: 3 }, () => pool.getPage(keyFor(REALM_A), 'file')),
    );
    report(pool, REALM_A, held[0]!, 'timed-out');

    let nextAdmitted = false;
    let next = pool.getPage(keyFor(REALM_A), 'file').then((lease) => {
      nextAdmitted = true;
      return lease;
    });
    held[0]!.release();
    held[1]!.release();
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.false(
      nextAdmitted,
      'with one render still running, a waiting render is not admitted under a cap of one',
    );

    held[2]!.release();
    (await next).release();
    assert.true(nextAdmitted, 'it is admitted once the last render ends');
  });

  test('renders in flight that time out together halve the cap once', async function (assert) {
    let pool = makePool(5);
    await pool.warmStandbys();
    let held = await Promise.all(
      Array.from({ length: 4 }, () => pool.getPage(keyFor(REALM_A), 'file')),
    );
    for (let lease of held) {
      report(pool, REALM_A, lease, 'timed-out');
      lease.release();
    }
    assert.strictEqual(
      await admittedAtOnce(pool, REALM_A, 5),
      2,
      'the cap went from 4 to 2, not on down to 1',
    );
  });

  test('renders admitted before the cap went down do not count toward raising it', async function (assert) {
    let pool = makePool(5);
    await pool.warmStandbys();
    let held = await Promise.all(
      Array.from({ length: 4 }, () => pool.getPage(keyFor(REALM_A), 'file')),
    );
    report(pool, REALM_A, held[0]!, 'timed-out');
    held[0]!.release();
    for (let lease of held.slice(1)) {
      report(pool, REALM_A, lease, 'in-time');
      lease.release();
    }
    assert.strictEqual(
      await admittedAtOnce(pool, REALM_A, 5),
      2,
      'the cap stays at 2',
    );

    for (let i = 0; i < 3; i++) {
      await visit(pool, REALM_A, 'in-time');
    }
    assert.strictEqual(
      await admittedAtOnce(pool, REALM_A, 5),
      3,
      'three visits admitted under the lower cap raise it',
    );
  });
});
