import { module, test } from 'qunit';
import type { Test, SuperTest } from 'supertest';
import { basename } from 'path';
import type { Server } from 'http';
import type { DirResult } from 'tmp';

import type { Realm } from '@cardstack/runtime-common';
import {
  setupBaseRealmServer,
  setupPermissionedRealm,
  matrixURL,
  testRealmHref,
  createJWT,
} from './helpers';
import '@cardstack/runtime-common/helpers/code-equality-assertion';

module(basename(__filename), function () {
  module(
    'Realm-specific Endpoints | card dependencies requests',
    function (hooks) {
      let testRealm: Realm;
      let request: SuperTest<Test>;

      function onRealmSetup(args: {
        testRealm: Realm;
        testRealmHttpServer: Server;
        request: SuperTest<Test>;
        dir: DirResult;
      }) {
        testRealm = args.testRealm;
        request = args.request;
      }

      setupBaseRealmServer(hooks, matrixURL);

      module('card dependencies GET request', function (_hooks) {
        module('public readable realm', function (hooks) {
          setupPermissionedRealm(hooks, {
            permissions: {
              '*': ['read'],
            },
            onRealmSetup,
          });

          test('serves the request', async function (assert) {
            let response = await request
              .get(`/_dependencies?url=${testRealm.url}person`)
              .set('Accept', 'application/json')
              .set(
                'Authorization',
                `Bearer ${createJWT(testRealm, 'john', ['read'])}`,
              );

            assert.strictEqual(response.status, 200, 'HTTP 200 status');
            assert.strictEqual(
              response.get('X-boxel-realm-url'),
              testRealmHref,
              'realm url header is correct',
            );
            assert.strictEqual(
              response.get('X-boxel-realm-public-readable'),
              'true',
              'realm is public readable',
            );

            let result: string[] = JSON.parse(response.text.trim());

            assert.ok(
              result.includes('http://127.0.0.1:4444/person.gts'),
              'person.gts is a dependency',
            );
          });

          test('serves the request with a .json extension', async function (assert) {
            let response = await request
              .get(`/_dependencies?url=${testRealm.url}person.json`)
              .set('Accept', 'application/json')
              .set(
                'Authorization',
                `Bearer ${createJWT(testRealm, 'john', ['read'])}`,
              );
            let result: string[] = JSON.parse(response.text.trim());

            assert.ok(
              result.includes('http://127.0.0.1:4444/person.gts'),
              'person.gts is a dependency',
            );
          });

          test('gives 404 for a non-existent card', async function (assert) {
            let response = await request
              .get(`/_dependencies?url=${testRealm.url}non-existent-card`)
              .set('Accept', 'application/json');

            assert.strictEqual(response.status, 404, 'HTTP 404 status');
          });
        });

        module('permissioned realm', function (hooks) {
          setupPermissionedRealm(hooks, {
            permissions: {
              john: ['read'],
            },
            onRealmSetup,
          });

          test('401 with invalid JWT', async function (assert) {
            let response = await request
              .get(`/_dependencies?url=${testRealm.url}person`)
              .set('Accept', 'application/json')
              .set('Authorization', `Bearer invalid-token`);

            assert.strictEqual(response.status, 401, 'HTTP 401 status');
          });

          test('401 without a JWT', async function (assert) {
            let response = await request
              .get(`/_dependencies?url=${testRealm.url}person`)
              .set('Accept', 'application/json'); // no Authorization header

            assert.strictEqual(response.status, 401, 'HTTP 401 status');
          });

          test('403 without permission', async function (assert) {
            let response = await request
              .get(`/_dependencies?url=${testRealm.url}person`)
              .set('Accept', 'application/json')
              .set(
                'Authorization',
                `Bearer ${createJWT(testRealm, 'not-john')}`,
              );

            assert.strictEqual(response.status, 403, 'HTTP 403 status');
          });

          test('200 with permission', async function (assert) {
            let response = await request
              .get(`/_dependencies?url=${testRealm.url}person`)
              .set('Accept', 'application/json')
              .set(
                'Authorization',
                `Bearer ${createJWT(testRealm, 'john', ['read'])}`,
              );

            assert.strictEqual(response.status, 200, 'HTTP 200 status');
          });
        });
      });
    },
  );
});
