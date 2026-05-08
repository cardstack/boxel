import { module, test } from 'qunit';
import { basename, dirname, join } from 'path';
import { dirSync } from 'tmp';
import { writeFileSync, ensureDirSync } from 'fs-extra';
import {
  Realm,
  CachingDefinitionLookup,
  insertPermissions,
  type ModulePrerenderArgs,
  type ModuleRenderResponse,
  type Prerenderer,
  type QueuePublisher,
} from '@cardstack/runtime-common';
import type { MatrixClient } from '@cardstack/runtime-common/matrix-client';
import type { PgAdapter } from '@cardstack/postgres';
import { NodeAdapter } from '../node-realm';
import {
  setupDB,
  createVirtualNetwork,
  testCreatePrerenderAuth,
} from './helpers';

// CS-11028 — persist-after-invalidate guard for `Realm.#moduleCache`.
//
// `fallbackHandle` reads source from disk, runs `transpileJS` (50–500 ms
// for a `.gts` file), and `set()`s the bytes into `#moduleCache`. If a
// concurrent `invalidateCache(path)` lands while transpile is in-flight,
// the existing `AliasCache.invalidate` is a no-op (no entry yet) and
// the post-transpile `set()` re-installs pre-invalidation bytes.
//
// These tests gate the transpile mid-flight via `Options.transpile` —
// the test-only constructor seam that defaults to the imported
// `transpileJS` — and assert the cache state via the `X-Boxel-Cache`
// header on a follow-up request (`miss` ⇒ cache.set was correctly
// skipped; `hit` ⇒ stale bytes were re-installed).

const stubPrerenderer: Prerenderer = {
  async prerenderModule(
    _args: ModulePrerenderArgs,
  ): Promise<ModuleRenderResponse> {
    throw new Error('prerenderModule not used in this test');
  },
  async prerenderVisit() {
    throw new Error('prerenderVisit not used in this test');
  },
  async runCommand() {
    throw new Error('runCommand not used in this test');
  },
};

const stubQueue = {} as unknown as QueuePublisher;
const stubMatrixClient = {
  username: 'realm-pa-test',
  matrixURL: new URL('http://matrix.test/'),
} as unknown as MatrixClient;

interface SetupRealmArgs {
  dbAdapter: PgAdapter;
  fileContents: Record<string, string>;
  transpile: (source: string, debugFilename: string) => Promise<string>;
}

let realmCounter = 0;

async function setupRealm({
  dbAdapter,
  fileContents,
  transpile,
}: SetupRealmArgs): Promise<{ realm: Realm; realmURL: string }> {
  let dir = dirSync({ unsafeCleanup: true });
  for (let [path, contents] of Object.entries(fileContents)) {
    let abs = join(dir.name, path);
    ensureDirSync(dirname(abs));
    writeFileSync(abs, contents);
  }
  realmCounter += 1;
  let realmURL = `http://realm-pa.test/r-${realmCounter}/`;
  await insertPermissions(dbAdapter, new URL(realmURL), { '*': ['read'] });

  let virtualNetwork = createVirtualNetwork();
  let definitionLookup = new CachingDefinitionLookup(
    dbAdapter,
    stubPrerenderer,
    virtualNetwork,
    testCreatePrerenderAuth,
  );

  let adapter = new NodeAdapter(dir.name, false);
  let realm = new Realm(
    {
      url: realmURL,
      adapter,
      secretSeed: 'test-secret',
      dbAdapter,
      queue: stubQueue,
      virtualNetwork,
      matrixClient: stubMatrixClient,
      realmServerURL: 'http://realm-pa.test/',
      definitionLookup,
    },
    { transpile },
  );

  return { realm, realmURL };
}

interface GatedTranspileControls {
  transpile: (source: string, debugFilename: string) => Promise<string>;
  // Resolves once the gated transpile has been entered (caller is
  // parked at the gate). Snapshot inside `fallbackHandle` has been
  // taken by then.
  observed: Promise<void>;
  // Releases the gate so transpile can resolve and `fallbackHandle`
  // can proceed past the persist site.
  release: () => void;
  callCount: () => number;
}

function makeGatedTranspile(): GatedTranspileControls {
  let calls = 0;
  let observedFired = false;
  let gateReleased = false;
  let observedRelease!: () => void;
  let gateRelease!: () => void;
  let observed = new Promise<void>((r) => (observedRelease = r));
  let gate = new Promise<void>((r) => (gateRelease = r));

  let transpile = async (source: string, _debugFilename: string) => {
    calls += 1;
    if (!observedFired) {
      observedFired = true;
      observedRelease();
    }
    if (!gateReleased) {
      await gate;
    }
    return `/* gated test transpile */\nexport const __sourceLen = ${source.length};`;
  };

  return {
    transpile,
    observed,
    release: () => {
      gateReleased = true;
      gateRelease();
    },
    callCount: () => calls,
  };
}

function moduleRequest(realmURL: string, path: string): Request {
  return new Request(`${realmURL}${path}`, { method: 'GET' });
}

async function dispatch(realm: Realm, request: Request): Promise<Response> {
  let resp = await realm.handle(request);
  if (!resp) {
    throw new Error(`Request fell outside the realm: ${request.url}`);
  }
  return resp;
}

