import { module, test } from 'qunit';
import { basename, join } from 'path';
import { ensureDirSync, writeFileSync, writeJSONSync } from 'fs-extra';
import sinon from 'sinon';
import { dirSync } from 'tmp';
import type { SuperTest, Test } from 'supertest';
import type { RealmHttpServer as Server } from '../server';
import type { Realm } from '@cardstack/runtime-common';
import {
  CachingDefinitionLookup,
  SupportedMimeType,
  param,
  query,
  userInitiatedPriority,
} from '@cardstack/runtime-common';
import type { PgAdapter } from '@cardstack/postgres';
import { ModuleCacheCoordinator } from '../lib/module-cache-coordination';
import { RealmFileChangesListener } from '../lib/realm-file-changes-listener';
import {
  setupPermissionedRealmCached,
  setupDB,
  createJWT,
  createRealm,
  createVirtualNetwork,
  getTestPrerenderer,
  testCreatePrerenderAuth,
  withRealmPath,
  type RealmRequest,
} from './helpers';

// CS-11028: regression coverage for the persist-after-invalidate race in
// Realm.#transpiledModuleCache. The scenario: reader A enters fallbackHandle for
// foo.gts, snapshots the module-cache generation, then awaits transpileJS
// (50–500 ms). While A is in-flight, invalidateCache(foo.gts) runs —
// synchronously bumping the per-path generation and clearing whatever was
// in the cache (a no-op if A hadn't filled it yet). Without the fix A's
// post-transpile #transpiledModuleCache.set re-fills the slot with pre-invalidation
// bytes, so the next reader sees stale code until something else triggers
// another invalidate. The fix snapshots the generation BEFORE the first
// await and discards the cache write when the generation moved.
//
// The tests below race a real .gts transpile against invalidateCache /
// __testOnlyClearCaches by firing the request, waiting a generous slice
// (50 ms) for fallbackHandle to reach its snapshot and enter transpileJS,
// then issuing the invalidate synchronously. .gts transpiles are
// reliably > 50 ms (babel + ember-template-compilation + decorator
// transforms + scoped-css), so the invalidate lands inside the race
// window. The observable assertion is on the subsequent request's
// `x-boxel-cache` header — a miss proves A's cache write was discarded.
module(basename(__filename), function () {
  module(
    'Realm.#transpiledModuleCache invalidate-during-transpile race',
    function (hooks) {
      let realmURL = new URL('http://127.0.0.1:4444/test/');
      let testRealm: Realm;
      let request: RealmRequest;

      function onRealmSetup(args: {
        testRealm: Realm;
        testRealmHttpServer: Server;
        request: SuperTest<Test>;
      }) {
        testRealm = args.testRealm;
        request = withRealmPath(args.request, realmURL);
      }

      setupPermissionedRealmCached(hooks, {
        fixture: 'blank',
        realmURL,
        permissions: {
          '*': ['read', 'write'],
          user: ['read', 'write', 'realm-owner'],
          '@node-test_realm:localhost': ['read', 'realm-owner'],
        },
        onRealmSetup,
      });

      const transpilerHeavySource = `
      import { contains, field, CardDef, Component } from "https://cardstack.com/base/card-api";
      import StringField from "https://cardstack.com/base/string";

      export class RaceCard extends CardDef {
        @field name = contains(StringField);
        @field title = contains(StringField);
        static isolated = class Isolated extends Component<typeof this> {
          <template>
            <div data-test-race-isolated>
              <h1><@fields.name/></h1>
              <h2><@fields.title/></h2>
            </div>
          </template>
        }
        static embedded = class Embedded extends Component<typeof this> {
          <template>
            <span data-test-race-embedded><@fields.name/></span>
          </template>
        }
      }
    `;

      function authHeader() {
        return `Bearer ${createJWT(testRealm, 'user', ['read', 'write'])}`;
      }

      // supertest's Test is a thenable — the HTTP request fires the first
      // time .then() is called. Adding an identity .then() now forces the
      // dispatch so the caller can race other work against the in-flight
      // request instead of waiting for an `await` to start it.
      function fireRequest(path: string): Promise<unknown> {
        return request
          .get(`/${path}`)
          .set('Accept', SupportedMimeType.All)
          .set('Authorization', authHeader())
          .then((r) => r);
      }

      test('in-flight transpile result is dropped when invalidateCache fires concurrently', async function (assert) {
        let modulePath = 'race-invalidate.gts';
        await testRealm.write(modulePath, transpilerHeavySource);
        testRealm.__testOnlyClearCaches();

        let inflight = fireRequest(modulePath);
        // Wait long enough for fallbackHandle to reach its snapshot and
        // enter transpileJS. .gts transpiles take 50–500 ms; 50 ms is a
        // comfortable window for the request to reach the snapshot point.
        await new Promise((resolve) => setTimeout(resolve, 50));

        // Invalidate mid-transpile. The generation counter bumps; A's
        // post-transpile #transpiledModuleCache.set will compare its snapshot against
        // the now-bumped counter and skip the write.
        testRealm.invalidateCache(modulePath);

        let response = (await inflight) as { status: number };
        assert.strictEqual(
          response.status,
          200,
          'in-flight request still serves pre-invalidation bytes — the response is a function of what A read at request time',
        );

        let nextResponse = await request
          .get(`/${modulePath}`)
          .set('Accept', SupportedMimeType.All)
          .set('Authorization', authHeader());

        assert.strictEqual(
          nextResponse.headers['x-boxel-cache'],
          'miss',
          'next request is a cache miss — A’s pre-invalidation transpile did not re-fill the slot invalidate cleared',
        );
      });

      test('invalidateCache of an unrelated path does not drop the in-flight cache write', async function (assert) {
        let primaryPath = 'race-primary.gts';
        let unrelatedPath = 'race-unrelated.gts';
        await testRealm.write(primaryPath, transpilerHeavySource);
        await testRealm.write(unrelatedPath, transpilerHeavySource);
        testRealm.__testOnlyClearCaches();

        let inflight = fireRequest(primaryPath);
        await new Promise((resolve) => setTimeout(resolve, 50));

        // Invalidate a DIFFERENT path mid-transpile. The per-path counter
        // for primaryPath is unchanged, so A's cache.set proceeds normally.
        testRealm.invalidateCache(unrelatedPath);

        let response = (await inflight) as { status: number };
        assert.strictEqual(response.status, 200);

        let nextResponse = await request
          .get(`/${primaryPath}`)
          .set('Accept', SupportedMimeType.All)
          .set('Authorization', authHeader());

        assert.strictEqual(
          nextResponse.headers['x-boxel-cache'],
          'hit',
          'cross-path invalidate did not poison the in-flight cache write — per-path scoping is correct',
        );
      });

      test('in-flight transpile to an extensionless alias is dropped when invalidateCache targets the canonical path', async function (assert) {
        // getFileWithFallbacks lets a request for /race-alias resolve to
        // race-alias.gts. The cache entry is then stored under "race-alias"
        // (the request's localPath) but its canonicalPath is "race-alias.gts".
        // invalidateCache fires against the canonical, so the discard
        // check has to compare snapshot vs current generation for the
        // canonical path — checking only localPath would miss the race
        // and leave the "race-alias" alias serving stale bytes.
        let canonicalPath = 'race-alias.gts';
        let aliasPath = 'race-alias';
        await testRealm.write(canonicalPath, transpilerHeavySource);
        testRealm.__testOnlyClearCaches();

        let inflight = fireRequest(aliasPath);
        await new Promise((resolve) => setTimeout(resolve, 50));

        testRealm.invalidateCache(canonicalPath);

        let response = (await inflight) as { status: number };
        assert.strictEqual(response.status, 200);

        // Next request to the extensionless alias: must be a cache miss.
        // Without the canonical-aware discard check this comes back as
        // 'hit' because the pre-invalidation transpile re-filled the
        // alias slot.
        let aliasResponse = await request
          .get(`/${aliasPath}`)
          .set('Accept', SupportedMimeType.All)
          .set('Authorization', authHeader());
        assert.strictEqual(
          aliasResponse.headers['x-boxel-cache'],
          'miss',
          'alias request is a cache miss — the canonical-aware discard caught the race',
        );

        // The canonical request side already worked before this fix
        // (#transpiledModuleCache.invalidate cleared the canonical entry), but
        // verify it still misses so the fix doesn't regress it.
        let canonicalResponse = await request
          .get(`/${canonicalPath}`)
          .set('Accept', SupportedMimeType.All)
          .set('Authorization', authHeader());
        assert.strictEqual(
          canonicalResponse.headers['x-boxel-cache'],
          'miss',
          'canonical request is a cache miss too — fresh transpile served',
        );
      });

      test('in-flight transpile result is dropped when testRealm.write fires concurrently (user-visible bug)', async function (assert) {
        // The original bug report: "file edited and saved, host page reload
        // serves the pre-edit module bytes." A user write goes through
        // writeMany, which used to mutate #transpiledModuleCache directly without
        // bumping the generation counter — letting an in-flight transpile's
        // post-await cache.set silently fill the slot writeMany just
        // cleared. This test exercises the same code path the user does.
        let modulePath = 'race-write.gts';
        await testRealm.write(modulePath, transpilerHeavySource);
        testRealm.__testOnlyClearCaches();

        let inflight = fireRequest(modulePath);
        await new Promise((resolve) => setTimeout(resolve, 50));

        // The "user edits the file" path: writeMany bumps the path's
        // generation and clears the cache entry. A's transpile (in flight
        // against pre-edit bytes) must drop its cache.set.
        await testRealm.write(
          modulePath,
          transpilerHeavySource.replace('RaceCard', 'EditedCard'),
        );

        let response = (await inflight) as { status: number };
        assert.strictEqual(response.status, 200);

        let nextResponse = await request
          .get(`/${modulePath}`)
          .set('Accept', SupportedMimeType.All)
          .set('Authorization', authHeader());

        assert.strictEqual(
          nextResponse.headers['x-boxel-cache'],
          'miss',
          'next request is a cache miss — the pre-edit transpile did not re-fill the slot writeMany cleared',
        );
      });

      test('in-flight transpile result is dropped when __testOnlyClearCaches fires concurrently', async function (assert) {
        let modulePath = 'race-clear.gts';
        await testRealm.write(modulePath, transpilerHeavySource);
        testRealm.__testOnlyClearCaches();

        let inflight = fireRequest(modulePath);
        await new Promise((resolve) => setTimeout(resolve, 50));

        // Global wipe mid-transpile. The path-level counter is reset to 0
        // alongside A's snapshot value, so only the global counter
        // distinguishes pre/post-wipe — that's what catches the race here.
        testRealm.__testOnlyClearCaches();

        let response = (await inflight) as { status: number };
        assert.strictEqual(response.status, 200);

        let nextResponse = await request
          .get(`/${modulePath}`)
          .set('Accept', SupportedMimeType.All)
          .set('Authorization', authHeader());

        assert.strictEqual(
          nextResponse.headers['x-boxel-cache'],
          'miss',
          'next request is a cache miss — the global generation bump catches the race that the path counter alone would miss',
        );
      });
    },
  );

  // CS-11029: concurrent same-path readers used to each independently call
  // transpileJS (50–500 ms of babel + ember-template-compilation +
  // decorator transforms). The in-flight dedup map coalesces them onto a
  // single transpile; later waiters await the same promise. The realm
  // tracks a monotonic transpile counter exposed via
  // __testOnlyGetTranspileCallCount so the tests can assert "exactly one
  // transpile call" directly rather than inferring it from timing.
  module(
    'Realm.#transpiledModuleCache in-flight transpile dedup',
    function (hooks) {
      let realmURL = new URL('http://127.0.0.1:4444/test/');
      let testRealm: Realm;
      let request: RealmRequest;

      function onRealmSetup(args: {
        testRealm: Realm;
        testRealmHttpServer: Server;
        request: SuperTest<Test>;
      }) {
        testRealm = args.testRealm;
        request = withRealmPath(args.request, realmURL);
      }

      setupPermissionedRealmCached(hooks, {
        fixture: 'blank',
        realmURL,
        permissions: {
          '*': ['read', 'write'],
          user: ['read', 'write', 'realm-owner'],
          '@node-test_realm:localhost': ['read', 'realm-owner'],
        },
        onRealmSetup,
      });

      const transpilerHeavySource = `
      import { contains, field, CardDef, Component } from "https://cardstack.com/base/card-api";
      import StringField from "https://cardstack.com/base/string";

      export class DedupCard extends CardDef {
        @field name = contains(StringField);
        static isolated = class Isolated extends Component<typeof this> {
          <template>
            <div data-test-dedup><@fields.name/></div>
          </template>
        }
      }
    `;

      function authHeader() {
        return `Bearer ${createJWT(testRealm, 'user', ['read', 'write'])}`;
      }

      function fireRequest(path: string): Promise<{ status: number }> {
        return request
          .get(`/${path}`)
          .set('Accept', SupportedMimeType.All)
          .set('Authorization', authHeader())
          .then((r) => r as { status: number });
      }

      // Poll the realm's in-flight counter until it matches `expected`,
      // up to `timeoutMs`. Fixed-time setTimeout()s are unreliable in CI
      // — request startup latency can exceed the wait window — so the
      // tests below use this helper together with __testOnlyDelayTranspile
      // to deterministically observe inflight state without racing real
      // .gts transpile timing.
      async function waitForInflight(
        expected: number,
        timeoutMs = 5000,
      ): Promise<void> {
        let deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          if (testRealm.__testOnlyGetInFlightTranspileCount() === expected) {
            return;
          }
          await new Promise((r) => setTimeout(r, 5));
        }
        throw new Error(
          `timed out waiting for in-flight count to reach ${expected}; saw ${testRealm.__testOnlyGetInFlightTranspileCount()}`,
        );
      }

      test('N concurrent same-path readers trigger exactly one transpile call', async function (assert) {
        let modulePath = 'dedup-same-path.gts';
        await testRealm.write(modulePath, transpilerHeavySource);
        testRealm.__testOnlyClearCaches();

        let before = testRealm.__testOnlyGetTranspileCallCount();
        let responses = await Promise.all([
          fireRequest(modulePath),
          fireRequest(modulePath),
          fireRequest(modulePath),
        ]);
        let delta = testRealm.__testOnlyGetTranspileCallCount() - before;

        assert.deepEqual(
          responses.map((r) => r.status),
          [200, 200, 200],
          'all three concurrent same-path requests succeed',
        );
        assert.strictEqual(
          delta,
          1,
          'exactly one transpileJS call serviced three concurrent same-path readers',
        );
        assert.strictEqual(
          testRealm.__testOnlyGetInFlightTranspileCount(),
          0,
          'in-flight slot released after the shared transpile settled',
        );
      });

      test('concurrent different-path readers each trigger their own transpile (no false coalesce)', async function (assert) {
        let pathA = 'dedup-a.gts';
        let pathB = 'dedup-b.gts';
        await testRealm.write(pathA, transpilerHeavySource);
        await testRealm.write(pathB, transpilerHeavySource);
        testRealm.__testOnlyClearCaches();

        let before = testRealm.__testOnlyGetTranspileCallCount();
        let responses = await Promise.all([
          fireRequest(pathA),
          fireRequest(pathB),
        ]);
        let delta = testRealm.__testOnlyGetTranspileCallCount() - before;

        assert.deepEqual(
          responses.map((r) => r.status),
          [200, 200],
          'both different-path requests succeed',
        );
        assert.strictEqual(
          delta,
          2,
          'each distinct path triggers its own transpile — no cross-path false coalesce',
        );
      });

      test('in-flight entry survives an unrelated path’s invalidate', async function (assert) {
        let primaryPath = 'dedup-primary.gts';
        let unrelatedPath = 'dedup-unrelated.gts';
        await testRealm.write(primaryPath, transpilerHeavySource);
        await testRealm.write(unrelatedPath, transpilerHeavySource);
        testRealm.__testOnlyClearCaches();

        // Park transpile at a gate so the inflight state is deterministic.
        let releaseGate: () => void = () => {};
        let gate = new Promise<void>((r) => {
          releaseGate = r;
        });
        testRealm.__testOnlyDelayTranspile(() => gate);

        try {
          let before = testRealm.__testOnlyGetTranspileCallCount();
          let primaryInflight = fireRequest(primaryPath);
          await waitForInflight(1);
          assert.strictEqual(
            testRealm.__testOnlyGetInFlightTranspileCount(),
            1,
            'primary path has an in-flight entry',
          );

          // Invalidate an unrelated path — should not affect primary's entry.
          testRealm.invalidateCache(unrelatedPath);
          assert.strictEqual(
            testRealm.__testOnlyGetInFlightTranspileCount(),
            1,
            'unrelated invalidate did not drop the primary in-flight entry',
          );

          // Release primary so we can verify the end-state. A second
          // concurrent caller while the gate was held would have joined
          // primary's pending — covered by the "N concurrent same-path"
          // test above; here we just confirm primary's transpile
          // completes normally after the unrelated invalidate.
          releaseGate();
          await primaryInflight;
          let delta = testRealm.__testOnlyGetTranspileCallCount() - before;
          assert.strictEqual(
            delta,
            1,
            'primary transpiled once — unrelated invalidate did not force a redo',
          );
        } finally {
          testRealm.__testOnlyDelayTranspile(undefined);
        }
      });

      test('in-flight entry is dropped when its own path is invalidated; later caller starts a fresh transpile', async function (assert) {
        let modulePath = 'dedup-self-invalidate.gts';
        await testRealm.write(modulePath, transpilerHeavySource);
        testRealm.__testOnlyClearCaches();

        // Both transpiles will await the same gate — releasing it lets
        // both proceed and complete. The first transpile was orphaned
        // from the map by invalidateCache; the second installed a fresh
        // entry. Their .finally identity checks operate on their own
        // captured `pending` references, so both clean up correctly.
        let releaseGate: () => void = () => {};
        let gate = new Promise<void>((r) => {
          releaseGate = r;
        });
        testRealm.__testOnlyDelayTranspile(() => gate);

        try {
          let before = testRealm.__testOnlyGetTranspileCallCount();
          let firstInflight = fireRequest(modulePath);
          await waitForInflight(1);

          // Invalidate the path — drops the in-flight entry from the
          // map. firstInflight's promise is still alive at the gate.
          testRealm.invalidateCache(modulePath);
          assert.strictEqual(
            testRealm.__testOnlyGetInFlightTranspileCount(),
            0,
            'in-flight entry dropped by invalidateCache',
          );

          // A caller arriving after the invalidate must not join the
          // dropped pending; it should install a fresh entry.
          let secondInflight = fireRequest(modulePath);
          await waitForInflight(1);
          assert.strictEqual(
            testRealm.__testOnlyGetInFlightTranspileCount(),
            1,
            'second caller installed its own fresh in-flight entry',
          );

          releaseGate();
          await firstInflight;
          await secondInflight;
          let delta = testRealm.__testOnlyGetTranspileCallCount() - before;
          assert.strictEqual(
            delta,
            2,
            'invalidate forced a second transpile — the dropped slot is not joined by post-invalidate callers',
          );
        } finally {
          testRealm.__testOnlyDelayTranspile(undefined);
        }
      });

      test('identity-checked cleanup: A in-flight + invalidate + B in-flight + A settles → B survives', async function (assert) {
        let modulePath = 'dedup-identity.gts';
        await testRealm.write(modulePath, transpilerHeavySource);
        testRealm.__testOnlyClearCaches();

        // Independent gates per call so A and B can be released
        // separately. The hook routes by call index rather than a
        // mutable `currentGate` reference — `waitForInflight` only
        // confirms the in-flight slot is set, which happens BEFORE the
        // transpile hook fires, so A may still be racing toward the
        // hook when the test swaps the gate. Call-index routing plus
        // explicit hook-entry signals make the test order deterministic
        // under CI load.
        let releaseA: () => void = () => {};
        let gateA = new Promise<void>((r) => {
          releaseA = r;
        });
        let releaseB: () => void = () => {};
        let gateB = new Promise<void>((r) => {
          releaseB = r;
        });
        let signalAEntered: () => void = () => {};
        let aEntered = new Promise<void>((r) => {
          signalAEntered = r;
        });
        let signalBEntered: () => void = () => {};
        let bEntered = new Promise<void>((r) => {
          signalBEntered = r;
        });
        let hookCalls = 0;
        testRealm.__testOnlyDelayTranspile(() => {
          hookCalls += 1;
          if (hookCalls === 1) {
            signalAEntered();
            return gateA;
          }
          signalBEntered();
          return gateB;
        });

        try {
          let pendingA = fireRequest(modulePath);
          // Wait until A is actually parked at gateA — not just until
          // the in-flight slot is set. Otherwise the invalidate below
          // can race A's hook invocation.
          await aEntered;
          assert.strictEqual(
            testRealm.__testOnlyGetInFlightTranspileCount(),
            1,
            'A installed its in-flight entry',
          );

          // Invalidate drops A from the map. A is still parked at gateA.
          testRealm.invalidateCache(modulePath);
          assert.strictEqual(
            testRealm.__testOnlyGetInFlightTranspileCount(),
            0,
            'invalidate dropped A from the map',
          );

          let pendingB = fireRequest(modulePath);
          await bEntered;
          assert.strictEqual(
            testRealm.__testOnlyGetInFlightTranspileCount(),
            1,
            'B installed a fresh in-flight entry after invalidate dropped A',
          );

          // Release A. Its .finally identity check: map has B's pending,
          // not A's — so it must NOT delete the slot.
          releaseA();
          await pendingA;
          assert.strictEqual(
            testRealm.__testOnlyGetInFlightTranspileCount(),
            1,
            'B’s in-flight entry survives A’s settle (identity check held)',
          );

          // Release B. Its .finally identity check passes; slot cleaned up.
          releaseB();
          await pendingB;
          assert.strictEqual(
            testRealm.__testOnlyGetInFlightTranspileCount(),
            0,
            'B’s in-flight entry cleaned up after B settled',
          );
        } finally {
          testRealm.__testOnlyDelayTranspile(undefined);
        }
      });

      test('errored transpile is shared with concurrent waiters and the in-flight slot releases on rejection', async function (assert) {
        let modulePath = 'dedup-error.gts';
        // Syntactically invalid .gts source — transpileJS will throw.
        await testRealm.write(
          modulePath,
          'this is not a valid gts file <template>oops</template>',
        );
        testRealm.__testOnlyClearCaches();

        let before = testRealm.__testOnlyGetTranspileCallCount();
        let [resA, resB] = await Promise.all([
          fireRequest(modulePath),
          fireRequest(modulePath),
        ]);
        let deltaShared = testRealm.__testOnlyGetTranspileCallCount() - before;

        assert.strictEqual(
          resA.status,
          406,
          'first errored request returns a transpile-failed response',
        );
        assert.strictEqual(
          resB.status,
          406,
          'concurrent waiter shares the same error response',
        );
        assert.strictEqual(
          deltaShared,
          1,
          'concurrent waiters shared exactly one transpile attempt — the rejection propagates without a second babel pass',
        );

        // After both fail, the in-flight slot must release so a fresh
        // caller re-attempts transpile against current source.
        let resC = await fireRequest(modulePath);
        assert.strictEqual(resC.status, 406);
        let deltaAfter = testRealm.__testOnlyGetTranspileCallCount() - before;
        assert.strictEqual(
          deltaAfter,
          2,
          'subsequent caller triggers a fresh transpile attempt — error did not pin the in-flight slot',
        );
      });
    },
  );

  // CS-11030: the L2 cross-process cache lives in module_transpile_cache.
  // A request that misses L1 (in-memory) writes the transpiled bytes to
  // L2 after babel finishes; a peer realm-server with its own in-memory
  // miss can read the row instead of re-running babel. Invalidation
  // paths drop the L2 row alongside L1. These tests exercise the read /
  // write / delete paths from one realm — the coordinator's two-instance
  // coalesce behavior is exercised by module-cache-coordination-test.ts
  // and reused via the shared MODULE_CACHE_POPULATED_CHANNEL.
  module(
    'Realm.#transpiledModuleCache L2 module_transpile_cache (DB-backed)',
    function (hooks) {
      let realmURL = new URL('http://127.0.0.1:4444/test/');
      let testRealm: Realm;
      let request: RealmRequest;
      let dbAdapter: PgAdapter;

      function onRealmSetup(args: {
        testRealm: Realm;
        testRealmHttpServer: Server;
        request: SuperTest<Test>;
        dbAdapter: PgAdapter;
      }) {
        testRealm = args.testRealm;
        request = withRealmPath(args.request, realmURL);
        dbAdapter = args.dbAdapter;
      }

      setupPermissionedRealmCached(hooks, {
        fixture: 'blank',
        realmURL,
        permissions: {
          '*': ['read', 'write'],
          user: ['read', 'write', 'realm-owner'],
          '@node-test_realm:localhost': ['read', 'realm-owner'],
        },
        onRealmSetup,
      });

      const transpilerHeavySource = `
        import { contains, field, CardDef, Component } from "https://cardstack.com/base/card-api";
        import StringField from "https://cardstack.com/base/string";

        export class L2Card extends CardDef {
          @field name = contains(StringField);
          static isolated = class Isolated extends Component<typeof this> {
            <template>
              <div data-test-l2><@fields.name/></div>
            </template>
          }
        }
      `;

      function authHeader() {
        return `Bearer ${createJWT(testRealm, 'user', ['read', 'write'])}`;
      }

      // Count rows that are NOT tombstones — `body IS NULL` indicates a
      // tombstone left behind by invalidateCache or the bulk wipe, and
      // we want the test to reason about "is the L2 entry usable" not
      // "does any row exist for this path."
      async function countL2LiveRows(canonicalUrl: string): Promise<number> {
        let rows = (await query(dbAdapter, [
          'SELECT COUNT(*)::int AS n FROM module_transpile_cache WHERE realm_url =',
          param(realmURL.href),
          'AND canonical_path =',
          param(canonicalUrl),
          'AND body IS NOT NULL',
        ])) as { n: number }[];
        return rows[0]?.n ?? 0;
      }

      async function readL2Generation(
        canonicalUrl: string,
      ): Promise<number | undefined> {
        let rows = (await query(dbAdapter, [
          'SELECT generation FROM module_transpile_cache WHERE realm_url =',
          param(realmURL.href),
          'AND canonical_path =',
          param(canonicalUrl),
        ])) as { generation: string | number }[];
        if (!rows.length) {
          return undefined;
        }
        let g = rows[0].generation;
        return typeof g === 'string' ? Number(g) : g;
      }

      test('a fresh transpile populates module_transpile_cache', async function (assert) {
        let modulePath = 'l2-populate.gts';
        let canonicalUrl = new URL(modulePath, realmURL).href;

        await testRealm.write(modulePath, transpilerHeavySource);
        testRealm.__testOnlyClearCaches();
        // Best-effort bulk DELETE is fire-and-forget — give it a moment
        // to land before we count.
        await new Promise((resolve) => setTimeout(resolve, 50));
        assert.strictEqual(
          await countL2LiveRows(canonicalUrl),
          0,
          'precondition: L2 row absent after __testOnlyClearCaches',
        );

        let response = await request
          .get(`/${modulePath}`)
          .set('Accept', SupportedMimeType.All)
          .set('Authorization', authHeader());
        assert.strictEqual(response.status, 200);

        // L2 write is awaited inside #transpileWithLayers, so by the
        // time the response returns the row is already committed.
        assert.strictEqual(
          await countL2LiveRows(canonicalUrl),
          1,
          'L2 row written by the transpile completion path',
        );
      });

      test('L2 row serves a subsequent reader after L1 wipe (without re-transpile)', async function (assert) {
        let modulePath = 'l2-serve.gts';
        let canonicalUrl = new URL(modulePath, realmURL).href;
        let authHdr = authHeader();

        await testRealm.write(modulePath, transpilerHeavySource);
        testRealm.__testOnlyClearCaches();
        await new Promise((resolve) => setTimeout(resolve, 50));

        let first = await request
          .get(`/${modulePath}`)
          .set('Accept', SupportedMimeType.All)
          .set('Authorization', authHdr);
        assert.strictEqual(first.status, 200);
        assert.strictEqual(
          await countL2LiveRows(canonicalUrl),
          1,
          'first request seeded L2',
        );

        let countBefore = testRealm.__testOnlyGetTranspileCallCount();

        // X-Boxel-Disable-Module-Cache bypasses L1 — both the read AND
        // the set are skipped — so the request goes through the
        // L2-aware #transpileWithLayers path. With the L2 row already
        // seeded from `first`, the second request should find the row
        // and return without invoking transpileJS again. This stands in
        // for the cross-process scenario where peer B's L1 is empty
        // because peer A produced the row.
        let second = await request
          .get(`/${modulePath}`)
          .set('Accept', SupportedMimeType.All)
          .set('Authorization', authHdr)
          .set('X-Boxel-Disable-Module-Cache', 'true');
        assert.strictEqual(second.status, 200);
        let countAfter = testRealm.__testOnlyGetTranspileCallCount();
        assert.strictEqual(
          countAfter - countBefore,
          0,
          'second request was served from L2 — no new transpileJS call',
        );
      });

      test('invalidateCache tombstones the L2 row and bumps generation', async function (assert) {
        let modulePath = 'l2-invalidate.gts';
        let canonicalUrl = new URL(modulePath, realmURL).href;

        await testRealm.write(modulePath, transpilerHeavySource);
        testRealm.__testOnlyClearCaches();
        await new Promise((resolve) => setTimeout(resolve, 50));

        let response = await request
          .get(`/${modulePath}`)
          .set('Accept', SupportedMimeType.All)
          .set('Authorization', authHeader());
        assert.strictEqual(response.status, 200);
        assert.strictEqual(
          await countL2LiveRows(canonicalUrl),
          1,
          'L2 row seeded (live, non-tombstone)',
        );
        let preInvalidateGen = await readL2Generation(canonicalUrl);

        testRealm.invalidateCache(modulePath);
        // Tombstone is fire-and-forget — short wait to let it land.
        await new Promise((resolve) => setTimeout(resolve, 100));

        assert.strictEqual(
          await countL2LiveRows(canonicalUrl),
          0,
          'invalidateCache tombstoned the L2 row — body is NULL so readers miss',
        );
        let postInvalidateGen = await readL2Generation(canonicalUrl);
        assert.notStrictEqual(
          preInvalidateGen,
          undefined,
          'generation populated on the pre-invalidate row',
        );
        assert.notStrictEqual(
          postInvalidateGen,
          undefined,
          'generation populated on the post-invalidate tombstone row',
        );
        assert.ok(
          postInvalidateGen! > preInvalidateGen!,
          `invalidateCache bumped generation from ${preInvalidateGen} to ${postInvalidateGen} — concurrent in-flight writers with the captured pre-invalidate gen will be rejected by the OCC WHERE clause`,
        );
      });

      test('in-flight transpile that completes after invalidate cannot resurrect the L2 row (OCC guard)', async function (assert) {
        // Direct exercise of the L2 OCC WHERE clause. We simulate an
        // in-flight transpile that captured a pre-invalidate generation,
        // race an invalidate that tombstones-and-bumps the row, then
        // attempt the writer's UPSERT with the captured value. The
        // WHERE module_transpile_cache.generation <= captured must
        // reject the UPSERT — otherwise a stale transpile would
        // resurrect the row.
        //
        // Assertions are gen-delta based rather than absolute: realm
        // setup + write + __testOnlyClearCaches each fire their own
        // tombstone-and-bump on this path, so the row's starting gen is
        // unpredictable. What matters is that the explicit tombstone
        // here bumps it once, and the stale write that follows leaves
        // it unchanged.
        let modulePath = 'l2-occ-guard.gts';
        let canonicalUrl = new URL(modulePath, realmURL).href;
        await testRealm.write(modulePath, transpilerHeavySource);
        testRealm.__testOnlyClearCaches();
        await new Promise((resolve) => setTimeout(resolve, 50));

        let preTombstoneGen = (await readL2Generation(canonicalUrl)) ?? 0;
        // Tombstone-and-bump (mimics what invalidateCache does post-
        // capture).
        await query(dbAdapter, [
          'INSERT INTO module_transpile_cache',
          '(realm_url, canonical_path, body, headers, dependency_keys, generation, created_at)',
          'VALUES (',
          param(realmURL.href),
          ',',
          param(canonicalUrl),
          ',',
          'NULL, NULL, NULL, 1,',
          param(Date.now()),
          ') ON CONFLICT (realm_url, canonical_path) DO UPDATE SET',
          'body = NULL, headers = NULL, dependency_keys = NULL,',
          'generation = module_transpile_cache.generation + 1,',
          'created_at = EXCLUDED.created_at',
        ]);
        let postTombstoneGen = await readL2Generation(canonicalUrl);
        assert.notStrictEqual(
          postTombstoneGen,
          undefined,
          'tombstone row carries a generation value',
        );
        assert.ok(
          postTombstoneGen! > preTombstoneGen,
          `tombstone bumped generation (${preTombstoneGen} → ${postTombstoneGen})`,
        );

        // Stale write attempt: captures generation 0 (the pre-invalidate
        // value), tries to UPSERT body. The WHERE clause must reject.
        await query(dbAdapter, [
          'INSERT INTO module_transpile_cache',
          '(realm_url, canonical_path, body, headers, dependency_keys, generation, created_at)',
          'VALUES (',
          param(realmURL.href),
          ',',
          param(canonicalUrl),
          ',',
          param('STALE BODY BYTES'),
          ',',
          param('{}'),
          '::jsonb,',
          param('[]'),
          '::jsonb,',
          param(0),
          ',',
          param(Date.now()),
          ') ON CONFLICT (realm_url, canonical_path) DO UPDATE SET',
          'body = EXCLUDED.body, headers = EXCLUDED.headers,',
          'dependency_keys = EXCLUDED.dependency_keys,',
          'generation = EXCLUDED.generation, created_at = EXCLUDED.created_at',
          'WHERE module_transpile_cache.generation <= EXCLUDED.generation',
        ]);

        assert.strictEqual(
          await countL2LiveRows(canonicalUrl),
          0,
          'stale write rejected by OCC WHERE clause — row remains a tombstone',
        );

        let finalGen = await readL2Generation(canonicalUrl);
        assert.strictEqual(
          finalGen,
          postTombstoneGen,
          'generation unchanged after the rejected stale write — OCC WHERE clause held',
        );
      });
    },
  );

  // CS-11030 two-instance integration coverage. The single-realm tests
  // above prove the row is written / read / tombstoned correctly through
  // one Realm's plumbing; these tests prove that two peer Realms — each
  // with its own ModuleCacheCoordinator, both pointing at the same
  // realm_url + pg — actually coalesce on babel through the L2 row and
  // the advisory-lock + NOTIFY channel. Mirrors the
  // CachingDefinitionLookup two-instance test in
  // module-cache-coordination-test.ts but exercises the transpile flow.
  module(
    'Realm.#transpiledModuleCache L2 cross-instance coalesce',
    function (hooks) {
      let dbAdapter: PgAdapter;
      let publisher: import('@cardstack/runtime-common').QueuePublisher;
      let runner: import('@cardstack/runtime-common').QueueRunner;
      setupDB(hooks, {
        beforeEach: async (adapter, pub, run) => {
          dbAdapter = adapter;
          publisher = pub;
          runner = run;
        },
      });

      const peerRealmURL = 'http://127.0.0.1:5555/peer/';
      const peerCardSource = `
        import { contains, field, CardDef, Component } from "https://cardstack.com/base/card-api";
        import StringField from "https://cardstack.com/base/string";

        export class PeerCard extends CardDef {
          @field name = contains(StringField);
          static isolated = class Isolated extends Component<typeof this> {
            <template>
              <div data-test-peer><@fields.name/></div>
            </template>
          }
        }
      `;

      async function buildPeerRealm(args: {
        dir: string;
        coordinator: ModuleCacheCoordinator;
      }): Promise<Realm> {
        let virtualNetwork = createVirtualNetwork();
        let prerenderer = await getTestPrerenderer();
        let definitionLookup = new CachingDefinitionLookup(
          dbAdapter,
          prerenderer,
          virtualNetwork,
          testCreatePrerenderAuth,
        );
        let { realm } = await createRealm({
          dir: args.dir,
          definitionLookup,
          realmURL: peerRealmURL,
          permissions: { '*': ['read', 'write'] },
          virtualNetwork,
          publisher,
          runner,
          dbAdapter,
          transpileCoordinator: args.coordinator,
        });
        return realm;
      }

      async function setupTwoPeers(): Promise<{
        realmA: Realm;
        realmB: Realm;
        coordA: ModuleCacheCoordinator;
        coordB: ModuleCacheCoordinator;
        cardPath: string;
        canonicalUrl: string;
      }> {
        let tmp = dirSync();
        let testRealmDir = join(tmp.name, 'peer-realm');
        ensureDirSync(testRealmDir);
        // Minimal .realm.json so the Realm bootstraps a name + readable
        // visibility; the test only ever asks for module GETs.
        writeJSONSync(join(testRealmDir, '.realm.json'), {
          name: 'Peer Realm',
        });
        let cardPath = 'peer-card.gts';
        writeFileSync(join(testRealmDir, cardPath), peerCardSource);

        let coordA = new ModuleCacheCoordinator({ dbAdapter });
        await coordA.start();
        let coordB = new ModuleCacheCoordinator({ dbAdapter });
        await coordB.start();
        // Give both coordinators a moment to issue their LISTEN before
        // the test fires NOTIFY traffic — matches the 100ms pause in
        // module-cache-coordination-test.ts.
        await new Promise((resolve) => setTimeout(resolve, 100));

        let realmA = await buildPeerRealm({
          dir: testRealmDir,
          coordinator: coordA,
        });
        let realmB = await buildPeerRealm({
          dir: testRealmDir,
          coordinator: coordB,
        });

        // Drop anything either realm filled during construction so the
        // test's request is the only thing that can drive the counter.
        realmA.__testOnlyClearCaches();
        realmB.__testOnlyClearCaches();
        // __testOnlyClearCaches fire-and-forgets the L2 bulk wipe; wait
        // for it to land before reads.
        await new Promise((resolve) => setTimeout(resolve, 50));

        let canonicalUrl = new URL(cardPath, peerRealmURL).href;
        return { realmA, realmB, coordA, coordB, cardPath, canonicalUrl };
      }

      function moduleRequest(realm: Realm, cardPath: string): Request {
        return new Request(new URL(cardPath, peerRealmURL).href, {
          method: 'GET',
          headers: {
            Accept: SupportedMimeType.All,
            Authorization: `Bearer ${createJWT(realm, 'user', ['read'])}`,
          },
        });
      }

      test('L2 row written by peer A is served from L2 by peer B without re-running babel', async function (assert) {
        let { realmA, realmB, coordA, coordB, cardPath } =
          await setupTwoPeers();
        try {
          let respA = await realmA.handle(moduleRequest(realmA, cardPath));
          assert.strictEqual(respA?.status, 200, 'peer A served the module');
          assert.strictEqual(
            realmA.__testOnlyGetTranspileCallCount(),
            1,
            'peer A ran babel exactly once',
          );

          let bCountBefore = realmB.__testOnlyGetTranspileCallCount();
          let respB = await realmB.handle(moduleRequest(realmB, cardPath));
          assert.strictEqual(respB?.status, 200, 'peer B served the module');
          assert.strictEqual(
            realmB.__testOnlyGetTranspileCallCount() - bCountBefore,
            0,
            'peer B served from the L2 row peer A wrote — no babel ran on peer B',
          );
        } finally {
          await coordA.shutDown();
          await coordB.shutDown();
        }
      });

      test('two peers concurrently transpiling the same path coalesce through the coordinator: exactly one babel call across both', async function (assert) {
        let { realmA, realmB, coordA, coordB, cardPath } =
          await setupTwoPeers();
        try {
          // Gate babel on both realms so whichever one wins the
          // advisory lock parks inside transpileJS, holding the lock
          // open. The loser's tryAcquireAndRun returns acquired:false
          // BEFORE the runner fn is invoked, so the loser never reaches
          // the delay — only the winner waits on the gate.
          let releaseGate!: () => void;
          let gate = new Promise<void>((resolve) => {
            releaseGate = resolve;
          });
          realmA.__testOnlyDelayTranspile(() => gate);
          realmB.__testOnlyDelayTranspile(() => gate);

          // Stagger A → B by 100ms so A reliably takes the pg advisory
          // lock first; B then contends and observes acquired:false.
          // Mirrors the staggered start in the CachingDefinitionLookup
          // two-instance test.
          let pA = realmA.handle(moduleRequest(realmA, cardPath));
          await new Promise((resolve) => setTimeout(resolve, 100));
          let pB = realmB.handle(moduleRequest(realmB, cardPath));
          await new Promise((resolve) => setTimeout(resolve, 100));

          // At this point: A is parked inside materializeAndTranspile
          // awaiting the gate (transpile counter hasn't bumped yet —
          // the delay hook runs before the count). B has observed
          // acquired:false and is parked on waitForKey waiting for the
          // NOTIFY A will emit when its tx commits.
          releaseGate();
          let [respA, respB] = await Promise.all([pA, pB]);
          assert.strictEqual(respA?.status, 200, 'peer A served 200');
          assert.strictEqual(respB?.status, 200, 'peer B served 200');

          let aTotal = realmA.__testOnlyGetTranspileCallCount();
          let bTotal = realmB.__testOnlyGetTranspileCallCount();
          assert.strictEqual(
            aTotal + bTotal,
            1,
            'exactly one babel call across both peers — the L2 winner wrote and the loser read',
          );
        } finally {
          realmA.__testOnlyDelayTranspile(undefined);
          realmB.__testOnlyDelayTranspile(undefined);
          await coordA.shutDown();
          await coordB.shutDown();
        }
      });
    },
  );

  // CS-11182: a from-scratch reindex must tombstone every
  // module_transpile_cache row for the realm so the next reader misses
  // L2 and re-transpiles. The post-completion chain in
  // Realm.startReindex used to await clearRealmDefinitions before
  // dropping the L2 rows — a throw in clearRealmDefinitions short-
  // circuited the rest of the callback and left rows live with their
  // pre-reindex bodies, so clients kept being served stale transpiles.
  // These tests pin both the happy-path tombstone and the failure-
  // isolation: a broken clearRealmDefinitions must not block the L2
  // wipe.
  module(
    'Realm.reindex L2 module_transpile_cache tombstone (CS-11182)',
    function (hooks) {
      let realmURL = new URL('http://127.0.0.1:4444/test/');
      let testRealm: Realm;
      let request: RealmRequest;
      let dbAdapter: PgAdapter;

      function onRealmSetup(args: {
        testRealm: Realm;
        testRealmHttpServer: Server;
        request: SuperTest<Test>;
        dbAdapter: PgAdapter;
      }) {
        testRealm = args.testRealm;
        request = withRealmPath(args.request, realmURL);
        dbAdapter = args.dbAdapter;
      }

      setupPermissionedRealmCached(hooks, {
        fixture: 'blank',
        realmURL,
        permissions: {
          '*': ['read', 'write'],
          user: ['read', 'write', 'realm-owner'],
          '@node-test_realm:localhost': ['read', 'realm-owner'],
        },
        onRealmSetup,
      });

      hooks.afterEach(function () {
        sinon.restore();
      });

      const reindexSource = `
        import { contains, field, CardDef, Component } from "https://cardstack.com/base/card-api";
        import StringField from "https://cardstack.com/base/string";

        export class ReindexCard extends CardDef {
          @field name = contains(StringField);
          static isolated = class Isolated extends Component<typeof this> {
            <template>
              <div data-test-reindex><@fields.name/></div>
            </template>
          }
        }
      `;

      function authHeader() {
        return `Bearer ${createJWT(testRealm, 'user', ['read', 'write'])}`;
      }

      async function countLiveRowsForRealm(): Promise<number> {
        let rows = (await query(dbAdapter, [
          'SELECT COUNT(*)::int AS n FROM module_transpile_cache WHERE realm_url =',
          param(realmURL.href),
          'AND body IS NOT NULL',
        ])) as { n: number }[];
        return rows[0]?.n ?? 0;
      }

      async function seedL2Row(modulePath: string): Promise<void> {
        await testRealm.write(modulePath, reindexSource);
        let response = await request
          .get(`/${modulePath}`)
          .set('Accept', SupportedMimeType.All)
          .set('Authorization', authHeader());
        if (response.status !== 200) {
          throw new Error(
            `seedL2Row: expected 200 for /${modulePath}, got ${response.status}`,
          );
        }
      }

      // `#dropAllTranspiledModuleCacheEntries` fires the L2 bulk DELETE as
      // a fire-and-forget — the .then chain doesn't await it. Poll briefly
      // so the assertion isn't racing the UPDATE landing on slower CI
      // machines.
      async function waitForZeroLiveRows(timeoutMs = 5000): Promise<number> {
        let started = Date.now();
        let n = await countLiveRowsForRealm();
        while (n > 0 && Date.now() - started <= timeoutMs) {
          await new Promise((resolve) => setTimeout(resolve, 50));
          n = await countLiveRowsForRealm();
        }
        return n;
      }

      test('reindex tombstones live L2 rows for the realm', async function (assert) {
        await seedL2Row('reindex-happy.gts');
        assert.ok(
          (await countLiveRowsForRealm()) >= 1,
          'precondition: at least one live L2 row for the realm',
        );

        await testRealm.reindex();

        assert.strictEqual(
          await waitForZeroLiveRows(),
          0,
          'reindex tombstoned every live L2 row for the realm',
        );
      });

      test('reindex still tombstones L2 rows when clearRealmDefinitions throws', async function (assert) {
        // Reproduce the staging failure mode: a throw inside the
        // post-completion .then's first awaited step used to short-
        // circuit the rest of the callback, leaving the L2 rows live.
        // The fix wraps each step in its own try/catch so a
        // clearRealmDefinitions failure surfaces as a log line but
        // does not block the bulk tombstone.
        await seedL2Row('reindex-isolated.gts');
        assert.ok(
          (await countLiveRowsForRealm()) >= 1,
          'precondition: at least one live L2 row for the realm',
        );

        let stub = sinon
          .stub(CachingDefinitionLookup.prototype, 'clearRealmDefinitions')
          .rejects(new Error('synthetic clearRealmDefinitions failure'));

        try {
          await testRealm.reindex();
        } finally {
          stub.restore();
        }

        assert.strictEqual(
          await waitForZeroLiveRows(),
          0,
          'bulk L2 tombstone ran even though clearRealmDefinitions threw',
        );
      });
    },
  );

  // CS-11182 follow-up: the original fix only fired the L2 bulk
  // tombstone from `Realm.startReindex`'s post-completion `.then`, which
  // only covers `POST <realm>/_full-reindex` / `POST <realm>/_reindex`.
  // Production reindexes triggered via the operator-action endpoints
  // (`/_grafana-reindex`, `/_grafana-full-reindex`, `/_post-deployment`)
  // and the publish-realm flow (`Realm.fullIndex`) all bypass
  // `startReindex` and so left the L2 row live with pre-reindex bytes.
  // The wider fix emits `notifyAllFileChanges(dbAdapter, realmURL)` from
  // the worker side of the `from-scratch-index` task — every replica's
  // `realm_file_changes` wildcard listener then drops L1 and fires the
  // L2 bulk tombstone. This test exercises the bypass path
  // (`realmIndexUpdater.fullIndex`, which never wires up the
  // `startReindex` callback) and pins the new cross-replica behavior.
  module(
    'Worker-side notify covers reindexes that bypass Realm.startReindex (CS-11182)',
    function (hooks) {
      let realmURL = new URL('http://127.0.0.1:4444/test/');
      let testRealm: Realm;
      let request: RealmRequest;
      let dbAdapter: PgAdapter;
      let listener: RealmFileChangesListener | undefined;

      function onRealmSetup(args: {
        testRealm: Realm;
        testRealmHttpServer: Server;
        request: SuperTest<Test>;
        dbAdapter: PgAdapter;
      }) {
        testRealm = args.testRealm;
        request = withRealmPath(args.request, realmURL);
        dbAdapter = args.dbAdapter;
      }

      setupPermissionedRealmCached(hooks, {
        fixture: 'blank',
        realmURL,
        permissions: {
          '*': ['read', 'write'],
          user: ['read', 'write', 'realm-owner'],
          '@node-test_realm:localhost': ['read', 'realm-owner'],
        },
        onRealmSetup,
      });

      hooks.beforeEach(async function () {
        // Production wires `RealmFileChangesListener` up in `main.ts`; the
        // permissioned-realm test fixture doesn't, so set up the equivalent
        // here. Without it, the worker's NOTIFY would fire into the void
        // and no replica would receive the wildcard wipe — the test
        // would erroneously pass on the listener side regardless of the
        // worker-side emit.
        listener = new RealmFileChangesListener({
          dbAdapter,
          lookupMountedRealm: (url) =>
            url === realmURL.href ? testRealm : undefined,
        });
        await listener.start();
      });

      hooks.afterEach(async function () {
        await listener?.shutDown();
        listener = undefined;
      });

      const reindexSource = `
        import { contains, field, CardDef, Component } from "https://cardstack.com/base/card-api";
        import StringField from "https://cardstack.com/base/string";

        export class WorkerNotifyCard extends CardDef {
          @field name = contains(StringField);
          static isolated = class Isolated extends Component<typeof this> {
            <template>
              <div data-test-worker-notify><@fields.name/></div>
            </template>
          }
        }
      `;

      function authHeader() {
        return `Bearer ${createJWT(testRealm, 'user', ['read', 'write'])}`;
      }

      async function countLiveRowsForRealm(): Promise<number> {
        let rows = (await query(dbAdapter, [
          'SELECT COUNT(*)::int AS n FROM module_transpile_cache WHERE realm_url =',
          param(realmURL.href),
          'AND body IS NOT NULL',
        ])) as { n: number }[];
        return rows[0]?.n ?? 0;
      }

      async function seedL2Row(modulePath: string): Promise<void> {
        await testRealm.write(modulePath, reindexSource);
        let response = await request
          .get(`/${modulePath}`)
          .set('Accept', SupportedMimeType.All)
          .set('Authorization', authHeader());
        if (response.status !== 200) {
          throw new Error(
            `seedL2Row: expected 200 for /${modulePath}, got ${response.status}`,
          );
        }
      }

      async function waitForZeroLiveRows(timeoutMs = 5000): Promise<number> {
        // The worker emits NOTIFY synchronously after batch.done(); the
        // listener's clearLocalSourceCaches fires-and-forgets the L2 bulk
        // tombstone. Both legs settle quickly but neither is on the
        // job.done critical path. Poll briefly so the assertion isn't
        // racing the tombstone landing.
        let started = Date.now();
        let n = await countLiveRowsForRealm();
        while (n > 0 && Date.now() - started <= timeoutMs) {
          await new Promise((resolve) => setTimeout(resolve, 50));
          n = await countLiveRowsForRealm();
        }
        return n;
      }

      test('realmIndexUpdater.fullIndex (no startReindex .then wired up) still tombstones L2 rows via the worker-side NOTIFY', async function (assert) {
        await seedL2Row('worker-notify.gts');
        assert.ok(
          (await countLiveRowsForRealm()) >= 1,
          'precondition: at least one live L2 row before reindex',
        );

        // Bypass `Realm.startReindex` (which DOES wire up the cache-drop
        // .then per the original CS-11182 fix) and go straight through
        // `RealmIndexUpdater.fullIndex`. This mirrors the production
        // bypass paths (`handle-reindex.ts:reindex`, the `full-reindex`
        // queue task, `Realm.fullIndex`) — none of them touch the
        // `startReindex` chain. With only the original fix in place this
        // assertion would fail; the worker-side `notifyAllFileChanges`
        // is what makes it pass.
        await testRealm.realmIndexUpdater.fullIndex(userInitiatedPriority);

        assert.strictEqual(
          await waitForZeroLiveRows(),
          0,
          'L2 rows tombstoned by the worker-side NOTIFY even though startReindex never ran',
        );
      });
    },
  );
});
