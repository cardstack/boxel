import QUnit from 'qunit';
const { module, test } = QUnit;
import type { Test, SuperTest, Response } from 'supertest';
import { basename } from 'path';
import type { Realm } from '@cardstack/runtime-common';
import { archiveRealm, unarchiveRealm } from '@cardstack/runtime-common';
import {
  setupPermissionedRealmCached,
  testRealmHref,
  testRealmURLFor,
  createJWT,
} from '../helpers/index.ts';
import '@cardstack/runtime-common/helpers/code-equality-assertion';
import type { PgAdapter } from '@cardstack/postgres';

// An archived realm is sealed for everyone (owner included): every content
// request to its boundary returns 403 with an "archived" marker, while the
// operational `_readiness-check` stays reachable and unarchiving lifts the
// seal.
module(`realm-endpoints/${basename(import.meta.filename)}`, function () {
  module('archived realm seal', function (hooks) {
    let testRealm: Realm;
    let request: SuperTest<Test>;
    let dbAdapter: PgAdapter;

    setupPermissionedRealmCached(hooks, {
      fixture: 'blank',
      permissions: {
        owner: ['read', 'write', 'realm-owner'],
        member: ['read'],
        '*': ['read'],
      },
      onRealmSetup(args: {
        testRealm: Realm;
        request: SuperTest<Test>;
        dbAdapter: PgAdapter;
      }) {
        testRealm = args.testRealm;
        request = args.request;
        dbAdapter = args.dbAdapter;
      },
    });

    function ownerJWT() {
      return `Bearer ${createJWT(testRealm, 'owner', [
        'read',
        'write',
        'realm-owner',
      ])}`;
    }

    function memberJWT() {
      return `Bearer ${createJWT(testRealm, 'member', ['read'])}`;
    }

    function assertArchived403(
      assert: Assert,
      response: Response,
      label: string,
    ) {
      assert.strictEqual(response.status, 403, `${label}: HTTP 403`);
      assert.strictEqual(
        response.get('X-Boxel-Realm-Archived'),
        'true',
        `${label}: carries the X-Boxel-Realm-Archived marker`,
      );
      assert.strictEqual(
        (response.body as any)?.errors?.[0]?.code,
        'archived',
        `${label}: JSON:API error code is "archived"`,
      );
    }

    test('content reads and writes are sealed for everyone while archived; readiness stays open; unarchive lifts the seal', async function (assert) {
      // Baseline: active realm serves content.
      let active = await request
        .get('/_info')
        .set('Accept', 'application/vnd.api+json')
        .set('Authorization', ownerJWT());
      assert.strictEqual(active.status, 200, 'active realm serves /_info');

      // Baseline for the header-less readiness probe on an active realm, so we
      // can assert below that archiving doesn't change how it's handled.
      let activeReadinessNoAccept = await request.get('/_readiness-check');

      await archiveRealm(dbAdapter, new URL(testRealmHref));

      // Reads are sealed for the owner, an authenticated non-owner, and the
      // anonymous public-read caller alike.
      assertArchived403(
        assert,
        await request
          .get('/_info')
          .set('Accept', 'application/vnd.api+json')
          .set('Authorization', ownerJWT()),
        'owner read',
      );
      assertArchived403(
        assert,
        await request
          .get('/_info')
          .set('Accept', 'application/vnd.api+json')
          .set('Authorization', memberJWT()),
        'non-owner read',
      );
      assertArchived403(
        assert,
        await request.get('/_info').set('Accept', 'application/vnd.api+json'),
        'anonymous (public-read) read',
      );

      // Writes are sealed too — the seal short-circuits before card creation,
      // so even the owner's write is refused with the archived marker.
      assertArchived403(
        assert,
        await request
          .post('/')
          .set('Accept', 'application/vnd.card+json')
          .set('Authorization', ownerJWT())
          .send({
            data: {
              attributes: { firstName: 'Mango' },
              meta: { adoptsFrom: { module: '../person.gts', name: 'Person' } },
            },
          }),
        'owner write',
      );

      // The operational readiness probe is exempt so health checks don't read
      // an archived realm as down.
      let readiness = await request
        .get('/_readiness-check')
        .set('Accept', 'application/vnd.api+json');
      assert.strictEqual(
        readiness.status,
        200,
        '_readiness-check stays reachable while archived',
      );

      // The exemption is path-based, not header-based: a bare health probe
      // that sends no `Accept` header is never sealed — it's handled exactly
      // as on an active realm, with no archived marker. (The router itself
      // gates `_readiness-check` on the `Accept` header, so a header-less probe
      // doesn't reach the handler on either an active or archived realm; the
      // point here is that the seal doesn't single it out.)
      let readinessNoAccept = await request.get('/_readiness-check');
      assert.strictEqual(
        readinessNoAccept.status,
        activeReadinessNoAccept.status,
        '_readiness-check with no Accept header is handled the same whether archived or active',
      );
      assert.strictEqual(
        readinessNoAccept.get('X-Boxel-Realm-Archived'),
        undefined,
        '_readiness-check with no Accept header is not given the archived seal',
      );

      // Unarchiving lifts the seal; the active realm is unaffected.
      await unarchiveRealm(dbAdapter, new URL(testRealmHref));
      let restored = await request
        .get('/_info')
        .set('Accept', 'application/vnd.api+json')
        .set('Authorization', ownerJWT());
      assert.strictEqual(
        restored.status,
        200,
        'content is served again after unarchive',
      );
    });
  });

  // The seal must not leak a private realm's existence or archived state to
  // callers who can't prove access: the archived response is reserved for
  // callers who would otherwise reach the content. A caller who fails
  // authentication or authorization gets the same 401/403 they would on an
  // active private realm.
  module(
    'archived seal does not disclose to unauthorized callers',
    function (hooks) {
      let testRealm: Realm;
      let request: SuperTest<Test>;
      let dbAdapter: PgAdapter;

      setupPermissionedRealmCached(hooks, {
        fixture: 'blank',
        // A private realm: no `*` permission.
        realmURL: testRealmURLFor('private-archived/'),
        permissions: {
          owner: ['read', 'write', 'realm-owner'],
        },
        onRealmSetup(args: {
          testRealm: Realm;
          request: SuperTest<Test>;
          dbAdapter: PgAdapter;
        }) {
          testRealm = args.testRealm;
          request = args.request;
          dbAdapter = args.dbAdapter;
        },
      });

      // Address content under the realm's own path prefix (the realm is mounted
      // at `/private-archived/`, not the server root).
      function path(suffix: string) {
        return `${new URL(testRealm.url).pathname.replace(/\/$/, '')}${suffix}`;
      }

      test('a private archived realm returns the normal 401/403 to callers who cannot prove access, and the archived marker only to authorized callers', async function (assert) {
        await archiveRealm(dbAdapter, new URL(testRealm.url));

        // Unauthenticated: the normal missing-auth 401, with no hint that the
        // realm exists or is archived.
        let anonymous = await request
          .get(path('/_info'))
          .set('Accept', 'application/vnd.api+json');
        assert.strictEqual(
          anonymous.status,
          401,
          'unauthenticated caller gets 401',
        );
        assert.notStrictEqual(
          anonymous.get('X-Boxel-Realm-Archived'),
          'true',
          'unauthenticated caller is not told the realm is archived',
        );

        // Authenticated but holding no permission on this realm: the normal 403
        // authorization failure, still with no archived disclosure.
        let stranger = await request
          .get(path('/_info'))
          .set('Accept', 'application/vnd.api+json')
          .set(
            'Authorization',
            `Bearer ${createJWT(testRealm, 'stranger', [])}`,
          );
        assert.strictEqual(
          stranger.status,
          403,
          'unauthorized caller gets 403',
        );
        assert.notStrictEqual(
          stranger.get('X-Boxel-Realm-Archived'),
          'true',
          'unauthorized caller is not told the realm is archived',
        );

        // The owner could otherwise reach the content, so they see the seal.
        let owner = await request
          .get(path('/_info'))
          .set('Accept', 'application/vnd.api+json')
          .set(
            'Authorization',
            `Bearer ${createJWT(testRealm, 'owner', [
              'read',
              'write',
              'realm-owner',
            ])}`,
          );
        assert.strictEqual(owner.status, 403, 'authorized owner gets 403');
        assert.strictEqual(
          owner.get('X-Boxel-Realm-Archived'),
          'true',
          'authorized owner sees the archived marker',
        );
      });
    },
  );
});
