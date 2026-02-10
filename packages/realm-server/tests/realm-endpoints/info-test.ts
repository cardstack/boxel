import { module, test } from 'qunit';
import type { Test, SuperTest } from 'supertest';
import { join, basename } from 'path';
import type { Server } from 'http';
import { dirSync, type DirResult } from 'tmp';
import { copySync } from 'fs-extra';
import type { Realm } from '@cardstack/runtime-common';
import {
  setupPermissionedRealm,
  closeServer,
  testRealmInfo,
  createJWT,
} from '../helpers';
import '@cardstack/runtime-common/helpers/code-equality-assertion';
import { resetCatalogRealms } from '../../handlers/handle-fetch-catalog-realms';

module(`realm-endpoints/${basename(__filename)}`, function () {
  module('Realm-specific Endpoints | QUERY _info', function (hooks) {
    let realmURL = new URL('http://127.0.0.1:4444/test/');
    let testRealm: Realm;
    let testRealmHttpServer: Server;
    let request: SuperTest<Test>;
    let dir: DirResult;

    function onRealmSetup(args: {
      testRealm: Realm;
      testRealmHttpServer: Server;
      request: SuperTest<Test>;
      dir: DirResult;
    }) {
      testRealm = args.testRealm;
      testRealmHttpServer = args.testRealmHttpServer;
      request = args.request;
      dir = args.dir;
    }

    hooks.beforeEach(async function () {
      dir = dirSync();
      copySync(join(__dirname, '..', 'cards'), dir.name);
    });

    hooks.afterEach(async function () {
      await closeServer(testRealmHttpServer);
      resetCatalogRealms();
    });

    module('public readable realm', function (hooks) {
      setupPermissionedRealm(hooks, {
        permissions: {
          '*': ['read'],
        },
        realmURL,
        onRealmSetup,
      });

      test('serves the request', async function (assert) {
        let infoPath = new URL('_info', realmURL).pathname;
        let response = await request
          .post(infoPath)
          .set('X-HTTP-Method-Override', 'QUERY')
          .set('Accept', 'application/vnd.api+json');

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        assert.strictEqual(
          response.get('X-boxel-realm-url'),
          realmURL.href,
          'realm url header is correct',
        );
        assert.strictEqual(
          response.get('X-boxel-realm-public-readable'),
          'true',
          'realm is public readable',
        );
        let json = response.body;
        assert.deepEqual(
          json,
          {
            data: {
              id: realmURL.href,
              type: 'realm-info',
              attributes: {
                ...testRealmInfo,
              },
            },
          },
          '/_info response is correct',
        );
      });
    });

    module('permissioned realm', function (hooks) {
      setupPermissionedRealm(hooks, {
        permissions: {
          john: ['read', 'write'],
          '@node-test_realm:localhost': ['read'],
        },
        realmURL,
        onRealmSetup,
      });

      test('401 with invalid JWT', async function (assert) {
        let infoPath = new URL('_info', realmURL).pathname;
        let response = await request
          .post(infoPath)
          .set('X-HTTP-Method-Override', 'QUERY')
          .set('Accept', 'application/vnd.api+json');

        assert.strictEqual(response.status, 401, 'HTTP 401 status');
      });

      test('401 without a JWT', async function (assert) {
        let infoPath = new URL('_info', realmURL).pathname;
        let response = await request
          .post(infoPath)
          .set('X-HTTP-Method-Override', 'QUERY')
          .set('Accept', 'application/vnd.api+json'); // no Authorization header

        assert.strictEqual(response.status, 401, 'HTTP 401 status');
      });

      test('403 without permission', async function (assert) {
        let infoPath = new URL('_info', realmURL).pathname;
        let response = await request
          .post(infoPath)
          .set('X-HTTP-Method-Override', 'QUERY')
          .set('Accept', 'application/vnd.api+json')
          .set('Authorization', `Bearer ${createJWT(testRealm, 'not-john')}`);

        assert.strictEqual(response.status, 403, 'HTTP 403 status');
      });

      test('200 with permission', async function (assert) {
        let infoPath = new URL('_info', realmURL).pathname;
        let response = await request
          .post(infoPath)
          .set('X-HTTP-Method-Override', 'QUERY')
          .set('Accept', 'application/vnd.api+json')
          .set(
            'Authorization',
            `Bearer ${createJWT(testRealm, 'john', ['read', 'write'])}`,
          );

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        let json = response.body;
        assert.deepEqual(
          json,
          {
            data: {
              id: realmURL.href,
              type: 'realm-info',
              attributes: {
                ...testRealmInfo,
                visibility: 'private',
              },
            },
          },
          '/_info response is correct',
        );
      });
    });

    module(
      'shared realm because there is `users` permission',
      function (hooks) {
        setupPermissionedRealm(hooks, {
          permissions: {
            users: ['read'],
            '@node-test_realm:localhost': ['read'],
          },
          realmURL,
          onRealmSetup,
        });

        test('200 with permission', async function (assert) {
          let infoPath = new URL('_info', realmURL).pathname;
          let response = await request
            .post(infoPath)
            .set('X-HTTP-Method-Override', 'QUERY')
            .set('Accept', 'application/vnd.api+json')
            .set(
              'Authorization',
              `Bearer ${createJWT(testRealm, 'users', ['read'])}`,
            );

          assert.strictEqual(response.status, 200, 'HTTP 200 status');
          let json = response.body;
          assert.deepEqual(
            json,
            {
              data: {
                id: realmURL.href,
                type: 'realm-info',
                attributes: {
                  ...testRealmInfo,
                  visibility: 'shared',
                },
              },
            },
            '/_info response is correct',
          );
        });
      },
    );

    module('shared realm because there are multiple users', function (hooks) {
      setupPermissionedRealm(hooks, {
        permissions: {
          bob: ['read'],
          jane: ['read'],
          john: ['read', 'write'],
          '@node-test_realm:localhost': ['read'],
        },
        realmURL,
        onRealmSetup,
      });

      test('200 with permission', async function (assert) {
        let infoPath = new URL('_info', realmURL).pathname;
        let response = await request
          .post(infoPath)
          .set('X-HTTP-Method-Override', 'QUERY')
          .set('Accept', 'application/vnd.api+json')
          .set(
            'Authorization',
            `Bearer ${createJWT(testRealm, 'john', ['read', 'write'])}`,
          );

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        let json = response.body;
        assert.deepEqual(
          json,
          {
            data: {
              id: realmURL.href,
              type: 'realm-info',
              attributes: {
                ...testRealmInfo,
                visibility: 'shared',
              },
            },
          },
          '/_info response is correct',
        );
      });
    });
  });
});
