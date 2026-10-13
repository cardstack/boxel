import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { PgAdapter } from '@cardstack/postgres';
import { markRealmPublishable, query, param } from '@cardstack/runtime-common';
import { setupDB } from './helpers/index.ts';

const REALM = 'http://127.0.0.1:4444/gallery/';

module(basename(import.meta.filename), function () {
  module('markRealmPublishable', function (hooks) {
    let dbAdapter: PgAdapter;

    setupDB(hooks, {
      beforeEach: async (adapter) => {
        dbAdapter = adapter;
      },
    });

    async function metadataRows() {
      return (await query(
        dbAdapter,
        [
          `SELECT url, publishable, show_as_catalog FROM realm_metadata WHERE url =`,
          param(REALM),
        ],
        { publishable: 'BOOLEAN', show_as_catalog: 'BOOLEAN' },
      )) as {
        url: string;
        publishable: boolean | null;
        show_as_catalog: boolean | null;
      }[];
    }

    test('creates a publishable row for a realm that has none', async function (assert) {
      await markRealmPublishable(dbAdapter, new URL(REALM));

      assert.deepEqual(await metadataRows(), [
        { url: REALM, publishable: true, show_as_catalog: null },
      ]);
    });

    test("sets the flag on an existing row and keeps the row's other flags", async function (assert) {
      await query(dbAdapter, [
        `INSERT INTO realm_metadata (url, publishable, show_as_catalog) VALUES (`,
        param(REALM),
        `, NULL, true)`,
      ]);

      await markRealmPublishable(dbAdapter, new URL(REALM));

      assert.deepEqual(await metadataRows(), [
        { url: REALM, publishable: true, show_as_catalog: true },
      ]);
    });

    test('running it again leaves a single row', async function (assert) {
      await markRealmPublishable(dbAdapter, new URL(REALM));
      await markRealmPublishable(dbAdapter, new URL(REALM));

      assert.deepEqual(await metadataRows(), [
        { url: REALM, publishable: true, show_as_catalog: null },
      ]);
    });
  });
});
