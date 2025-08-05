import { module, test } from 'qunit';
import { Test, SuperTest } from 'supertest';
import { basename } from 'path';
import { Server } from 'http';
import qs from 'qs';
import {
  baseRealm,
  type CardDefMeta,
  type Realm,
} from '@cardstack/runtime-common';
import {
  setupCardLogs,
  setupBaseRealmServer,
  setupPermissionedRealm,
  closeServer,
  createVirtualNetworkAndLoader,
  matrixURL,
  testRealmHref,
  createJWT,
  cardInfoFieldMeta,
} from '../helpers';
import '@cardstack/runtime-common/helpers/code-equality-assertion';

module(`realm-endpoints/${basename(__filename)}`, function () {
  module('Realm-specific Endpoints | GET _card-def', function (hooks) {
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

    let { virtualNetwork, loader } = createVirtualNetworkAndLoader();

    setupCardLogs(
      hooks,
      async () => await loader.import(`${baseRealm.url}card-api`),
    );

    setupBaseRealmServer(hooks, virtualNetwork, matrixURL);

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

      test('read permission GET /_card-def', async function (assert) {
        let response = await request
          .get(
            `/_card-def?${qs.stringify({ codeRef: { module: `${testRealmHref}person`, name: 'Person' } })}`,
          )
          .set('Accept', 'application/vnd.api+json');
        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        let json = response.body;
        assert.deepEqual(json, expectedCardDef, 'card-def response is correct');
      });
    });

    module('private realm', function (hooks) {
      setupPermissionedRealm(hooks, {
        permissions: {
          mary: ['read'],
        },
        onRealmSetup,
      });

      test('non read permission GET /_card-def', async function (assert) {
        let response = await request
          .get(
            `/_card-def?${qs.stringify({ codeRef: { module: `${testRealmHref}person`, name: 'Person' } })}`,
          )
          .set('Accept', 'application/vnd.api+json')
          .set('Authorization', `Bearer ${createJWT(testRealm, 'not-mary')}`);

        assert.strictEqual(response.status, 403, 'HTTP 403 status');
      });

      test('read permission GET /_card-def', async function (assert) {
        let response = await request
          .get(
            `/_card-def?${qs.stringify({ codeRef: { module: `${testRealmHref}person`, name: 'Person' } })}`,
          )
          .set('Accept', 'application/vnd.api+json')
          .set(
            'Authorization',
            `Bearer ${createJWT(testRealm, 'mary', ['read'])}`,
          );

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        let json = response.body;
        assert.deepEqual(json, expectedCardDef, 'card-def response is correct');
      });
    });
  });
});

const expectedCardDef = {
  data: {
    type: 'card-def',
    id: `${testRealmHref}person/Person`,
    attributes: {
      displayName: 'Person',
      codeRef: {
        module: `${testRealmHref}person`,
        name: 'Person',
      },
      fields: {
        id: {
          type: 'contains',
          isComputed: false,
          fieldOrCard: {
            name: 'ReadOnlyField',
            module: 'https://cardstack.com/base/card-api',
          },
          isPrimitive: true,
        },
        title: {
          type: 'contains',
          isComputed: true,
          fieldOrCard: {
            name: 'StringField',
            module: 'https://cardstack.com/base/card-api',
          },
          isPrimitive: true,
        },
        description: {
          type: 'contains',
          isComputed: false,
          fieldOrCard: {
            name: 'StringField',
            module: 'https://cardstack.com/base/card-api',
          },
          isPrimitive: true,
        },
        thumbnailURL: {
          type: 'contains',
          isComputed: false,
          fieldOrCard: {
            name: 'MaybeBase64Field',
            module: 'https://cardstack.com/base/card-api',
          },
          isPrimitive: true,
        },
        firstName: {
          type: 'contains',
          isComputed: false,
          fieldOrCard: {
            name: 'StringField',
            module: 'https://cardstack.com/base/card-api',
          },
          isPrimitive: true,
        },
        ...cardInfoFieldMeta,
      },
    } as CardDefMeta,
  },
};
