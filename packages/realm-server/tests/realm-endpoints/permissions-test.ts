import { module, test } from 'qunit';
import supertest, { Test, SuperTest } from 'supertest';
import { join, resolve, basename } from 'path';
import { Server } from 'http';
import { dirSync, setGracefulCleanup, type DirResult } from 'tmp';
import { copySync, ensureDirSync } from 'fs-extra';
import {
  baseRealm,
  Realm,
  RealmPermissions,
  fetchUserPermissions,
  type LooseSingleCardDocument,
} from '@cardstack/runtime-common';
import {
  setupCardLogs,
  setupBaseRealmServer,
  runTestRealmServer,
  setupDB,
  createVirtualNetwork,
  createVirtualNetworkAndLoader,
  matrixURL,
  closeServer,
} from '../helpers';
import '@cardstack/runtime-common/helpers/code-equality-assertion';
import { type PgAdapter } from '@cardstack/postgres';
import { resetCatalogRealms } from '../../handlers/handle-fetch-catalog-realms';

setGracefulCleanup();
const testRealmURL = new URL('http://127.0.0.1:4444/');
const testRealmHref = testRealmURL.href;
const distDir = resolve(join(__dirname, '..', '..', '..', 'host', 'dist'));
console.log(`using host dist dir: ${distDir}`);

let createJWT = (
  realm: Realm,
  user: string,
  permissions: RealmPermissions['user'] = [],
) => {
  return realm.createJWT(
    {
      user,
      realm: realm.url,
      permissions,
      sessionRoom: `test-session-room-for-${user}`,
    },
    '7d',
  );
};

module(`realm-endpoints/${basename(__filename)}`, function () {
  module('Realm-specific Endpoints | _permissions', function (hooks) {
    let testRealm: Realm;
    let testRealmHttpServer: Server;
    let request: SuperTest<Test>;
    let dir: DirResult;
    let dbAdapter: PgAdapter;

    function setupPermissionedRealm(
      hooks: NestedHooks,
      permissions: RealmPermissions,
      fileSystem?: Record<string, string | LooseSingleCardDocument>,
    ) {
      setupDB(hooks, {
        beforeEach: async (_dbAdapter, publisher, runner) => {
          dbAdapter = _dbAdapter;
          dir = dirSync();
          let testRealmDir = join(dir.name, '..', 'realm_server_1', 'test');
          ensureDirSync(testRealmDir);
          // If a fileSystem is provided, use it to populate the test realm, otherwise copy the default cards
          if (!fileSystem) {
            copySync(join(__dirname, '..', 'cards'), testRealmDir);
          }

          let virtualNetwork = createVirtualNetwork();

          ({ testRealm, testRealmHttpServer } = await runTestRealmServer({
            virtualNetwork,
            testRealmDir,
            realmsRootPath: join(dir.name, '..', 'realm_server_1'),
            realmURL: testRealmURL,
            permissions,
            dbAdapter: _dbAdapter,
            runner,
            publisher,
            matrixURL,
            fileSystem,
          }));

          request = supertest(testRealmHttpServer);
        },
      });
    }

    let { virtualNetwork, loader } = createVirtualNetworkAndLoader();

    setupCardLogs(
      hooks,
      async () => await loader.import(`${baseRealm.url}card-api`),
    );

    setupBaseRealmServer(hooks, virtualNetwork, matrixURL);

    hooks.beforeEach(async function () {
      dir = dirSync();
      copySync(join(__dirname, '..', 'cards'), dir.name);
    });

    hooks.afterEach(async function () {
      await closeServer(testRealmHttpServer);
      resetCatalogRealms();
    });

    module('permissions requests', function (hooks) {
      setupPermissionedRealm(hooks, {
        mary: ['read', 'write', 'realm-owner'],
        bob: ['read', 'write'],
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
        let permissions = await fetchUserPermissions(dbAdapter, testRealmURL);
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
        let permissions = await fetchUserPermissions(dbAdapter, testRealmURL);
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
        let permissions = await fetchUserPermissions(dbAdapter, testRealmURL);
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
        let permissions = await fetchUserPermissions(dbAdapter, testRealmURL);
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
        let permissions = await fetchUserPermissions(dbAdapter, testRealmURL);
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
        let permissions = await fetchUserPermissions(dbAdapter, testRealmURL);
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
        let permissions = await fetchUserPermissions(dbAdapter, testRealmURL);
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
        let permissions = await fetchUserPermissions(dbAdapter, testRealmURL);
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
