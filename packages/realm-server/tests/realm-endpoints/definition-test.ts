import { module, test } from 'qunit';
import type { Test, SuperTest } from 'supertest';
import { basename } from 'path';
import type { Server } from 'http';
import qs from 'qs';
import type { Definition, Realm } from '@cardstack/runtime-common';
import {
  setupBaseRealmServer,
  setupPermissionedRealm,
  closeServer,
  matrixURL,
  testRealmHref,
  createJWT,
  cardDefinition,
} from '../helpers';
import '@cardstack/runtime-common/helpers/code-equality-assertion';

module(`realm-endpoints/${basename(__filename)}`, function () {
  module('Realm-specific Endpoints | GET _definition', function (hooks) {
    let testRealm: Realm;
    let testRealmHttpServer: Server;
    let request: SuperTest<Test>;

    function onRealmSetup(args: {
      testRealm: Realm;
      testRealmHttpServer: Server;
      request: SuperTest<Test>;
    }) {
      testRealm = args.testRealm;
      testRealmHttpServer = args.testRealmHttpServer;
      request = args.request;
    }
    setupBaseRealmServer(hooks, matrixURL);

    hooks.afterEach(async function () {
      await closeServer(testRealmHttpServer);
    });

    module('public readable realm', function (hooks) {
      setupPermissionedRealm(hooks, {
        permissions: {
          '*': ['read'],
        },
        onRealmSetup,
      });

      test('read permission GET /_definition', async function (assert) {
        let response = await request
          .get(
            `/_definition?${qs.stringify({ codeRef: { module: `${testRealmHref}person`, name: 'Person' } })}`,
          )
          .set('Accept', 'application/vnd.api+json');
        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        let json = response.body;
        assert.deepEqual(
          json,
          expectedDefinition,
          'definition response is correct',
        );
      });
    });

    module('private realm', function (hooks) {
      setupPermissionedRealm(hooks, {
        permissions: {
          mary: ['read'],
        },
        onRealmSetup,
      });

      test('non read permission GET /_definition', async function (assert) {
        let response = await request
          .get(
            `/_definition?${qs.stringify({ codeRef: { module: `${testRealmHref}person`, name: 'Person' } })}`,
          )
          .set('Accept', 'application/vnd.api+json')
          .set('Authorization', `Bearer ${createJWT(testRealm, 'not-mary')}`);

        assert.strictEqual(response.status, 403, 'HTTP 403 status');
      });

      test('read permission GET /_definition', async function (assert) {
        let response = await request
          .get(
            `/_definition?${qs.stringify({ codeRef: { module: `${testRealmHref}person`, name: 'Person' } })}`,
          )
          .set('Accept', 'application/vnd.api+json')
          .set(
            'Authorization',
            `Bearer ${createJWT(testRealm, 'mary', ['read'])}`,
          );

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        let json = response.body;
        assert.deepEqual(
          json,
          expectedDefinition,
          'definition response is correct',
        );
      });
    });
  });
});

const expectedDefinition = {
  data: {
    type: 'definition',
    id: `${testRealmHref}person/Person`,
    attributes: {
      type: 'card-def',
      displayName: 'Person',
      codeRef: {
        module: `${testRealmHref}person`,
        name: 'Person',
      },
      fields: {
        firstName: {
          type: 'contains',
          isComputed: false,
          fieldOrCard: {
            name: 'StringField',
            module: 'https://cardstack.com/base/card-api',
          },
          isPrimitive: true,
        },
        ...cardDefinition,
      },
    } as Definition,
  },
};
