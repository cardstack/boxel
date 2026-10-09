import QUnit from 'qunit';
const { module, test } = QUnit;
import type { Test, SuperTest } from 'supertest';
import { basename } from 'path';
import type { Realm } from '@cardstack/runtime-common';
import {
  setupPermissionedRealmCached,
  mtimes,
  testRealmHref,
  testRealmURL,
  createJWT,
} from '../helpers/index.ts';
import '@cardstack/runtime-common/helpers/code-equality-assertion';

module(`realm-endpoints/${basename(import.meta.filename)}`, function () {
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

    setupPermissionedRealmCached(hooks, {
      fixture: 'blank',
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

  module(
    'Realm-specific Endpoints | GET _mtimes after the ignore rules change',
    function (hooks) {
      let testRealm: Realm;
      let request: SuperTest<Test>;

      function onRealmSetup(args: {
        testRealm: Realm;
        testRealmPath: string;
        request: SuperTest<Test>;
      }) {
        testRealm = args.testRealm;
        request = args.request;
      }

      setupPermissionedRealmCached(hooks, {
        fileSystem: {
          '.boxelignore': 'README.md\n',
          'docs/README.md': '# Docs\n',
          'notes/draft.md': '# Draft\n',
        },
        permissions: {
          mary: ['read'],
          '@node-test_realm:localhost': ['read', 'realm-owner'],
        },
        onRealmSetup,
      });

      async function listedPaths(): Promise<string[]> {
        let response = await request
          .get('/_mtimes')
          .set('Accept', 'application/vnd.api+json')
          .set(
            'Authorization',
            `Bearer ${createJWT(testRealm, 'mary', ['read'])}`,
          );
        return Object.keys(response.body.data.attributes.mtimes).map((url) =>
          url.slice(testRealmHref.length),
        );
      }

      test('a rule taken out of .boxelignore reveals the paths it hid', async function (assert) {
        assert.notOk(
          (await listedPaths()).includes('docs/README.md'),
          'the nested README starts out ignored',
        );

        await testRealm.write('.boxelignore', '/README.md\n');
        await testRealm.indexing();

        assert.ok(
          (await listedPaths()).includes('docs/README.md'),
          'the nested README is listed without a restart',
        );
      });

      test('a rule added to .boxelignore hides the paths it matches', async function (assert) {
        assert.ok(
          (await listedPaths()).includes('notes/draft.md'),
          'the draft starts out listed',
        );

        await testRealm.write('.boxelignore', 'README.md\nnotes/\n');
        await testRealm.indexing();

        assert.notOk(
          (await listedPaths()).includes('notes/draft.md'),
          'the draft drops out without a restart',
        );
      });
    },
  );
});
