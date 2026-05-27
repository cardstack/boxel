import { module, test } from 'qunit';
import { basename } from 'path';
import type { PgAdapter } from '@cardstack/postgres';
import {
  CachingDefinitionLookup,
  MODULE_CACHE_POPULATED_CHANNEL,
  internalKeyFor,
  param,
  query,
  rri,
  trimExecutableExtension,
  type ErrorEntry,
  type ModuleDefinitionResult,
  type ModulePrerenderArgs,
  type ModuleRenderResponse,
  type Prerenderer,
  type RealmPermissions,
  type VirtualNetwork,
} from '@cardstack/runtime-common';
import { setupDB } from './helpers';
import {
  ModuleCacheCoordinator,
  hashCoalesceKeyForAdvisoryLock,
} from '../lib/module-cache-coordination';

// Lightweight helpers — these tests don't need the full
// setupPermissionedRealmsCached fixture (real realm-server, real
// prerender-server, Chrome). All they need is a real PgAdapter (for
// pg_try_advisory_xact_lock + LISTEN) and stub prerenderer wired into
// CachingDefinitionLookup. Mirrors the lightweight pattern in
// module-cache-invalidation-listener-test.ts.

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

function buildDefinition(
  moduleURL: string,
  name: string,
): ModuleDefinitionResult {
  const moduleAlias = trimExecutableExtension(rri(moduleURL));
  return {
    type: 'definition',
    moduleURL: moduleAlias,
    definition: {
      type: 'card-def',
      codeRef: { module: rri(moduleAlias), name },
      displayName: name,
      fields: {},
      fieldDefs: {},
    },
    types: [],
  };
}

function buildModuleResponse(
  moduleURL: string,
  name: string,
  deps: string[] = [],
  error?: ErrorEntry,
): ModuleRenderResponse {
  const definitionId = internalKeyFor(
    { module: rri(moduleURL), name },
    undefined,
  );
  return {
    id: moduleURL,
    status: error ? 'error' : 'ready',
    nonce: 'test-nonce',
    isShimmed: false,
    lastModified: Date.now(),
    createdAt: Date.now(),
    deps,
    definitions: error
      ? {}
      : { [definitionId]: buildDefinition(moduleURL, name) },
    error,
  };
}

interface GatedPrerendererControls {
  prerenderer: Prerenderer;
  release: () => void;
  callsFor: (url: string) => number;
}
function makeGatedPrerenderer(name: string): GatedPrerendererControls {
  let releaseGate!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });
  const calls = new Map<string, number>();
  const prerenderer: Prerenderer = {
    async prerenderModule(args: ModulePrerenderArgs) {
      calls.set(args.url, (calls.get(args.url) ?? 0) + 1);
      await gate;
      return buildModuleResponse(args.url, name);
    },
    async prerenderVisit() {
      throw new Error('prerenderVisit not used in this test');
    },
    async runCommand() {
      throw new Error('runCommand not used in this test');
    },
  };
  return {
    prerenderer,
    release: () => releaseGate(),
    callsFor: (url) => calls.get(url) ?? 0,
  };
}

function totalCalls(
  ...sets: Array<GatedPrerendererControls>
): (url: string) => number {
  return (url: string) => sets.reduce((acc, s) => acc + s.callsFor(url), 0);
}

function makeLookup(
  dbAdapter: PgAdapter,
  prerenderer: Prerenderer,
  coordinator: ModuleCacheCoordinator | undefined,
  realmURL: string,
): CachingDefinitionLookup {
  const lookup = new CachingDefinitionLookup(
    dbAdapter,
    prerenderer,
    stubVirtualNetwork,
    stubCreatePrerenderAuth,
    coordinator,
  );
  lookup.registerRealm({
    url: realmURL,
    async getRealmOwnerUserId() {
      return '@test-user:localhost';
    },
    async visibility() {
      return 'private';
    },
  });
  return lookup;
}

