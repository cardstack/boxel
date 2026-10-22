import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { PagePool } from '../prerender/page-pool.ts';
import { closeServer } from './helpers/index.ts';

// When a pool drops the last tab for an affinity it tells the prerender
// manager, so the manager stops routing that affinity to this server. That
// notice is part of the server's registration: a pool whose server is not
// registered must not send it.

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

const POOL_SIZING_ENV_KEYS = [
  'PRERENDER_PAGE_POOL_MIN',
  'PRERENDER_PAGE_POOL_MAX',
  'PRERENDER_PAGE_POOL_INITIAL',
  'PRERENDER_PAGE_POOL_HIGH_PRIORITY_MAX',
];

module(basename(import.meta.filename), function (hooks) {
  let manager: Server;
  // Every request the stand-in manager receives, with the server it names.
  let requests: { method: string; path: string; serverURL: string | null }[];
  let pools: PagePool[];
  let previousManagerURL: string | undefined;

  hooks.beforeEach(async function () {
    requests = [];
    pools = [];
    manager = createServer((req, res) => {
      let url = new URL(req.url ?? '/', 'http://manager');
      requests.push({
        method: req.method ?? '',
        path: url.pathname,
        serverURL: url.searchParams.get('url'),
      });
      res.statusCode = 204;
      res.end();
    });
    await new Promise<void>((resolve, reject) => {
      manager.once('error', reject);
      manager.listen(0, '127.0.0.1', () => resolve());
    });
    previousManagerURL = process.env.PRERENDER_MANAGER_URL;
    process.env.PRERENDER_MANAGER_URL = `http://127.0.0.1:${(manager.address() as AddressInfo).port}`;
  });

  hooks.afterEach(async function () {
    for (let pool of pools) {
      await pool.closeAll();
    }
    await closeServer(manager);
    if (previousManagerURL === undefined) {
      delete process.env.PRERENDER_MANAGER_URL;
    } else {
      process.env.PRERENDER_MANAGER_URL = previousManagerURL;
    }
  });

  function makePool(serverURL: string, registerWithManager?: boolean) {
    // A pool sized by the environment would hold more than its one tab.
    let sizing = POOL_SIZING_ENV_KEYS.map((key) => [key, process.env[key]]);
    for (let key of POOL_SIZING_ENV_KEYS) {
      delete process.env[key];
    }
    try {
      let pool = new PagePool({
        maxPages: 1,
        serverURL,
        browserManager: makeBrowserStub() as any,
        boxelHostURL: 'http://localhost:4200',
        standbyTimeoutMs: 500,
        disableFileAdmission: true,
        disableStandbyRefill: true,
        ...(registerWithManager === undefined ? {} : { registerWithManager }),
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

  test('only a pool whose server registers reports an evicted affinity', async function (assert) {
    let registeredURL = 'http://127.0.0.1:59001';
    let unregisteredURL = 'http://127.0.0.1:59002';
    let registered = makePool(registeredURL);
    let unregistered = makePool(unregisteredURL, false);

    for (let pool of [registered, unregistered]) {
      let held = await pool.getPage('realm:http://example.com/');
      held.release();
      // Resolves after the pool has awaited its notice to the manager.
      await pool.disposeAffinity('realm:http://example.com/');
    }

    assert.deepEqual(
      requests.filter((r) => r.serverURL === registeredURL),
      [
        {
          method: 'DELETE',
          path: `/prerender-servers/affinities/${encodeURIComponent('realm:http://example.com/')}`,
          serverURL: registeredURL,
        },
      ],
      'the registered pool reports the evicted affinity',
    );
    assert.deepEqual(
      requests.filter((r) => r.serverURL === unregisteredURL),
      [],
      'the manager never hears from the unregistered pool',
    );
  });

  // A pool of one tab with no standby left, so a render of a new affinity
  // can only take the tab another affinity holds.
  async function stealOnlyTab(from: string, to: string) {
    let serverURL = 'http://127.0.0.1:59003';
    let pool = makePool(serverURL);
    await pool.warmStandbys();
    let held = await pool.getPage(from);
    held.release();
    let stolen = await pool.getPage(to);
    stolen.release();
    assert_(stolen.pageId === held.pageId, `${to} took ${from}'s tab`);
    // The notice is sent without being awaited.
    await new Promise((resolve) => setTimeout(resolve, 200));
    return requests.filter((r) => r.serverURL === serverURL);
  }
  let assert_: (ok: boolean, message: string) => void;

  test("a tab moving between two sessions of one realm doesn't report the realm evicted", async function (assert) {
    assert_ = (ok, message) => assert.true(ok, message);
    let sent = await stealOnlyTab(
      'realm:http://example.com/#@user-1:localhost',
      'realm:http://example.com/#@user-2:localhost',
    );
    assert.deepEqual(sent, [], 'the manager hears nothing');
  });

  test('a tab moving to another realm reports its realm evicted', async function (assert) {
    assert_ = (ok, message) => assert.true(ok, message);
    let sent = await stealOnlyTab(
      'realm:http://example.com/#@user-1:localhost',
      'realm:http://other.example.com/#@user-1:localhost',
    );
    assert.deepEqual(
      sent.map((r) => `${r.method} ${r.path}`),
      [
        `DELETE /prerender-servers/affinities/${encodeURIComponent('realm:http://example.com/')}`,
      ],
      "the manager hears that the first realm's affinity is gone",
    );
  });
});
