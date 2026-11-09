import QUnit from 'qunit';
const { module, test } = QUnit;
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
import { setupDB } from './helpers/index.ts';
import {
  ModuleCacheCoordinator,
  hashCoalesceKeyForAdvisoryLock,
} from '../lib/module-cache-coordination.ts';

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
  resolveURL: (reference: string, relativeTo: URL | string | undefined) =>
    new URL(reference, relativeTo),
  unresolveURL: (url: string) => url,
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
    stubVirtualNetwork,
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

async function waitUntil(
  condition: () => boolean,
  description: string,
  timeoutMs = 20_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting until ${description}`);
    }
    await new Promise((r) => setTimeout(r, 20));
  }
}

async function leaseHolders(
  dbAdapter: PgAdapter,
  coalesceKey: string,
): Promise<string[]> {
  const rows = await query(dbAdapter, [
    'SELECT holder_id FROM module_populate_leases WHERE lease_key =',
    param(hashCoalesceKeyForAdvisoryLock(coalesceKey)),
  ]);
  return rows.map((row) => String(row.holder_id));
}

module(basename(import.meta.filename), function () {
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

    test('tryAcquireAndRun: a savepoint-guarded fn write failure does not abort the lock transaction', async function (assert) {
      // A winner runs its DB work on the pinned querier inside the
      // coordinator's lock transaction. A best-effort write (like the
      // transpile cache UPSERT) that fails must NOT poison that
      // transaction, or the coordinator's pg_notify + COMMIT would fail
      // and the already-produced result would never be served. Wrapping
      // the write in a savepoint keeps the transaction usable.
      const coordinator = new ModuleCacheCoordinator({ dbAdapter });
      await coordinator.start();
      try {
        const outcome = await coordinator.tryAcquireAndRun(
          'savepoint-key',
          async (querier) => {
            await querier(['SAVEPOINT best_effort_write']);
            try {
              await querier(['SELECT * FROM table_that_does_not_exist']);
            } catch {
              // Best-effort: swallow and roll back just this statement.
              await querier(['ROLLBACK TO SAVEPOINT best_effort_write']);
            }
            // The connection must be usable again after the rollback — a
            // real follow-on write would succeed here. Issuing one proves
            // the savepoint recovered the transaction; without it this
            // query would error with "current transaction is aborted".
            const rows = await querier(['SELECT 1 AS ok']);
            return Number(rows[0].ok);
          },
        );

        // acquired:true is only returned after the coordinator's pg_notify
        // and COMMIT both ran on this same connection — a transaction left
        // aborted by the inner failure would have made those throw and
        // rejected instead. So this single assertion proves both that the
        // post-rollback query succeeded and that the lock transaction
        // committed cleanly.
        assert.deepEqual(outcome, { acquired: true, result: 1 });
      } finally {
        await coordinator.shutDown();
      }
    });

    test('tryAcquireAndRun: an unguarded fn write failure aborts the lock transaction and the winner throws', async function (assert) {
      // Documents why the savepoint above is required: without it, a
      // swallowed write failure leaves the transaction aborted, so the
      // coordinator's pg_notify + COMMIT fail and the winner rejects
      // instead of returning its result.
      const coordinator = new ModuleCacheCoordinator({ dbAdapter });
      await coordinator.start();
      try {
        await assert.rejects(
          coordinator.tryAcquireAndRun('unguarded-key', async (querier) => {
            try {
              await querier(['SELECT * FROM table_that_does_not_exist']);
            } catch {
              // Swallow like a best-effort write, but with no savepoint the
              // transaction is now aborted.
            }
            return 'returned-but-transaction-poisoned';
          }),
        );
      } finally {
        await coordinator.shutDown();
      }
    });

    test('tryLeaseAndRun: uncontended → acquired:true, fn runs, lease released, NOTIFY emitted', async function (assert) {
      const coordinator = new ModuleCacheCoordinator({ dbAdapter });
      await coordinator.start();
      const peerCoordinator = new ModuleCacheCoordinator({ dbAdapter });
      await peerCoordinator.start();
      try {
        await new Promise((r) => setTimeout(r, 100));
        // The waiter's own timeout is far longer than the NOTIFY should take,
        // so a quick wake can only be the release's notification.
        const waitStarted = Date.now();
        const waitPromise = peerCoordinator
          .waitForKey('lease-test-key', 20_000)
          .then(() => Date.now() - waitStarted);
        await new Promise((r) => setTimeout(r, 50));

        let leaseRowsDuringFn: string[] = [];
        const outcome = await coordinator.tryLeaseAndRun(
          'lease-test-key',
          60_000,
          async () => {
            leaseRowsDuringFn = await leaseHolders(dbAdapter, 'lease-test-key');
            return 'winner-result';
          },
        );
        assert.deepEqual(outcome, { acquired: true, result: 'winner-result' });
        assert.strictEqual(
          leaseRowsDuringFn.length,
          1,
          'the lease row is committed while fn runs, where peers can see it',
        );
        assert.deepEqual(
          await leaseHolders(dbAdapter, 'lease-test-key'),
          [],
          'the lease row is deleted once fn finishes',
        );
        const waited = await waitPromise;
        assert.true(
          waited < 5_000,
          `peer waiter woke on the release NOTIFY (after ${waited}ms, not its 20s timeout)`,
        );
      } finally {
        await peerCoordinator.shutDown();
        await coordinator.shutDown();
      }
    });

    test('tryLeaseAndRun: contended → second caller gets acquired:false until the holder releases', async function (assert) {
      const coordinator = new ModuleCacheCoordinator({ dbAdapter });
      await coordinator.start();
      let releaseFn!: () => void;
      const fnGate = new Promise<void>((resolve) => {
        releaseFn = resolve;
      });
      try {
        const winnerPromise = coordinator.tryLeaseAndRun(
          'lease-contention-key',
          60_000,
          async () => {
            await fnGate;
            return 'first';
          },
        );
        await new Promise((r) => setTimeout(r, 50));

        const loserOutcome = await coordinator.tryLeaseAndRun(
          'lease-contention-key',
          60_000,
          async () => {
            throw new Error('loser fn must not run');
          },
        );
        assert.deepEqual(loserOutcome, { acquired: false });

        releaseFn();
        assert.deepEqual(await winnerPromise, {
          acquired: true,
          result: 'first',
        });

        const afterRelease = await coordinator.tryLeaseAndRun(
          'lease-contention-key',
          60_000,
          async () => 'second',
        );
        assert.deepEqual(
          afterRelease,
          { acquired: true, result: 'second' },
          'the key is claimable again once its holder released it',
        );
      } finally {
        releaseFn();
        await coordinator.shutDown();
      }
    });

    test('tryLeaseAndRun: a lease left by a dead holder is claimed once it expires', async function (assert) {
      const coordinator = new ModuleCacheCoordinator({ dbAdapter });
      await coordinator.start();
      try {
        const leaseKey = hashCoalesceKeyForAdvisoryLock(
          'lease-dead-holder-key',
        );
        // A holder that died: its lease is still live, and nothing renews it.
        await query(dbAdapter, [
          'INSERT INTO module_populate_leases (lease_key, holder_id, expires_at) VALUES (',
          param(leaseKey),
          `, 'dead-holder', clock_timestamp() + interval '300 milliseconds')`,
        ]);
        const whileLive = await coordinator.tryLeaseAndRun(
          'lease-dead-holder-key',
          60_000,
          async () => {
            throw new Error('fn must not run while the lease is live');
          },
        );
        assert.deepEqual(
          whileLive,
          { acquired: false },
          'a live lease keeps the key even with nobody renewing it yet',
        );

        await new Promise((r) => setTimeout(r, 400));
        const afterExpiry = await coordinator.tryLeaseAndRun(
          'lease-dead-holder-key',
          60_000,
          async () => leaseHolders(dbAdapter, 'lease-dead-holder-key'),
        );
        assert.true(afterExpiry.acquired, 'the expired lease is claimed over');
        assert.notDeepEqual(
          afterExpiry.acquired ? afterExpiry.result : [],
          ['dead-holder'],
          'the new claim replaced the dead holder in the row',
        );
      } finally {
        await coordinator.shutDown();
      }
    });

    test('tryLeaseAndRun: a holder that lost its lease neither deletes the new claim nor wakes its waiters', async function (assert) {
      const coordinator = new ModuleCacheCoordinator({ dbAdapter });
      await coordinator.start();
      const peerCoordinator = new ModuleCacheCoordinator({ dbAdapter });
      await peerCoordinator.start();
      let releaseFn!: () => void;
      const fnGate = new Promise<void>((resolve) => {
        releaseFn = resolve;
      });
      try {
        await new Promise((r) => setTimeout(r, 100));
        const holder = coordinator.tryLeaseAndRun(
          'lease-lost-key',
          60_000,
          async () => {
            await fnGate;
            return 'stale';
          },
        );
        await new Promise((r) => setTimeout(r, 50));
        // Another process claimed the key over this holder's lapsed lease.
        await query(dbAdapter, [
          `UPDATE module_populate_leases SET holder_id = 'other-holder' WHERE lease_key =`,
          param(hashCoalesceKeyForAdvisoryLock('lease-lost-key')),
        ]);
        let woken = false;
        const waiter = peerCoordinator
          .waitForKey('lease-lost-key', 1_000)
          .then(() => {
            woken = true;
          });
        await new Promise((r) => setTimeout(r, 50));

        releaseFn();
        assert.deepEqual(await holder, { acquired: true, result: 'stale' });
        await new Promise((r) => setTimeout(r, 300));
        assert.false(
          woken,
          "the old holder's release does not wake the new holder's waiters",
        );
        assert.deepEqual(
          await leaseHolders(dbAdapter, 'lease-lost-key'),
          ['other-holder'],
          "the new holder's lease is left in place",
        );
        await waiter;
      } finally {
        releaseFn();
        await peerCoordinator.shutDown();
        await coordinator.shutDown();
      }
    });

    test('tryLeaseAndRun: a holder renews its lease for as long as fn runs', async function (assert) {
      const coordinator = new ModuleCacheCoordinator({ dbAdapter });
      await coordinator.start();
      let releaseFn!: () => void;
      const fnGate = new Promise<void>((resolve) => {
        releaseFn = resolve;
      });
      try {
        const holder = coordinator.tryLeaseAndRun(
          'lease-renewal-key',
          300,
          async () => {
            await fnGate;
            return 'long-running';
          },
        );
        // Several lease lengths: without renewal the lease would have lapsed.
        await new Promise((r) => setTimeout(r, 1_000));
        const contender = await coordinator.tryLeaseAndRun(
          'lease-renewal-key',
          300,
          async () => {
            throw new Error(
              'contender fn must not run while the holder renews',
            );
          },
        );
        assert.deepEqual(
          contender,
          { acquired: false },
          'the renewed lease still keeps the key',
        );

        releaseFn();
        assert.deepEqual(await holder, {
          acquired: true,
          result: 'long-running',
        });
        assert.deepEqual(
          await leaseHolders(dbAdapter, 'lease-renewal-key'),
          [],
        );
      } finally {
        releaseFn();
        await coordinator.shutDown();
      }
    });

    test('shutDown releases the leases this process holds and wakes their waiters', async function (assert) {
      const coordinator = new ModuleCacheCoordinator({ dbAdapter });
      await coordinator.start();
      const peerCoordinator = new ModuleCacheCoordinator({ dbAdapter });
      await peerCoordinator.start();
      let releaseFn!: () => void;
      const fnGate = new Promise<void>((resolve) => {
        releaseFn = resolve;
      });
      try {
        await new Promise((r) => setTimeout(r, 100));
        const holder = coordinator.tryLeaseAndRun(
          'lease-shutdown-key',
          60_000,
          async () => {
            await fnGate;
            return 'unfinished';
          },
        );
        await new Promise((r) => setTimeout(r, 50));
        const waitStarted = Date.now();
        const waiter = peerCoordinator
          .waitForKey('lease-shutdown-key', 20_000)
          .then(() => Date.now() - waitStarted);
        await new Promise((r) => setTimeout(r, 50));

        await coordinator.shutDown();
        assert.deepEqual(
          await leaseHolders(dbAdapter, 'lease-shutdown-key'),
          [],
          'the lease is gone while its populate is still running',
        );
        const waited = await waiter;
        assert.true(
          waited < 5_000,
          `the peer waiter woke on the shutdown release (after ${waited}ms)`,
        );

        releaseFn();
        assert.deepEqual(
          await holder,
          { acquired: true, result: 'unfinished' },
          'the populate still finishes and returns its own result',
        );
      } finally {
        releaseFn();
        await peerCoordinator.shutDown();
        await coordinator.shutDown();
      }
    });

    test('tryLeaseAndRun: a throwing fn releases the lease, wakes waiters, and rethrows', async function (assert) {
      const coordinator = new ModuleCacheCoordinator({ dbAdapter });
      await coordinator.start();
      const peerCoordinator = new ModuleCacheCoordinator({ dbAdapter });
      await peerCoordinator.start();
      try {
        await new Promise((r) => setTimeout(r, 100));
        // The waiter's own timeout is far longer than the NOTIFY should take,
        // so a quick wake can only be the release's notification.
        const waitStarted = Date.now();
        const waitPromise = peerCoordinator
          .waitForKey('lease-throw-key', 20_000)
          .then(() => Date.now() - waitStarted);
        await new Promise((r) => setTimeout(r, 50));

        await assert.rejects(
          coordinator.tryLeaseAndRun('lease-throw-key', 60_000, async () => {
            throw new Error('prerender failed');
          }),
          /prerender failed/,
        );
        assert.deepEqual(
          await leaseHolders(dbAdapter, 'lease-throw-key'),
          [],
          'the lease row is deleted after fn throws',
        );
        const waited = await waitPromise;
        assert.true(
          waited < 5_000,
          `peer waiter woke on the release NOTIFY (after ${waited}ms, not its 20s timeout)`,
        );
      } finally {
        await peerCoordinator.shutDown();
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

    test('handleReconnect wakes only the waiters whose winner no longer holds its lock', async function (assert) {
      const coordinator = new ModuleCacheCoordinator({ dbAdapter });
      await coordinator.start();
      let releaseWinner!: () => void;
      const winnerGate = new Promise<void>((resolve) => {
        releaseWinner = resolve;
      });
      try {
        // A winner still working holds the lock for 'reconnect-held-key'.
        const winner = coordinator.tryAcquireAndRun(
          'reconnect-held-key',
          async () => {
            await winnerGate;
            return 'done';
          },
        );
        await new Promise((r) => setTimeout(r, 50));

        const woken: string[] = [];
        const heldWaiter = coordinator
          .waitForKey('reconnect-held-key', 10_000)
          .then(() => woken.push('held'));
        // No one holds the lock for 'reconnect-gone-key': its winner finished
        // or died while the connection was down.
        const goneWaiter = coordinator
          .waitForKey('reconnect-gone-key', 10_000)
          .then(() => woken.push('gone'));

        await coordinator.handleReconnect();
        await goneWaiter;
        await new Promise((r) => setTimeout(r, 200));
        assert.deepEqual(
          woken,
          ['gone'],
          'the waiter with no winner wakes; the one whose winner is working keeps waiting',
        );

        releaseWinner();
        assert.deepEqual(await winner, { acquired: true, result: 'done' });
        await heldWaiter;
        assert.deepEqual(
          woken,
          ['gone', 'held'],
          "the remaining waiter wakes on its winner's notification",
        );
      } finally {
        releaseWinner();
        await coordinator.shutDown();
      }
    });

    test('handleReconnect keeps waiting on a key whose lease is live', async function (assert) {
      const coordinator = new ModuleCacheCoordinator({ dbAdapter });
      await coordinator.start();
      let releaseHolder!: () => void;
      const holderGate = new Promise<void>((resolve) => {
        releaseHolder = resolve;
      });
      try {
        const holder = coordinator.tryLeaseAndRun(
          'reconnect-leased-key',
          60_000,
          async () => {
            await holderGate;
            return 'done';
          },
        );
        await new Promise((r) => setTimeout(r, 50));

        const woken: string[] = [];
        const leasedWaiter = coordinator
          .waitForKey('reconnect-leased-key', 10_000)
          .then(() => woken.push('leased'));
        const goneWaiter = coordinator
          .waitForKey('reconnect-unleased-key', 10_000)
          .then(() => woken.push('gone'));

        await coordinator.handleReconnect();
        await goneWaiter;
        await new Promise((r) => setTimeout(r, 200));
        assert.deepEqual(
          woken,
          ['gone'],
          'the waiter with no lease holder wakes; the one whose holder is working keeps waiting',
        );

        releaseHolder();
        assert.deepEqual(await holder, { acquired: true, result: 'done' });
        await leasedWaiter;
        assert.deepEqual(
          woken,
          ['gone', 'leased'],
          "the remaining waiter wakes on its holder's release",
        );
      } finally {
        releaseHolder();
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

  // Each distinct coalesce key wins its OWN advisory lock, so a burst of
  // distinct-key callers produces that many concurrent winners — there is
  // no loser path to throttle them (the schema editor alone fetches ~31
  // distinct cold base modules in one page load). Each winner pins one
  // pool connection for its lock transaction; if its `fn` also had to
  // check out a SECOND pool client for the cache re-read + persist, then
  // once concurrent winners reach the pool ceiling every pinned
  // connection's `fn` would block waiting for a client its peers hold —
  // a self-deadlock that hangs all module serving. Threading the pinned
  // querier into `fn` keeps a coordinated load to exactly one connection,
  // so winners drain through a pool far smaller than their count. A lease
  // holder goes further and holds no connection at all while `fn` runs, so a
  // burst of definition populates leaves the pool free for the module
  // fetches their prerenders make.
  module('ModuleCacheCoordinator pool exhaustion', function (hooks) {
    let savedPoolMax: string | undefined;
    hooks.before(function () {
      savedPoolMax = process.env.PG_POOL_MAX;
      // Force a pool smaller than the concurrent-winner count below so the
      // test would deadlock if a winner needed a second connection.
      process.env.PG_POOL_MAX = '2';
    });
    hooks.after(function () {
      if (savedPoolMax === undefined) {
        delete process.env.PG_POOL_MAX;
      } else {
        process.env.PG_POOL_MAX = savedPoolMax;
      }
    });

    let dbAdapter: PgAdapter;
    setupDB(hooks, {
      before: async (adapter) => {
        dbAdapter = adapter;
      },
    });

    test('concurrent distinct-key winners doing DB work on the pinned querier do not deadlock a small pool', async function (assert) {
      const coordinator = new ModuleCacheCoordinator({ dbAdapter });
      await coordinator.start();
      try {
        const winnerCount = 5; // > PG_POOL_MAX (2)
        const runs = Array.from({ length: winnerCount }, (_unused, i) =>
          coordinator.tryAcquireAndRun(
            `pool-exhaustion-key-${i}`,
            async (querier) => {
              // DB work a winner must do while holding the lock. Routing it
              // through the pinned querier (instead of the shared dbAdapter)
              // is what keeps this to a single pool connection.
              const rows = await querier(['SELECT', param(i), '::int AS n']);
              return Number(rows[0].n);
            },
          ),
        );

        const timeout = new Promise<never>((_resolve, reject) => {
          const t = setTimeout(
            () =>
              reject(
                new Error(
                  'coordinated transpiles deadlocked: winners did not all complete — pinned querier likely not being used for fn DB work',
                ),
              ),
            20_000,
          );
          (t as { unref?: () => void }).unref?.();
        });

        const outcomes = await Promise.race([Promise.all(runs), timeout]);
        assert.deepEqual(
          outcomes
            .map((o) => (o.acquired ? o.result : 'loser'))
            .sort((a, b) => Number(a) - Number(b)),
          [0, 1, 2, 3, 4],
          'all distinct-key winners acquired and completed',
        );
      } finally {
        await coordinator.shutDown();
      }
    });

    test('concurrent distinct-key lease holders hold no pool connection while fn runs', async function (assert) {
      const coordinator = new ModuleCacheCoordinator({ dbAdapter });
      await coordinator.start();
      let releaseAll!: () => void;
      const gate = new Promise<void>((resolve) => {
        releaseAll = resolve;
      });
      try {
        const holderCount = 5; // > PG_POOL_MAX (2)
        let entered = 0;
        const runs = Array.from({ length: holderCount }, (_unused, i) =>
          coordinator.tryLeaseAndRun(
            `pool-lease-key-${i}`,
            60_000,
            async () => {
              entered++;
              await gate;
              return i;
            },
          ),
        );

        await waitUntil(
          () => entered === holderCount,
          'every lease holder entered fn while the others were still in theirs',
        );
        const rows = await query(dbAdapter, ['SELECT 1 AS ok']);
        assert.strictEqual(
          Number(rows[0].ok),
          1,
          'the pool still serves other work while every holder waits in fn',
        );

        releaseAll();
        const outcomes = await Promise.all(runs);
        assert.deepEqual(
          outcomes.map((o) => (o.acquired ? o.result : 'loser')),
          [0, 1, 2, 3, 4],
          'all distinct-key holders claimed their lease and completed',
        );
      } finally {
        releaseAll();
        await coordinator.shutDown();
      }
    });

    test('a burst of cold definition lookups holds no pool connection across its prerenders', async function (assert) {
      const realmURL = 'http://x.test/pool-burst/';
      const prerender = makeGatedPrerenderer('Burst');
      const coordinator = new ModuleCacheCoordinator({ dbAdapter });
      await coordinator.start();
      try {
        const lookup = makeLookup(
          dbAdapter,
          prerender.prerenderer,
          coordinator,
          realmURL,
        );
        const moduleURLs = Array.from(
          { length: 5 }, // > PG_POOL_MAX (2)
          (_unused, i) => `${realmURL}cards/burst-${i}.gts`,
        );
        const lookups = moduleURLs.map((url) =>
          lookup.getCachedDefinitions(url),
        );

        // Each populate reads the cache, its permissions and the loader epoch
        // before it reaches the prerenderer. All of them get there only when
        // none is holding a connection from an earlier populate's step.
        await waitUntil(
          () => moduleURLs.every((url) => prerender.callsFor(url) === 1),
          'every cold module reached its prerender while the others were in theirs',
        );
        const rows = await query(dbAdapter, ['SELECT 1 AS ok']);
        assert.strictEqual(
          Number(rows[0].ok),
          1,
          'the pool still serves other work while every populate waits on its prerender',
        );

        prerender.release();
        const entries = await Promise.all(lookups);
        assert.true(
          entries.every(Boolean),
          'every lookup returned its persisted entry',
        );
        const leftover = await query(dbAdapter, [
          'SELECT lease_key FROM module_populate_leases',
        ]);
        assert.deepEqual(leftover, [], 'no populate leaves its lease behind');
      } finally {
        prerender.release();
        await coordinator.shutDown();
      }
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
            stubVirtualNetwork,
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
