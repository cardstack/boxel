import { module, test } from 'qunit';
import type { Test, SuperTest } from 'supertest';
import { join, basename } from 'path';
import { dirSync, type DirResult } from 'tmp';
import { copySync } from 'fs-extra';
import type { Realm } from '@cardstack/runtime-common';
import {
  setupBaseRealmServer,
  setupPermissionedRealm,
  matrixURL,
  testRealmHref,
  createJWT,
} from '../helpers';
import '@cardstack/runtime-common/helpers/code-equality-assertion';

module(`realm-endpoints/${basename(__filename)}`, function () {
  module('Realm-specific Endpoints | GET directory path', function (hooks) {
    let testRealm: Realm;
    let request: SuperTest<Test>;
    let dir: DirResult;

    setupBaseRealmServer(hooks, matrixURL);

    hooks.beforeEach(async function () {
      dir = dirSync();
      copySync(join(__dirname, '..', 'cards'), dir.name);
    });

    function onRealmSetup(args: {
      testRealm: Realm;
      request: SuperTest<Test>;
      dir: DirResult;
    }) {
      testRealm = args.testRealm;
      request = args.request;
      dir = args.dir;
    }

    module('public readable realm', function (hooks) {
      setupPermissionedRealm(hooks, {
        permissions: {
          '*': ['read'],
        },
        onRealmSetup,
      });

      test('serves the request', async function (assert) {
        let response = await request
          .get('/dir/')
          .set('Accept', 'application/vnd.api+json');

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
        let json = response.body;
        for (let relationship of Object.values(json.data.relationships)) {
          delete (relationship as any).meta.lastModified;
        }
        assert.deepEqual(
          json,
          {
            data: {
              id: `${testRealmHref}dir/`,
              type: 'directory',
              relationships: {
                'bar.txt': {
                  links: {
                    related: `${testRealmHref}dir/bar.txt`,
                  },
                  meta: {
                    kind: 'file',
                  },
                },
                'foo.txt': {
                  links: {
                    related: `${testRealmHref}dir/foo.txt`,
                  },
                  meta: {
                    kind: 'file',
                  },
                },
                'subdir/': {
                  links: {
                    related: `${testRealmHref}dir/subdir/`,
                  },
                  meta: {
                    kind: 'directory',
                  },
                },
              },
            },
          },
          'the directory response is correct',
        );
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
          .get('/dir/')
          .set('Accept', 'application/vnd.api+json')
          .set('Authorization', `Bearer invalid-token`);

        assert.strictEqual(response.status, 401, 'HTTP 401 status');
      });

      test('401 without a JWT', async function (assert) {
        let response = await request
          .get('/dir/')
          .set('Accept', 'application/vnd.api+json'); // no Authorization header

        assert.strictEqual(response.status, 401, 'HTTP 401 status');
      });

      test('403 without permission', async function (assert) {
        let response = await request
          .get('/dir/')
          .set('Accept', 'application/vnd.api+json')
          .set('Authorization', `Bearer ${createJWT(testRealm, 'not-john')}`);

        assert.strictEqual(response.status, 403, 'HTTP 403 status');
      });

      test('200 with permission', async function (assert) {
        let response = await request
          .get('/dir/')
          .set('Accept', 'application/vnd.api+json')
          .set(
            'Authorization',
            `Bearer ${createJWT(testRealm, 'john', ['read'])}`,
          );

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
      });
    });
  });
});
