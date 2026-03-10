import { module, test } from 'qunit';
import { basename } from 'path';
import type { SuperTest, Test } from 'supertest';
import type { Realm } from '@cardstack/runtime-common';
import { SupportedMimeType } from '@cardstack/runtime-common';
import { createJWT, setupPermissionedRealmCached } from '../helpers';
import type { PgAdapter as TestPgAdapter } from '@cardstack/postgres';

module(`realm-endpoints/${basename(__filename)}`, function () {
  module('Realm-specific Endpoints | POST _invalidate', function (hooks) {
    let testRealm: Realm;
    let request: SuperTest<Test>;
    let dbAdapter: TestPgAdapter;

    function onRealmSetup(args: {
      testRealm: Realm;
      request: SuperTest<Test>;
      dbAdapter: TestPgAdapter;
    }) {
      testRealm = args.testRealm;
      request = args.request;
      dbAdapter = args.dbAdapter;
    }

    setupPermissionedRealmCached(hooks, {
      permissions: {
        writer: ['read', 'write'],
        reader: ['read'],
        '@node-test_realm:localhost': ['read', 'realm-owner'],
      },
      onRealmSetup,
    });

    async function aKnownIndexedURL(): Promise<string> {
      let rows = (await dbAdapter.execute(
        `SELECT url
         FROM boxel_index
         WHERE realm_url = $1
         ORDER BY url
         LIMIT 1`,
        { bind: [testRealm.url] },
      )) as { url: string }[];
      if (!rows[0]?.url) {
        throw new Error('expected at least one indexed row in test realm');
      }
      return rows[0].url;
    }

    test('returns 401 without JWT for private realm', async function (assert) {
      let response = await request
        .post('/_invalidate')
        .set('Accept', SupportedMimeType.JSONAPI)
        .set('Content-Type', SupportedMimeType.JSONAPI)
        .send({
          data: {
            type: 'invalidation-request',
            attributes: {
              urls: [`${testRealm.url}mango`],
            },
          },
        });

      assert.strictEqual(response.status, 401, 'HTTP 401 status');
    });

    test('returns 403 for user without write access', async function (assert) {
      let response = await request
        .post('/_invalidate')
        .set('Accept', SupportedMimeType.JSONAPI)
        .set('Content-Type', SupportedMimeType.JSONAPI)
        .set(
          'Authorization',
          `Bearer ${createJWT(testRealm, 'reader', ['read'])}`,
        )
        .send({
          data: {
            type: 'invalidation-request',
            attributes: {
              urls: [`${testRealm.url}mango`],
            },
          },
        });

      assert.strictEqual(response.status, 403, 'HTTP 403 status');
    });

    test('returns 400 for malformed JSON body', async function (assert) {
      let response = await request
        .post('/_invalidate')
        .set('Accept', SupportedMimeType.JSONAPI)
        .set('Content-Type', SupportedMimeType.JSONAPI)
        .set(
          'Authorization',
          `Bearer ${createJWT(testRealm, 'writer', ['read', 'write'])}`,
        )
        .send('{ nope');

      assert.strictEqual(response.status, 400, 'HTTP 400 status');
    });

    test('returns 400 when urls attribute is missing', async function (assert) {
      let response = await request
        .post('/_invalidate')
        .set('Accept', SupportedMimeType.JSONAPI)
        .set('Content-Type', SupportedMimeType.JSONAPI)
        .set(
          'Authorization',
          `Bearer ${createJWT(testRealm, 'writer', ['read', 'write'])}`,
        )
        .send({
          data: {
            type: 'invalidation-request',
            attributes: {},
          },
        });

      assert.strictEqual(response.status, 400, 'HTTP 400 status');
    });

    test('returns 400 when urls attribute is not an array', async function (assert) {
      let response = await request
        .post('/_invalidate')
        .set('Accept', SupportedMimeType.JSONAPI)
        .set('Content-Type', SupportedMimeType.JSONAPI)
        .set(
          'Authorization',
          `Bearer ${createJWT(testRealm, 'writer', ['read', 'write'])}`,
        )
        .send({
          data: {
            type: 'invalidation-request',
            attributes: {
              urls: `${testRealm.url}mango`,
            },
          },
        });

      assert.strictEqual(response.status, 400, 'HTTP 400 status');
    });

    test('returns 400 when urls contains an invalid URL string', async function (assert) {
      let response = await request
        .post('/_invalidate')
        .set('Accept', SupportedMimeType.JSONAPI)
        .set('Content-Type', SupportedMimeType.JSONAPI)
        .set(
          'Authorization',
          `Bearer ${createJWT(testRealm, 'writer', ['read', 'write'])}`,
        )
        .send({
          data: {
            type: 'invalidation-request',
            attributes: {
              urls: ['not-a-valid-url'],
            },
          },
        });

      assert.strictEqual(response.status, 400, 'HTTP 400 status');
    });

    test('returns 400 and does not process when any url is out of realm', async function (assert) {
      let initialVersionRows = (await dbAdapter.execute(
        `SELECT current_version FROM realm_versions WHERE realm_url = $1`,
        { bind: [testRealm.url] },
      )) as { current_version: number }[];

      let response = await request
        .post('/_invalidate')
        .set('Accept', SupportedMimeType.JSONAPI)
        .set('Content-Type', SupportedMimeType.JSONAPI)
        .set(
          'Authorization',
          `Bearer ${createJWT(testRealm, 'writer', ['read', 'write'])}`,
        )
        .send({
          data: {
            type: 'invalidation-request',
            attributes: {
              urls: [
                `${testRealm.url}mango`,
                'https://example.com/not-this-realm/person.gts',
              ],
            },
          },
        });

      assert.strictEqual(response.status, 400, 'HTTP 400 status');

      let currentVersionRows = (await dbAdapter.execute(
        `SELECT current_version FROM realm_versions WHERE realm_url = $1`,
        { bind: [testRealm.url] },
      )) as { current_version: number }[];
      assert.strictEqual(
        currentVersionRows[0]?.current_version,
        initialVersionRows[0]?.current_version,
        'failed validation does not commit a new index version',
      );
    });

    test('returns 204 and accepts missing urls as pass-through invalidation seeds', async function (assert) {
      let indexedURL = await aKnownIndexedURL();
      let response = await request
        .post('/_invalidate')
        .set('Accept', SupportedMimeType.JSONAPI)
        .set('Content-Type', SupportedMimeType.JSONAPI)
        .set(
          'Authorization',
          `Bearer ${createJWT(testRealm, 'writer', ['read', 'write'])}`,
        )
        .send({
          data: {
            type: 'invalidation-request',
            attributes: {
              urls: [indexedURL, `${testRealm.url}does-not-exist`],
            },
          },
        });

      assert.strictEqual(response.status, 204, 'HTTP 204 status');

      let rows = (await dbAdapter.execute(
        `SELECT type, realm_version
         FROM boxel_index
         WHERE realm_url = $1
           AND url = $2`,
        { bind: [testRealm.url, indexedURL] },
      )) as { type: 'instance' | 'file'; realm_version: number }[];
      assert.true(rows.length > 0, 'target url still has indexed rows');
      assert.true(
        rows.every((row) => row.realm_version === 2),
        'target url rows were updated to the new index version by invalidation',
      );
    });

    test('returns 204 and silently deduplicates urls', async function (assert) {
      let indexedURL = await aKnownIndexedURL();
      let response = await request
        .post('/_invalidate')
        .set('Accept', SupportedMimeType.JSONAPI)
        .set('Content-Type', SupportedMimeType.JSONAPI)
        .set(
          'Authorization',
          `Bearer ${createJWT(testRealm, 'writer', ['read', 'write'])}`,
        )
        .send({
          data: {
            type: 'invalidation-request',
            attributes: {
              urls: [indexedURL, indexedURL],
            },
          },
        });

      assert.strictEqual(response.status, 204, 'HTTP 204 status');

      let targetRows = (await dbAdapter.execute(
        `SELECT realm_version
         FROM boxel_index
         WHERE realm_url = $1
           AND url = $2`,
        { bind: [testRealm.url, indexedURL] },
      )) as { realm_version: number }[];
      assert.true(targetRows.length > 0, 'target url still has indexed rows');
      assert.true(
        targetRows.every((row) => row.realm_version === 2),
        'deduped request still invalidates the target url',
      );

      let versionRows = (await dbAdapter.execute(
        `SELECT current_version FROM realm_versions WHERE realm_url = $1`,
        { bind: [testRealm.url] },
      )) as { current_version: number }[];
      assert.strictEqual(
        versionRows[0]?.current_version,
        2,
        'deduped request advances index version once',
      );
    });
  });
});
