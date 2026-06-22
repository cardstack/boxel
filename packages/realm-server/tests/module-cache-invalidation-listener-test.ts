import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { PgAdapter } from '@cardstack/postgres';
import {
  CachingDefinitionLookup,
  MODULE_CACHE_INVALIDATED_CHANNEL,
  param,
  query,
  type Prerenderer,
  type VirtualNetwork,
  type RealmPermissions,
} from '@cardstack/runtime-common';
import { setupDB } from './helpers/index.ts';
import {
  ModuleCacheInvalidationListener,
  parseModuleCacheInvalidationPayload,
} from '../lib/module-cache-invalidation-listener.ts';

// Records bump calls on a stub-or-real CachingDefinitionLookup. Used by
// dispatch tests (stub form) and end-to-end tests (wrapping a real lookup
// to keep its bump methods, but recording the calls for assertion).
interface BumpRecorder {
  module: Array<{ resolvedRealmURL: string; moduleURL: string }>;
  realm: string[];
  global: number;
}
function newRecorder(): BumpRecorder {
  return { module: [], realm: [], global: 0 };
}

// Minimal stand-in shaped like the bump surface the listener uses. Avoids
// constructing a full CachingDefinitionLookup for the unit-dispatch tests
// where we don't need the prerender / virtual-network plumbing.
function makeStubLookup(recorder: BumpRecorder): CachingDefinitionLookup {
  const stub = {
    bumpModuleGeneration(resolvedRealmURL: string, moduleURL: string) {
      recorder.module.push({ resolvedRealmURL, moduleURL });
    },
    bumpRealmGeneration(resolvedRealmURL: string) {
      recorder.realm.push(resolvedRealmURL);
    },
    bumpGlobalGeneration() {
      recorder.global += 1;
    },
  };
  return stub as unknown as CachingDefinitionLookup;
}

// Real CachingDefinitionLookup wrapped so the originals still run AND each
// bump is recorded. End-to-end tests use this so we can prove the listener
// hit the lookup attached to *this* instance, with the right args.
function recordBumpsOn(
  lookup: CachingDefinitionLookup,
  recorder: BumpRecorder,
): void {
  const originalModule = lookup.bumpModuleGeneration.bind(lookup);
  const originalRealm = lookup.bumpRealmGeneration.bind(lookup);
  const originalGlobal = lookup.bumpGlobalGeneration.bind(lookup);
  lookup.bumpModuleGeneration = (resolvedRealmURL, moduleURL) => {
    recorder.module.push({ resolvedRealmURL, moduleURL });
    originalModule(resolvedRealmURL, moduleURL);
  };
  lookup.bumpRealmGeneration = (resolvedRealmURL) => {
    recorder.realm.push(resolvedRealmURL);
    originalRealm(resolvedRealmURL);
  };
  lookup.bumpGlobalGeneration = () => {
    recorder.global += 1;
    originalGlobal();
  };
}

// Minimal Prerenderer / VirtualNetwork stubs — these tests never trigger
// lookupDefinition, so the methods only need to typecheck.
const stubPrerenderer: Prerenderer = {
  async prerenderModule() {
    throw new Error('prerenderModule not used in this test');
  },
  async prerenderVisit() {
    throw new Error('prerenderVisit not used in this test');
  },
  async runCommand() {
    throw new Error('runCommand not used in this test');
  },
};
const stubVirtualNetwork = {
  fetch: (async () => {
    throw new Error('fetch not used in this test');
  }) as typeof fetch,
  isRegisteredPrefix: () => false,
  toURL: (url: string) => new URL(url),
} as unknown as VirtualNetwork;
const stubCreatePrerenderAuth = (
  _userId: string,
  _permissions: RealmPermissions,
) => 'stub-auth';

function waitFor<T>(
  getValue: () => T | undefined,
  timeoutMs = 3000,
  pollMs = 20,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      const value = getValue();
      if (value !== undefined) {
        resolve(value);
        return;
      }
      if (Date.now() - started > timeoutMs) {
        reject(new Error(`timeout after ${timeoutMs}ms`));
        return;
      }
      setTimeout(tick, pollMs);
    };
    tick();
  });
}