module(basename(__filename), function () {
  module('CS-11028 persist-after-invalidate', function (hooks) {
    let dbAdapter: PgAdapter;

    setupDB(hooks, {
      beforeEach: async (adapter) => {
        dbAdapter = adapter;
      },
    });

    test('in-flight transpile result is dropped when invalidateCache runs concurrently', async function (assert) {
      let gated = makeGatedTranspile();
      let { realm, realmURL } = await setupRealm({
        dbAdapter,
        fileContents: { 'person.gts': 'export const v = 1;' },
        transpile: gated.transpile,
      });

      let p = dispatch(realm, moduleRequest(realmURL, 'person.gts'));
      await gated.observed;

      // Bumps generation for `person.gts` synchronously.
      realm.invalidateCache('person.gts');
      gated.release();

      let resp = await p;
      assert.strictEqual(resp.status, 200, 'first request returns 200');

      // Second request — cache should be empty if persist was
      // correctly skipped.
      let resp2 = await dispatch(realm, moduleRequest(realmURL, 'person.gts'));
      assert.strictEqual(resp2.status, 200);
      assert.strictEqual(
        resp2.headers.get('X-Boxel-Cache'),
        'miss',
        'cache.set was skipped — second request misses and re-transpiles',
      );
      assert.strictEqual(
        gated.callCount(),
        2,
        'transpile was called twice (in-flight result discarded; second request retranspiles)',
      );
    });

    test('in-flight transpile is persisted normally without a concurrent invalidate', async function (assert) {
      let gated = makeGatedTranspile();
      let { realm, realmURL } = await setupRealm({
        dbAdapter,
        fileContents: { 'person.gts': 'export const v = 1;' },
        transpile: gated.transpile,
      });

      let p = dispatch(realm, moduleRequest(realmURL, 'person.gts'));
      await gated.observed;
      // No invalidate.
      gated.release();

      let resp = await p;
      assert.strictEqual(resp.status, 200);

      let resp2 = await dispatch(realm, moduleRequest(realmURL, 'person.gts'));
      assert.strictEqual(
        resp2.headers.get('X-Boxel-Cache'),
        'hit',
        'no concurrent invalidate — cache.set proceeds; second request hits',
      );
      assert.strictEqual(
        gated.callCount(),
        1,
        'transpile was called once (regression guard against false-positive skip)',
      );
    });

    test('invalidate of a different path leaves the in-flight transpile alone', async function (assert) {
      let gated = makeGatedTranspile();
      let { realm, realmURL } = await setupRealm({
        dbAdapter,
        fileContents: {
          'person.gts': 'export const v = 1;',
          'other.gts': 'export const w = 2;',
        },
        transpile: gated.transpile,
      });

      let p = dispatch(realm, moduleRequest(realmURL, 'person.gts'));
      await gated.observed;

      // Per-path scoping — bumping `other.gts`'s generation must not
      // discard the in-flight `person.gts` result.
      realm.invalidateCache('other.gts');
      gated.release();

      let resp = await p;
      assert.strictEqual(resp.status, 200);

      let resp2 = await dispatch(realm, moduleRequest(realmURL, 'person.gts'));
      assert.strictEqual(
        resp2.headers.get('X-Boxel-Cache'),
        'hit',
        'unrelated invalidate left the in-flight persist intact',
      );
    });

    test('__testOnlyClearCaches during in-flight transpile discards the result', async function (assert) {
      let gated = makeGatedTranspile();
      let { realm, realmURL } = await setupRealm({
        dbAdapter,
        fileContents: { 'person.gts': 'export const v = 1;' },
        transpile: gated.transpile,
      });

      let p = dispatch(realm, moduleRequest(realmURL, 'person.gts'));
      await gated.observed;

      // Wholesale wipe — bumps the global generation, which catches
      // in-flight transpiles for paths that have no per-path entry.
      realm.__testOnlyClearCaches();
      gated.release();

      let resp = await p;
      assert.strictEqual(resp.status, 200);

      let resp2 = await dispatch(realm, moduleRequest(realmURL, 'person.gts'));
      assert.strictEqual(
        resp2.headers.get('X-Boxel-Cache'),
        'miss',
        'global generation bump discarded the persist; second request misses',
      );
    });

    test('extension-variant fan-out: invalidate of foo.gts catches a request that came in as foo', async function (assert) {
      let gated = makeGatedTranspile();
      let { realm, realmURL } = await setupRealm({
        dbAdapter,
        // Only the extension-bearing canonical exists on disk.
        fileContents: { 'person.gts': 'export const v = 1;' },
        transpile: gated.transpile,
      });

      // Request URL omits the extension; resolves to person.gts and
      // gets cached under the alias `person`.
      let p = dispatch(realm, moduleRequest(realmURL, 'person'));
      await gated.observed;

      // Writer invalidates the canonical path. The bump must fan out
      // to the alias form so the alias-keyed snapshot also sees a
      // change at persist time.
      realm.invalidateCache('person.gts');
      gated.release();

      let resp = await p;
      assert.strictEqual(resp.status, 200);

      let resp2 = await dispatch(realm, moduleRequest(realmURL, 'person'));
      assert.strictEqual(
        resp2.headers.get('X-Boxel-Cache'),
        'miss',
        'canonical-path invalidate fan-out caught the alias-keyed in-flight',
      );
    });
  });
});
