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
} from '../helpers/index.ts';

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

    test('lists errored entries with their error doc and diagnostics', async function (assert) {
      await sourceRealm.realmIndexUpdater.fullIndex();

      let errorDoc = {
        message: 'render failed: missing module',
        status: 500,
        title: 'RenderError',
        additionalErrors: null,
      };
      let diagnostics = { invalidationId: 'inv-test-1', ms: 42 };
      let cardURL = `${sourceRealm.url}broken-instance.json`;
      for (let table of ['boxel_index', 'boxel_index_working']) {
        await dbAdapter.execute(
          `UPDATE ${table}
           SET has_error = TRUE,
               error_doc = $1::jsonb,
               diagnostics = $2::jsonb
           WHERE url = $3 AND type = 'instance'`,
          {
            bind: [
              JSON.stringify(errorDoc),
              JSON.stringify(diagnostics),
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
      assert.strictEqual(
        entry.id,
        `instance::${cardURL}`,
        'id encodes both entry type and URL',
      );
      assert.strictEqual(entry.attributes.url, cardURL, 'attributes.url');
      assert.strictEqual(
        entry.attributes.entryType,
        'instance',
        'attributes.entryType',
      );
      assert.deepEqual(
        entry.attributes.errorDoc,
        errorDoc,
        'errorDoc is the persisted SerializedError',
      );
      assert.deepEqual(
        entry.attributes.diagnostics,
        diagnostics,
        'diagnostics is included',
      );
    });

    test('disambiguates same URL with different boxel_index types', async function (assert) {
      await sourceRealm.realmIndexUpdater.fullIndex();

      let cardURL = `${sourceRealm.url}broken-instance.json`;
      let instanceError = {
        message: 'instance render failed',
        status: 500,
        title: 'RenderError',
      };
      let fileError = {
        message: 'file extract failed',
        status: 500,
        title: 'FileExtractError',
      };

      // Force the file row to exist (post-full-index it may not be there if
      // the .json was treated as instance-only). Upsert the (url, file) row.
      await dbAdapter.execute(
        `INSERT INTO boxel_index
           (url, file_alias, type, realm_version, realm_url,
            has_error, error_doc, is_deleted)
         VALUES ($1, $2, 'file', 1, $3, TRUE, $4::jsonb, FALSE)
         ON CONFLICT (url, realm_url, type) DO UPDATE
         SET has_error = EXCLUDED.has_error,
             error_doc = EXCLUDED.error_doc,
             is_deleted = FALSE`,
        {
          bind: [
            cardURL,
            cardURL.replace(/\.json$/, ''),
            sourceRealm.url,
            JSON.stringify(fileError),
          ],
        },
      );
      await dbAdapter.execute(
        `UPDATE boxel_index
         SET has_error = TRUE, error_doc = $1::jsonb
         WHERE url = $2 AND realm_url = $3 AND type = 'instance'`,
        {
          bind: [JSON.stringify(instanceError), cardURL, sourceRealm.url],
        },
      );

      let response = await request
        .get(`${new URL(sourceRealm.url).pathname}_indexing-errors`)
        .set('Accept', SupportedMimeType.JSONAPI)
        .set(
          'Authorization',
          `Bearer ${createJWT(sourceRealm, ownerUserId, DEFAULT_PERMISSIONS)}`,
        );

      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      let entries = response.body.data as Array<{
        type: string;
        id: string;
        attributes: {
          url: string;
          entryType: string;
          errorDoc?: { message: string };
        };
      }>;
      let forUrl = entries.filter((e) => e.attributes.url === cardURL);
      assert.strictEqual(
        forUrl.length,
        2,
        'both (instance, file) rows are reported',
      );
      let ids = forUrl.map((e) => e.id).sort();
      assert.deepEqual(
        ids,
        [`file::${cardURL}`, `instance::${cardURL}`],
        'JSON-API ids are unique per (entryType, url)',
      );
      let byType = Object.fromEntries(
        forUrl.map((e) => [e.attributes.entryType, e]),
      );
      assert.strictEqual(
        byType.instance.attributes.errorDoc?.message,
        instanceError.message,
        'instance row carries its own errorDoc',
      );
      assert.strictEqual(
        byType.file.attributes.errorDoc?.message,
        fileError.message,
        'file row carries its own errorDoc',
      );
    });

    test('surfaces broken-link rows even when has_error is FALSE', async function (assert) {
      await sourceRealm.realmIndexUpdater.fullIndex();

      let cardURL = `${sourceRealm.url}broken-instance.json`;
      let brokenLinks = [
        {
          fieldName: 'author',
          reference: 'https://example.com/missing-author',
          kind: 'not-found',
        },
        {
          fieldName: 'tags',
          reference: 'https://example.com/missing-tag',
          kind: 'error',
        },
      ];
      let diagnostics = { brokenLinks };

      // Clear any residual error state on both rows from prior tests in this
      // module, then mark the instance row as a clean-index row with broken
      // links surfaced via diagnostics.
      await dbAdapter.execute(
        `UPDATE boxel_index
         SET has_error = FALSE,
             error_doc = NULL,
             diagnostics = NULL
         WHERE url = $1 AND realm_url = $2`,
        { bind: [cardURL, sourceRealm.url] },
      );
      await dbAdapter.execute(
        `UPDATE boxel_index
         SET diagnostics = $1::jsonb
         WHERE url = $2 AND realm_url = $3 AND type = 'instance'`,
        {
          bind: [JSON.stringify(diagnostics), cardURL, sourceRealm.url],
        },
      );

      let response = await request
        .get(`${new URL(sourceRealm.url).pathname}_indexing-errors`)
        .set('Accept', SupportedMimeType.JSONAPI)
        .set(
          'Authorization',
          `Bearer ${createJWT(sourceRealm, ownerUserId, DEFAULT_PERMISSIONS)}`,
        );

      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      let entries = (
        response.body.data as Array<{
          type: string;
          id: string;
          attributes: {
            url: string;
            entryType: string;
            errorDoc?: unknown;
            brokenLinks?: Array<{ fieldName: string }>;
          };
        }>
      ).filter(
        (e) =>
          e.attributes.url === cardURL && e.attributes.entryType === 'instance',
      );
      assert.strictEqual(entries.length, 1, 'one broken-link row reported');
      let entry = entries[0];
      assert.strictEqual(entry.type, 'broken-link', 'discriminator');
      assert.strictEqual(
        entry.attributes.errorDoc,
        undefined,
        'no errorDoc on a healthy-but-broken-links row',
      );
      assert.deepEqual(
        entry.attributes.brokenLinks?.map((l) => l.fieldName).sort(),
        ['author', 'tags'],
        'brokenLinks payload included',
      );
    });
  });
});
