import { module, test } from 'qunit';
import type { Test, SuperTest } from 'supertest';
import { join, basename } from 'path';
import { dirSync, type DirResult } from 'tmp';
import { copySync } from 'fs-extra';
import type { Realm } from '@cardstack/runtime-common';
import { fetchRealmPermissions } from '@cardstack/runtime-common';
import {
  setupPermissionedRealm,
  testRealmHref,
  testRealmURL,
  createJWT,
} from '../helpers';
import '@cardstack/runtime-common/helpers/code-equality-assertion';
import type { PgAdapter } from '@cardstack/postgres';

module(`realm-endpoints/${basename(__filename)}`, function () {
  module('Realm-specific Endpoints | _permissions', function (hooks) {
    let testRealm: Realm;
    let request: SuperTest<Test>;
    let dir: DirResult;
    let dbAdapter: PgAdapter;

    function onRealmSetup(args: {
      testRealm: Realm;
      request: SuperTest<Test>;
      dbAdapter: PgAdapter;
      dir: DirResult;
    }) {
      testRealm = args.testRealm;
      request = args.request;
      dbAdapter = args.dbAdapter;
      dir = args.dir;
    }

    hooks.beforeEach(async function () {
      dir = dirSync();
      copySync(join(__dirname, '..', 'cards'), dir.name);
    });

    module('permissions requests', function (hooks) {
      setupPermissionedRealm(hooks, {
        permissions: {
          mary: ['read', 'write', 'realm-owner'],
          bob: ['read', 'write'],
          '@node-test_realm:localhost': ['read', 'realm-owner'],
        },
        onRealmSetup,
      });

      test('non-owner GET /_permissions', async function (assert) {
        let response = await request
          .get('/_permissions')
          .set('Accept', 'application/vnd.api+json')
          .set(
            'Authorization',
            `Bearer ${createJWT(testRealm, 'bob', ['read', 'write'])}`,
          );

        assert.strictEqual(response.status, 403, 'HTTP 403 status');
      });

      test('realm-owner GET /_permissions', async function (assert) {
        let response = await request
          .get('/_permissions')
          .set('Accept', 'application/vnd.api+json')
          .set(
            'Authorization',
            `Bearer ${createJWT(testRealm, 'mary', [
              'read',
              'write',
              'realm-owner',
            ])}`,
          );

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        let json = response.body;
        assert.deepEqual(
          json,
          {
            data: {
              type: 'permissions',
              id: testRealmHref,
              attributes: {
                permissions: {
                  mary: ['read', 'write', 'realm-owner'],
                  bob: ['read', 'write'],
                },
              },
            },
          },
          'permissions response is correct',
        );
      });

      test('non-owner PATCH /_permissions', async function (assert) {
        let response = await request
          .patch('/_permissions')
          .set('Accept', 'application/vnd.api+json')
          .set(
            'Authorization',
            `Bearer ${createJWT(testRealm, 'bob', ['read', 'write'])}`,
          )
          .send({
            data: {
              id: testRealmHref,
              type: 'permissions',
              attributes: {
                permissions: {
                  mango: ['read'],
                },
              },
            },
          });

        assert.strictEqual(response.status, 403, 'HTTP 403 status');
        let permissions = await fetchRealmPermissions(dbAdapter, testRealmURL);
        assert.deepEqual(
          permissions,
          {
            mary: ['read', 'write', 'realm-owner'],
            bob: ['read', 'write'],
          },
          'permissions did not change',
        );
      });

      test('realm-owner PATCH /_permissions', async function (assert) {
        let response = await request
          .patch('/_permissions')
          .set('Accept', 'application/vnd.api+json')
          .set(
            'Authorization',
            `Bearer ${createJWT(testRealm, 'mary', [
              'read',
              'write',
              'realm-owner',
            ])}`,
          )
          .send({
            data: {
              id: testRealmHref,
              type: 'permissions',
              attributes: {
                permissions: {
                  mango: ['read'],
                },
              },
            },
          });

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        let json = response.body;
        assert.deepEqual(
          json,
          {
            data: {
              type: 'permissions',
              id: testRealmHref,
              attributes: {
                permissions: {
                  mary: ['read', 'write', 'realm-owner'],
                  bob: ['read', 'write'],
                  mango: ['read'],
                },
              },
            },
          },
          'permissions response is correct',
        );
        let permissions = await fetchRealmPermissions(dbAdapter, testRealmURL);
        assert.deepEqual(
          permissions,
          {
            mary: ['read', 'write', 'realm-owner'],
            bob: ['read', 'write'],
            mango: ['read'],
          },
          'permissions are correct',
        );
      });

      test('remove permissions from PATCH /_permissions using empty array', async function (assert) {
        let response = await request
          .patch('/_permissions')
          .set('Accept', 'application/vnd.api+json')
          .set(
            'Authorization',
            `Bearer ${createJWT(testRealm, 'mary', [
              'read',
              'write',
              'realm-owner',
            ])}`,
          )
          .send({
            data: {
              id: testRealmHref,
              type: 'permissions',
              attributes: {
                permissions: {
                  bob: [],
                },
              },
            },
          });

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        let json = response.body;
        assert.deepEqual(
          json,
          {
            data: {
              type: 'permissions',
              id: testRealmHref,
              attributes: {
                permissions: {
                  mary: ['read', 'write', 'realm-owner'],
                },
              },
            },
          },
          'permissions response is correct',
        );
        let permissions = await fetchRealmPermissions(dbAdapter, testRealmURL);
        assert.deepEqual(
          permissions,
          {
            mary: ['read', 'write', 'realm-owner'],
          },
          'permissions are correct',
        );
      });

      test('remove permissions from PATCH /_permissions using null', async function (assert) {
        let response = await request
          .patch('/_permissions')
          .set('Accept', 'application/vnd.api+json')
          .set(
            'Authorization',
            `Bearer ${createJWT(testRealm, 'mary', [
              'read',
              'write',
              'realm-owner',
            ])}`,
          )
          .send({
            data: {
              id: testRealmHref,
              type: 'permissions',
              attributes: {
                permissions: {
                  bob: null,
                },
              },
            },
          });

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        let json = response.body;
        assert.deepEqual(
          json,
          {
            data: {
              type: 'permissions',
              id: testRealmHref,
              attributes: {
                permissions: {
                  mary: ['read', 'write', 'realm-owner'],
                },
              },
            },
          },
          'permissions response is correct',
        );
        let permissions = await fetchRealmPermissions(dbAdapter, testRealmURL);
        assert.deepEqual(
          permissions,
          {
            mary: ['read', 'write', 'realm-owner'],
          },
          'permissions are correct',
        );
      });

      test('cannot remove realm-owner permissions from PATCH /_permissions', async function (assert) {
        let response = await request
          .patch('/_permissions')
          .set('Accept', 'application/vnd.api+json')
          .set(
            'Authorization',
            `Bearer ${createJWT(testRealm, 'mary', [
              'read',
              'write',
              'realm-owner',
            ])}`,
          )
          .send({
            data: {
              id: testRealmHref,
              type: 'permissions',
              attributes: {
                permissions: {
                  mary: [],
                },
              },
            },
          });

        assert.strictEqual(response.status, 400, 'HTTP 400 status');
        let permissions = await fetchRealmPermissions(dbAdapter, testRealmURL);
        assert.deepEqual(
          permissions,
          {
            mary: ['read', 'write', 'realm-owner'],
            bob: ['read', 'write'],
          },
          'permissions are correct',
        );
      });

      test('cannot add realm-owner permissions from PATCH /_permissions', async function (assert) {
        let response = await request
          .patch('/_permissions')
          .set('Accept', 'application/vnd.api+json')
          .set(
            'Authorization',
            `Bearer ${createJWT(testRealm, 'mary', [
              'read',
              'write',
              'realm-owner',
            ])}`,
          )
          .send({
            data: {
              id: testRealmHref,
              type: 'permissions',
              attributes: {
                permissions: {
                  mango: ['realm-owner', 'write', 'read'],
                },
              },
            },
          });

        assert.strictEqual(response.status, 400, 'HTTP 400 status');
        let permissions = await fetchRealmPermissions(dbAdapter, testRealmURL);
        assert.deepEqual(
          permissions,
          {
            mary: ['read', 'write', 'realm-owner'],
            bob: ['read', 'write'],
          },
          'permissions are correct',
        );
      });

      test('receive 400 error on invalid JSON API', async function (assert) {
        let response = await request
          .patch('/_permissions')
          .set('Accept', 'application/vnd.api+json')
          .set(
            'Authorization',
            `Bearer ${createJWT(testRealm, 'mary', [
              'read',
              'write',
              'realm-owner',
            ])}`,
          )
          .send({
            data: { nothing: null },
          });

        assert.strictEqual(response.status, 400, 'HTTP 400 status');
        let permissions = await fetchRealmPermissions(dbAdapter, testRealmURL);
        assert.deepEqual(
          permissions,
          {
            mary: ['read', 'write', 'realm-owner'],
            bob: ['read', 'write'],
          },
          'permissions are correct',
        );
      });

      test('receive 400 error on invalid permissions shape', async function (assert) {
        let response = await request
          .patch('/_permissions')
          .set('Accept', 'application/vnd.api+json')
          .set(
            'Authorization',
            `Bearer ${createJWT(testRealm, 'mary', [
              'read',
              'write',
              'realm-owner',
            ])}`,
          )
          .send({
            data: {
              id: testRealmHref,
              type: 'permissions',
              attributes: {
                permissions: {
                  larry: { read: true },
                },
              },
            },
          });

        assert.strictEqual(response.status, 400, 'HTTP 400 status');
        let permissions = await fetchRealmPermissions(dbAdapter, testRealmURL);
        assert.deepEqual(
          permissions,
          {
            mary: ['read', 'write', 'realm-owner'],
            bob: ['read', 'write'],
          },
          'permissions are correct',
        );
      });
    });
  });
});
