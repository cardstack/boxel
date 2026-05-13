import { module, test } from 'qunit';
import { basename } from 'path';
import type { SuperTest, Test } from 'supertest';
import type { Server } from 'http';
import type { Realm } from '@cardstack/runtime-common';
import { SupportedMimeType } from '@cardstack/runtime-common';
import {
  setupPermissionedRealmCached,
  createJWT,
  withRealmPath,
  type RealmRequest,
} from './helpers';

// CS-11028: regression coverage for the persist-after-invalidate race in
// Realm.#moduleCache. The scenario: reader A enters fallbackHandle for
// foo.gts, snapshots the module-cache generation, then awaits transpileJS
// (50–500 ms). While A is in-flight, invalidateCache(foo.gts) runs —
// synchronously bumping the per-path generation and clearing whatever was
// in the cache (a no-op if A hadn't filled it yet). Without the fix A's
// post-transpile #moduleCache.set re-fills the slot with pre-invalidation
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
    'Realm.#moduleCache invalidate-during-transpile race',
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
        // post-transpile #moduleCache.set will compare its snapshot against
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
        // (#moduleCache.invalidate cleared the canonical entry), but
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
        // writeMany, which used to mutate #moduleCache directly without
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
  module('Realm.#moduleCache in-flight transpile dedup', function (hooks) {
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
      // separately. The hook captures `currentGate` by reference each
      // time the delay is invoked, so swapping after firing A but
      // before firing B routes B to a fresh gate.
      let releaseA: () => void = () => {};
      let gateA = new Promise<void>((r) => {
        releaseA = r;
      });
      let releaseB: () => void = () => {};
      let gateB = new Promise<void>((r) => {
        releaseB = r;
      });
      let currentGate = gateA;
      testRealm.__testOnlyDelayTranspile(() => currentGate);

      try {
        let pendingA = fireRequest(modulePath);
        await waitForInflight(1);

        // Invalidate drops A from the map. A is still parked at gateA.
        testRealm.invalidateCache(modulePath);
        assert.strictEqual(
          testRealm.__testOnlyGetInFlightTranspileCount(),
          0,
          'invalidate dropped A from the map',
        );

        currentGate = gateB;
        let pendingB = fireRequest(modulePath);
        await waitForInflight(1);
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
  });
});
