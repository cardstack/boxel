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
});
