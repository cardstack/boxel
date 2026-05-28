import { module, test } from 'qunit';
import { basename } from 'path';
import supertest from 'supertest';
import type { SuperTest, Test } from 'supertest';
import type { Realm } from '@cardstack/runtime-common';
import { rri } from '@cardstack/runtime-common';
import {
  DEFAULT_PERMISSIONS,
  SupportedMimeType,
} from '@cardstack/runtime-common';

import {
  createJWT,
  setupPermissionedRealmCached,
  setupPermissionedRealmsCached,
  testRealmURLFor,
  type RealmRequest,
  withRealmPath,
} from '../helpers';

const ownerUserId = '@mango:localhost';

module(`realm-endpoints/${basename(__filename)}`, function () {
  module('with a clean realm', function (hooks) {
    let realmURL = testRealmURLFor('test/');
    let request: RealmRequest;
    let testRealm: Realm;

    setupPermissionedRealmCached(hooks, {
      permissions: {
        [ownerUserId]: ['read', 'write', 'realm-owner'],
      },
      realmURL,
      fileSystem: {
        'good-card.gts': `
              import { contains, field, CardDef } from "https://cardstack.com/base/card-api";
              import StringField from "https://cardstack.com/base/string";
              export class GoodCard extends CardDef {
                @field label = contains(StringField);
              }
            `,
        'good-instance.json': {
          data: {
            type: 'card',
            attributes: { label: 'Public Label' },
            meta: {
              adoptsFrom: { module: rri('./good-card'), name: 'GoodCard' },
            },
          },
        },
      },
      onRealmSetup({ testRealm: realm, request: req }) {
        testRealm = realm;
        request = withRealmPath(req, realmURL);
      },
    });

    test('returns an empty data array when there are no indexing errors', async function (assert) {
      let response = await request
        .get('/_indexing-errors')
        .set('Accept', SupportedMimeType.JSONAPI)
        .set(
          'Authorization',
          `Bearer ${createJWT(testRealm, ownerUserId, DEFAULT_PERMISSIONS)}`,
        );

      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      assert.ok(Array.isArray(response.body.data), 'data is an array');
      assert.deepEqual(response.body.data, [], 'no error rows reported');
    });
  });

  module('with error documents', function (hooks) {
    let sourceRealm: Realm;
    let request: SuperTest<Test>;
    let sourceRealmURL = new URL('http://127.0.0.1:4810/source/');
    let dbAdapter: import('@cardstack/postgres').PgAdapter;

    setupPermissionedRealmsCached(hooks, {
      realms: [
        {
          realmURL: sourceRealmURL.href,
          permissions: {
            [ownerUserId]: DEFAULT_PERMISSIONS,
          },
          fileSystem: {
            'broken-card.gts': `
        import { CardDef, field, contains } from "https://cardstack.com/base/card-api";
        import StringField from "https://cardstack.com/base/string";

        export class BrokenCard extends CardDef {
          @field title = contains(StringField);
        }
      `,
            'broken-instance.json': {
              data: {
                type: 'card',
                attributes: { cardTitle: 'Broken' },
                meta: {
                  adoptsFrom: {
                    module: rri('./broken-card.gts'),
                    name: 'BrokenCard',
                  },
                },
              },
            },
          },
        },
      ],
      onRealmSetup({ realms, dbAdapter: adapter }) {
        dbAdapter = adapter;
        sourceRealm = realms.find(
          ({ realm }) => realm.url === sourceRealmURL.href,
        )!.realm;
        request = supertest(
          realms.find(({ realm }) => realm.url === sourceRealmURL.href)!
            .realmHttpServer,
        );
      },
    });

    test('lists errored entries with their error doc and timing diagnostics', async function (assert) {
      await sourceRealm.realmIndexUpdater.fullIndex();

      let errorDoc = {
        message: 'render failed: missing module',
        status: 500,
        title: 'RenderError',
        additionalErrors: null,
      };
      let timingDiagnostics = { invalidationId: 'inv-test-1', ms: 42 };
      let cardURL = `${sourceRealm.url}broken-instance.json`;
      for (let table of ['boxel_index', 'boxel_index_working']) {
        await dbAdapter.execute(
          `UPDATE ${table}
           SET has_error = TRUE,
               error_doc = $1::jsonb,
               timing_diagnostics = $2::jsonb
           WHERE url = $3 AND type = 'instance'`,
          {
            bind: [
              JSON.stringify(errorDoc),
              JSON.stringify(timingDiagnostics),
              cardURL,
            ],
          },
        );
      }

      let response = await request
        .get(`${new URL(sourceRealm.url).pathname}_indexing-errors`)
        .set('Accept', SupportedMimeType.JSONAPI)
        .set(
          'Authorization',
          `Bearer ${createJWT(sourceRealm, ownerUserId, DEFAULT_PERMISSIONS)}`,
        );

      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      assert.ok(Array.isArray(response.body.data), 'data is an array');
      assert.strictEqual(
        response.body.data.length,
        1,
        'exactly one errored entry is reported',
      );

      let entry = response.body.data[0];
      assert.strictEqual(entry.type, 'indexing-error', 'JSON-API type');
      assert.strictEqual(entry.id, cardURL, 'id is the errored URL');
      assert.deepEqual(
        entry.attributes.errorDoc,
        errorDoc,
        'errorDoc is the persisted SerializedError',
      );
      assert.deepEqual(
        entry.attributes.timingDiagnostics,
        timingDiagnostics,
        'timingDiagnostics is included',
      );
    });
  });
});