module(basename(import.meta.filename), function () {
  module('parseModuleCacheInvalidationPayload', function () {
    test('parses a module payload carrying a single URL', function (assert) {
      assert.deepEqual(
        parseModuleCacheInvalidationPayload(
          JSON.stringify({
            k: 'module',
            r: 'http://localhost:4201/luke/',
            m: ['http://localhost:4201/luke/cards/person.gts'],
          }),
        ),
        {
          kind: 'module',
          resolvedRealmURL: 'http://localhost:4201/luke/',
          moduleURLs: ['http://localhost:4201/luke/cards/person.gts'],
        },
      );
    });

    test('parses a module payload carrying many URLs', function (assert) {
      const urls = [
        'https://cardstack.com/base/card-api.gts',
        'https://cardstack.com/base/string.gts',
        'https://cardstack.com/base/number.gts',
      ];
      assert.deepEqual(
        parseModuleCacheInvalidationPayload(
          JSON.stringify({
            k: 'module',
            r: 'https://cardstack.com/base/',
            m: urls,
          }),
        ),
        {
          kind: 'module',
          resolvedRealmURL: 'https://cardstack.com/base/',
          moduleURLs: urls,
        },
      );
    });

    test('parses a realm payload', function (assert) {
      assert.deepEqual(
        parseModuleCacheInvalidationPayload(
          JSON.stringify({ k: 'realm', r: 'http://localhost:4201/luke/' }),
        ),
        { kind: 'realm', resolvedRealmURL: 'http://localhost:4201/luke/' },
      );
    });

    test('parses a global payload', function (assert) {
      assert.deepEqual(
        parseModuleCacheInvalidationPayload(JSON.stringify({ k: 'global' })),
        { kind: 'global' },
      );
    });

    test('returns undefined for non-JSON', function (assert) {
      assert.strictEqual(
        parseModuleCacheInvalidationPayload('not-json'),
        undefined,
      );
    });

    test('returns undefined for an unknown kind', function (assert) {
      assert.strictEqual(
        parseModuleCacheInvalidationPayload(
          JSON.stringify({ k: 'garbage', r: 'http://x/' }),
        ),
        undefined,
      );
    });

    test('returns undefined for module payload missing realm url', function (assert) {
      assert.strictEqual(
        parseModuleCacheInvalidationPayload(
          JSON.stringify({ k: 'module', r: '', m: ['http://x/foo.gts'] }),
        ),
        undefined,
      );
    });

    test('returns undefined for module payload with empty url list', function (assert) {
      assert.strictEqual(
        parseModuleCacheInvalidationPayload(
          JSON.stringify({ k: 'module', r: 'http://x/', m: [] }),
        ),
        undefined,
      );
    });

    test('returns undefined for module payload with non-string url entry', function (assert) {
      assert.strictEqual(
        parseModuleCacheInvalidationPayload(
          JSON.stringify({ k: 'module', r: 'http://x/', m: [123] }),
        ),
        undefined,
      );
    });

    test('returns undefined for an empty realm payload', function (assert) {
      assert.strictEqual(
        parseModuleCacheInvalidationPayload(JSON.stringify({ k: 'realm' })),
        undefined,
      );
    });
  });

  module('ModuleCacheInvalidationListener (dispatch)', function () {
    test('handleNotification with single-URL module payload bumps once', function (assert) {
      const recorder = newRecorder();
      const listener = new ModuleCacheInvalidationListener({
        dbAdapter: {} as unknown as PgAdapter,
        definitionLookup: makeStubLookup(recorder),
      });

      listener.handleNotification(
        JSON.stringify({
          k: 'module',
          r: 'http://x.test/r/',
          m: ['http://x.test/r/cards/foo.gts'],
        }),
      );

      assert.deepEqual(recorder.module, [
        {
          resolvedRealmURL: 'http://x.test/r/',
          moduleURL: 'http://x.test/r/cards/foo.gts',
        },
      ]);
      assert.deepEqual(recorder.realm, []);
      assert.strictEqual(recorder.global, 0);
    });

    test('handleNotification with multi-URL module payload bumps once per URL', function (assert) {
      const recorder = newRecorder();
      const listener = new ModuleCacheInvalidationListener({
        dbAdapter: {} as unknown as PgAdapter,
        definitionLookup: makeStubLookup(recorder),
      });

      const urls = [
        'http://x.test/r/cards/foo.gts',
        'http://x.test/r/cards/bar.gts',
        'http://x.test/r/cards/baz.gts',
      ];
      listener.handleNotification(
        JSON.stringify({ k: 'module', r: 'http://x.test/r/', m: urls }),
      );

      assert.deepEqual(
        recorder.module,
        urls.map((moduleURL) => ({
          resolvedRealmURL: 'http://x.test/r/',
          moduleURL,
        })),
      );
      assert.deepEqual(recorder.realm, []);
      assert.strictEqual(recorder.global, 0);
    });

    test('handleNotification with realm payload bumps bumpRealmGeneration', function (assert) {
      const recorder = newRecorder();
      const listener = new ModuleCacheInvalidationListener({
        dbAdapter: {} as unknown as PgAdapter,
        definitionLookup: makeStubLookup(recorder),
      });

      listener.handleNotification(
        JSON.stringify({ k: 'realm', r: 'http://x.test/r/' }),
      );

      assert.deepEqual(recorder.realm, ['http://x.test/r/']);
      assert.deepEqual(recorder.module, []);
      assert.strictEqual(recorder.global, 0);
    });

    test('handleNotification with global payload bumps bumpGlobalGeneration', function (assert) {
      const recorder = newRecorder();
      const listener = new ModuleCacheInvalidationListener({
        dbAdapter: {} as unknown as PgAdapter,
        definitionLookup: makeStubLookup(recorder),
      });

      listener.handleNotification(JSON.stringify({ k: 'global' }));

      assert.strictEqual(recorder.global, 1);
      assert.deepEqual(recorder.module, []);
      assert.deepEqual(recorder.realm, []);
    });

    test('handleNotification ignores a malformed payload without throwing', function (assert) {
      const recorder = newRecorder();
      const listener = new ModuleCacheInvalidationListener({
        dbAdapter: {} as unknown as PgAdapter,
        definitionLookup: makeStubLookup(recorder),
      });

      listener.handleNotification('not-json');
      listener.handleNotification(
        JSON.stringify({ k: 'module', r: 'http://x.test/r/' }),
      );
      listener.handleNotification(JSON.stringify({ k: 'realm' }));

      assert.deepEqual(recorder.module, []);
      assert.deepEqual(recorder.realm, []);
      assert.strictEqual(recorder.global, 0);
    });

    test('handleNotification ignores empty/undefined payloads', function (assert) {
      const recorder = newRecorder();
      const listener = new ModuleCacheInvalidationListener({
        dbAdapter: {} as unknown as PgAdapter,
        definitionLookup: makeStubLookup(recorder),
      });

      listener.handleNotification(undefined);
      listener.handleNotification('');

      assert.deepEqual(recorder.module, []);
      assert.deepEqual(recorder.realm, []);
      assert.strictEqual(recorder.global, 0);
    });
  });

  module(
    'ModuleCacheInvalidationListener (LISTEN end-to-end)',
    function (hooks) {
      let dbAdapter: PgAdapter;

      setupDB(hooks, {
        beforeEach: async (adapter) => {
          dbAdapter = adapter;
        },
      });

      // The end-to-end scenario: instance A and instance B share a DB.
      // A calls invalidate(); A's invalidate() emits NOTIFY
      // module_cache_invalidated. B's listener receives the notify and
      // calls bumpModuleGeneration on B's CachingDefinitionLookup. Without
      // CS-10952, B's counters would lag A's, and a B-side in-flight
      // prerender could persist a row A just deleted.
      test('A.invalidate(url) → B listener bumps B.bumpModuleGeneration', async function (assert) {
        const realmURL = 'http://x.test/peer-invalidate/';
        const instanceB = new CachingDefinitionLookup(
          dbAdapter,
          stubPrerenderer,
          stubVirtualNetwork,
          stubCreatePrerenderAuth,
        );
        instanceB.registerRealm({
          url: realmURL,
          async getRealmOwnerUserId() {
            return 'owner-b';
          },
          async visibility() {
            return 'private';
          },
        });
        const recorderB = newRecorder();
        recordBumpsOn(instanceB, recorderB);

        const listenerB = new ModuleCacheInvalidationListener({
          dbAdapter,
          definitionLookup: instanceB,
        });
        await listenerB.start();
        try {
          const instanceA = new CachingDefinitionLookup(
            dbAdapter,
            stubPrerenderer,
            stubVirtualNetwork,
            stubCreatePrerenderAuth,
          );
          instanceA.registerRealm({
            url: realmURL,
            async getRealmOwnerUserId() {
              return 'owner-a';
            },
            async visibility() {
              return 'private';
            },
          });

          await instanceA.invalidate(`${realmURL}cards/foo.gts`);

          const seen = await waitFor(() =>
            recorderB.module.length > 0 ? recorderB.module : undefined,
          );
          // The first bump corresponds to invalidate's fan-out. A's
          // moduleURLVariants pass produces multiple URL forms (`.gts`,
          // `.ts`, `.gjs`, `.js`, extensionless). The exact URL we
          // invalidated is in the list; assert that.
          const targetURL = `${realmURL}cards/foo.gts`;
          const matched = seen.find((b) => b.moduleURL === targetURL);
          assert.ok(
            matched,
            `peer received bump for ${targetURL}; got ${JSON.stringify(seen)}`,
          );
          assert.strictEqual(matched?.resolvedRealmURL, realmURL);
        } finally {
          await listenerB.shutDown();
        }
      });

      test('A.clearRealmDefinitions(url) → B listener bumps B.bumpRealmGeneration', async function (assert) {
        const realmURL = 'http://x.test/peer-clear-realm/';
        const instanceB = new CachingDefinitionLookup(
          dbAdapter,
          stubPrerenderer,
          stubVirtualNetwork,
          stubCreatePrerenderAuth,
        );
        const recorderB = newRecorder();
        recordBumpsOn(instanceB, recorderB);

        const listenerB = new ModuleCacheInvalidationListener({
          dbAdapter,
          definitionLookup: instanceB,
        });
        await listenerB.start();
        try {
          const instanceA = new CachingDefinitionLookup(
            dbAdapter,
            stubPrerenderer,
            stubVirtualNetwork,
            stubCreatePrerenderAuth,
          );
          await instanceA.clearRealmDefinitions(realmURL);

          const seen = await waitFor(() =>
            recorderB.realm.length > 0 ? recorderB.realm : undefined,
          );
          assert.deepEqual(seen, [realmURL]);
        } finally {
          await listenerB.shutDown();
        }
      });

      test('A.clearAllDefinitions() → B listener bumps B.bumpGlobalGeneration', async function (assert) {
        const instanceB = new CachingDefinitionLookup(
          dbAdapter,
          stubPrerenderer,
          stubVirtualNetwork,
          stubCreatePrerenderAuth,
        );
        const recorderB = newRecorder();
        recordBumpsOn(instanceB, recorderB);

        const listenerB = new ModuleCacheInvalidationListener({
          dbAdapter,
          definitionLookup: instanceB,
        });
        await listenerB.start();
        try {
          const instanceA = new CachingDefinitionLookup(
            dbAdapter,
            stubPrerenderer,
            stubVirtualNetwork,
            stubCreatePrerenderAuth,
          );
          await instanceA.clearAllDefinitions();

          await waitFor(() => (recorderB.global > 0 ? true : undefined));
          assert.strictEqual(
            recorderB.global,
            1,
            `peer's global counter bumped exactly once`,
          );
        } finally {
          await listenerB.shutDown();
        }
      });

      test('self-NOTIFY is harmless: emitter receives its own bump as an idempotent second bump', async function (assert) {
        const realmURL = 'http://x.test/self-echo/';
        const instanceA = new CachingDefinitionLookup(
          dbAdapter,
          stubPrerenderer,
          stubVirtualNetwork,
          stubCreatePrerenderAuth,
        );
        instanceA.registerRealm({
          url: realmURL,
          async getRealmOwnerUserId() {
            return 'owner-a';
          },
          async visibility() {
            return 'private';
          },
        });
        const recorderA = newRecorder();
        recordBumpsOn(instanceA, recorderA);

        const listenerA = new ModuleCacheInvalidationListener({
          dbAdapter,
          definitionLookup: instanceA,
        });
        await listenerA.start();
        try {
          // Synchronously, invalidate() bumps the module generation
          // before awaiting the DELETE. Then the DELETE commits, the
          // pg_notify fires, and the listener (this same instance) bumps
          // again. So we expect to see the local-bump entries plus a
          // listener-replay bump for the same URL.
          const targetURL = `${realmURL}cards/self.gts`;
          await instanceA.invalidate(targetURL);

          // Wait until the listener has had a chance to replay (i.e.
          // there are MORE entries than the synchronous invalidate path
          // produced). Synchronous invalidate fans out across module
          // variants; the listener replay produces one entry per URL
          // notified — same set as the synchronous fan-out. So the total
          // count after replay is roughly 2x the fan-out, with ≥1 echo
          // visible for the original URL.
          const targetMatches = await waitFor(() => {
            const matches = recorderA.module.filter(
              (b) => b.moduleURL === targetURL,
            );
            return matches.length >= 2 ? matches : undefined;
          });
          assert.ok(
            targetMatches.length >= 2,
            `expected ≥2 bumps for ${targetURL} (1 synchronous + 1 listener echo); got ${targetMatches.length}`,
          );
        } finally {
          await listenerA.shutDown();
        }
      });

      test('listener receives a manually-emitted NOTIFY with the channel constant', async function (assert) {
        const recorderA = newRecorder();
        const listenerA = new ModuleCacheInvalidationListener({
          dbAdapter,
          definitionLookup: makeStubLookup(recorderA),
        });
        await listenerA.start();
        try {
          await query(dbAdapter, [
            `SELECT pg_notify(`,
            param(MODULE_CACHE_INVALIDATED_CHANNEL),
            `,`,
            param(JSON.stringify({ k: 'global' })),
            `)`,
          ]);

          await waitFor(() => (recorderA.global > 0 ? true : undefined));
          assert.strictEqual(recorderA.global, 1);
        } finally {
          await listenerA.shutDown();
        }
      });
    },
  );
});
