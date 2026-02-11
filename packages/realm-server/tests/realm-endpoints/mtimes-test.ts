import { module, test } from 'qunit';
import type { Test, SuperTest } from 'supertest';
import { basename } from 'path';
import type { Realm } from '@cardstack/runtime-common';
import {
  setupPermissionedRealm,
  mtimes,
  testRealmHref,
  testRealmURL,
  createJWT,
} from '../helpers';
import '@cardstack/runtime-common/helpers/code-equality-assertion';

module(`realm-endpoints/${basename(__filename)}`, function () {
  module('Realm-specific Endpoints | GET _mtimes', function (hooks) {
    let testRealm: Realm;
    let testRealmPath: string;
    let request: SuperTest<Test>;

    function onRealmSetup(args: {
      testRealm: Realm;
      testRealmPath: string;
      request: SuperTest<Test>;
    }) {
      testRealm = args.testRealm;
      testRealmPath = args.testRealmPath;
      request = args.request;
    }

    setupPermissionedRealm(hooks, {
      permissions: {
        mary: ['read'],
        '@node-test_realm:localhost': ['read', 'realm-owner'],
      },
      onRealmSetup,
    });

    test('non read permission GET /_mtimes', async function (assert) {
      let response = await request
        .get('/_mtimes')
        .set('Accept', 'application/vnd.api+json')
        .set('Authorization', `Bearer ${createJWT(testRealm, 'not-mary')}`);

      assert.strictEqual(response.status, 403, 'HTTP 403 status');
    });

    test('read permission GET /_mtimes', async function (assert) {
      let expectedMtimes = mtimes(testRealmPath, testRealmURL);
      delete expectedMtimes[`${testRealmURL}.realm.json`];

      let response = await request
        .get('/_mtimes')
        .set('Accept', 'application/vnd.api+json')
        .set(
          'Authorization',
          `Bearer ${createJWT(testRealm, 'mary', ['read'])}`,
        );

      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      let json = response.body;
      assert.deepEqual(
        json,
        {
          data: {
            type: 'mtimes',
            id: testRealmHref,
            attributes: {
              mtimes: expectedMtimes,
            },
          },
        },
        'mtimes response is correct',
      );
    });
  });
});