module(basename(__filename), function () {
  module('ModuleCacheCoordinator unit', function (hooks) {
    let dbAdapter: PgAdapter;
    setupDB(hooks, {
      beforeEach: async (adapter) => {
        dbAdapter = adapter;
      },
    });

    test('tryAcquireAndRun: uncontended → acquired:true, fn runs, NOTIFY emitted', async function (assert) {
      const coordinator = new ModuleCacheCoordinator({ dbAdapter });
      await coordinator.start();
      try {
        // Attach a second coordinator to act as the listening peer so
        // we can observe the NOTIFY going out without coupling to a
        // CachingDefinitionLookup.
        const peerCoordinator = new ModuleCacheCoordinator({ dbAdapter });
        await peerCoordinator.start();
        try {
          await new Promise((r) => setTimeout(r, 100));
          let resolved = false;
          // Park a peer waiter on the same key. If the winner's NOTIFY
          // fires inside the same tx as the lock, the peer waiter
          // resolves on commit.
          const waitPromise = peerCoordinator
            .waitForKey('coalesce-test-key', 5000)
            .then(() => {
              resolved = true;
            });

          await new Promise((r) => setTimeout(r, 50));

          const outcome = await coordinator.tryAcquireAndRun(
            'coalesce-test-key',
            async () => 'winner-result',
          );
          assert.deepEqual(outcome, {
            acquired: true,
            result: 'winner-result',
          });
          await waitPromise;
          assert.true(resolved, 'peer waiter resolved on winner NOTIFY');
        } finally {
          await peerCoordinator.shutDown();
        }
      } finally {
        await coordinator.shutDown();
      }
    });

    test('tryAcquireAndRun: contended → second caller gets acquired:false', async function (assert) {
      const coordinator = new ModuleCacheCoordinator({ dbAdapter });
      await coordinator.start();
      try {
        let releaseFn!: () => void;
        const fnGate = new Promise<void>((resolve) => {
          releaseFn = resolve;
        });

        const winnerPromise = coordinator.tryAcquireAndRun(
          'contention-key',
          async () => {
            await fnGate;
            return 'first';
          },
        );
        // Yield so winner's BEGIN + try-lock have a chance to commit
        // the lock-acquired state before we contend.
        await new Promise((r) => setTimeout(r, 50));

        const loserOutcome = await coordinator.tryAcquireAndRun(
          'contention-key',
          async () => {
            throw new Error('loser fn must not run');
          },
        );
        assert.deepEqual(loserOutcome, { acquired: false });

        releaseFn();
        const winnerOutcome = await winnerPromise;
        assert.deepEqual(winnerOutcome, {
          acquired: true,
          result: 'first',
        });
      } finally {
        await coordinator.shutDown();
      }
    });

    test('waitForKey: resolves on NOTIFY before timeout', async function (assert) {
      const coordinator = new ModuleCacheCoordinator({ dbAdapter });
      await coordinator.start();
      try {
        await new Promise((r) => setTimeout(r, 100));
        const start = Date.now();
        const waitPromise = coordinator.waitForKey('notify-key', 5000);
        // Yield, then send a manual NOTIFY for the key. Payload is the
        // bounded hash, matching what tryAcquireAndRun emits.
        await new Promise((r) => setTimeout(r, 50));
        await query(dbAdapter, [
          'SELECT pg_notify(',
          param(MODULE_CACHE_POPULATED_CHANNEL),
          ',',
          param(hashCoalesceKeyForAdvisoryLock('notify-key')),
          ')',
        ]);
        await waitPromise;
        const elapsed = Date.now() - start;
        assert.ok(
          elapsed < 4500,
          `waitForKey resolved on NOTIFY (took ${elapsed}ms; far below 5000ms timeout)`,
        );
      } finally {
        await coordinator.shutDown();
      }
    });

    test('waitForKey: resolves on timeout when no NOTIFY arrives', async function (assert) {
      const coordinator = new ModuleCacheCoordinator({ dbAdapter });
      await coordinator.start();
      try {
        await new Promise((r) => setTimeout(r, 100));
        const start = Date.now();
        await coordinator.waitForKey('never-notified-key', 200);
        const elapsed = Date.now() - start;
        assert.ok(
          elapsed >= 180,
          `waitForKey waited at least ~timeoutMs (got ${elapsed}ms; expected ≥180)`,
        );
        assert.ok(
          elapsed < 1500,
          `waitForKey did not significantly overshoot timeoutMs (got ${elapsed}ms)`,
        );
      } finally {
        await coordinator.shutDown();
      }
    });

    test('waitForKey: NOTIFY for an unrelated key does not resolve', async function (assert) {
      const coordinator = new ModuleCacheCoordinator({ dbAdapter });
      await coordinator.start();
      try {
        await new Promise((r) => setTimeout(r, 100));
        let resolved = false;
        const wait = coordinator.waitForKey('target-key', 400).then(() => {
          resolved = true;
        });
        await new Promise((r) => setTimeout(r, 50));
        await query(dbAdapter, [
          'SELECT pg_notify(',
          param(MODULE_CACHE_POPULATED_CHANNEL),
          ',',
          param(hashCoalesceKeyForAdvisoryLock('different-key')),
          ')',
        ]);
        // Give the dispatch a moment to (correctly) NOT match.
        await new Promise((r) => setTimeout(r, 100));
        assert.false(
          resolved,
          'waiter not resolved by NOTIFY for an unrelated key',
        );
        // Now let the timeout fire.
        await wait;
        assert.true(resolved, 'waiter eventually resolved on its own timeout');
      } finally {
        await coordinator.shutDown();
      }
    });

    test('shutDown resolves any parked waiters so callers do not hang', async function (assert) {
      const coordinator = new ModuleCacheCoordinator({ dbAdapter });
      await coordinator.start();
      await new Promise((r) => setTimeout(r, 100));
      let resolved = false;
      const wait = coordinator.waitForKey('shutdown-key', 60_000).then(() => {
        resolved = true;
      });
      await new Promise((r) => setTimeout(r, 50));
      await coordinator.shutDown();
      await wait;
      assert.true(resolved, 'parked waiter resolved on shutdown');
    });
  });

  module(
    'CachingDefinitionLookup coordinated path (integration)',
    function (hooks) {
      let dbAdapter: PgAdapter;
      const realmURL = 'http://x.test/coalesce/';

      setupDB(hooks, {
        beforeEach: async (adapter) => {
          dbAdapter = adapter;
        },
      });

      test('two instances + concurrent lookup of same module → exactly one prerender call (peer wins, other re-reads)', async function (assert) {
        const moduleURL = `${realmURL}cards/foo.gts`;
        const aPrerender = makeGatedPrerenderer('Foo');
        const bPrerender = makeGatedPrerenderer('Foo');
        const total = totalCalls(aPrerender, bPrerender);

        const coordinatorA = new ModuleCacheCoordinator({ dbAdapter });
        await coordinatorA.start();
        const coordinatorB = new ModuleCacheCoordinator({ dbAdapter });
        await coordinatorB.start();
        try {
          await new Promise((r) => setTimeout(r, 100));

          const lookupA = makeLookup(
            dbAdapter,
            aPrerender.prerenderer,
            coordinatorA,
            realmURL,
          );
          const lookupB = makeLookup(
            dbAdapter,
            bPrerender.prerenderer,
            coordinatorB,
            realmURL,
          );

          // A starts first. A's prerender will gate. While A holds the
          // lock + is awaiting the gate, B issues its lookup; B contends
          // the lock, observes acquired:false, parks on NOTIFY.
          const pA = lookupA.getCachedDefinitions(moduleURL);
          await new Promise((r) => setTimeout(r, 100));
          const pB = lookupB.getCachedDefinitions(moduleURL);
          await new Promise((r) => setTimeout(r, 100));

          // At this point: A is awaiting the gate (one prerender call
          // recorded on A), B is parked on NOTIFY (zero prerender calls
          // on B). Release A.
          assert.strictEqual(
            aPrerender.callsFor(moduleURL),
            1,
            'A had one prerender call queued before release',
          );
          assert.strictEqual(
            bPrerender.callsFor(moduleURL),
            0,
            'B did not call its prerenderer (parked on NOTIFY)',
          );

          aPrerender.release();
          bPrerender.release(); // harmless — never reached on B

          const [entryA, entryB] = await Promise.all([pA, pB]);
          assert.ok(entryA, 'A returned a populated entry');
          assert.ok(entryB, 'B returned a populated entry');
          const definitionId = internalKeyFor(
            { module: rri(moduleURL), name: 'Foo' },
            undefined,
          );
          const defA = entryA?.definitions[definitionId];
          const defB = entryB?.definitions[definitionId];
          const defAHasFoo = Boolean(
            defA &&
            'definition' in defA &&
            defA.definition.displayName === 'Foo',
          );
          const defBHasFoo = Boolean(
            defB &&
            'definition' in defB &&
            defB.definition.displayName === 'Foo',
          );
          assert.ok(defAHasFoo, 'A entry has the Foo definition');
          assert.ok(defBHasFoo, 'B entry has the Foo definition');

          assert.strictEqual(
            total(moduleURL),
            1,
            'exactly one prerenderer call across both instances',
          );
        } finally {
          await coordinatorA.shutDown();
          await coordinatorB.shutDown();
        }
      });

      test('coordinator-less single instance still works (sqlite/in-memory deployment path)', async function (assert) {
        // Smoke test: the original uncoordinated path still runs when no
        // coordinator is provided. This is the path every existing test
        // exercises; we replicate one minimal case here to guard against
        // a CS-10953 refactor accidentally requiring the coordinator.
        const moduleURL = `${realmURL}cards/single.gts`;
        const aPrerender = makeGatedPrerenderer('Single');
        const lookup = makeLookup(
          dbAdapter,
          aPrerender.prerenderer,
          undefined,
          realmURL,
        );
        const p = lookup.getCachedDefinitions(moduleURL);
        await new Promise((r) => setTimeout(r, 50));
        aPrerender.release();
        const entry = await p;
        assert.ok(entry, 'returned an entry');
        assert.strictEqual(
          aPrerender.callsFor(moduleURL),
          1,
          'prerenderer called once on coordinator-less path',
        );
      });

      test('cache-hit short-circuits before contending the lock', async function (assert) {
        // First instance writes the row. Second instance with its own
        // coordinator should hit the cache and never reach the
        // prerenderer or the lock.
        const moduleURL = `${realmURL}cards/cached.gts`;
        const aPrerender = makeGatedPrerenderer('Cached');
        const coordinatorA = new ModuleCacheCoordinator({ dbAdapter });
        await coordinatorA.start();
        try {
          await new Promise((r) => setTimeout(r, 100));
          const lookupA = makeLookup(
            dbAdapter,
            aPrerender.prerenderer,
            coordinatorA,
            realmURL,
          );
          const pA = lookupA.getCachedDefinitions(moduleURL);
          await new Promise((r) => setTimeout(r, 50));
          aPrerender.release();
          await pA;

          // Now a fresh instance B looks up the same URL. B's
          // prerenderer should never be called.
          const bPrerender = makeGatedPrerenderer('CachedNeverCalled');
          const coordinatorB = new ModuleCacheCoordinator({ dbAdapter });
          await coordinatorB.start();
          try {
            await new Promise((r) => setTimeout(r, 100));
            const lookupB = makeLookup(
              dbAdapter,
              bPrerender.prerenderer,
              coordinatorB,
              realmURL,
            );
            const entryB = await lookupB.getCachedDefinitions(moduleURL);
            assert.ok(entryB, 'B returned the cached entry');
            assert.strictEqual(
              bPrerender.callsFor(moduleURL),
              0,
              'B never called its prerenderer (cache hit on optimistic read)',
            );
          } finally {
            await coordinatorB.shutDown();
          }
        } finally {
          await coordinatorA.shutDown();
        }
      });
    },
  );
});
