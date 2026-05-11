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
});
