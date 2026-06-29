import QUnit from 'qunit';
const { module, test } = QUnit;
import type { Test, SuperTest, Response } from 'supertest';
import { basename } from 'path';
import type { Realm } from '@cardstack/runtime-common';
import { archiveRealm, unarchiveRealm } from '@cardstack/runtime-common';
import {
  setupPermissionedRealmCached,
  testRealmHref,
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
});
