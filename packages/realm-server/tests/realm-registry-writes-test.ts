import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { PgAdapter } from '@cardstack/postgres';
import { asExpressions, insert, query } from '@cardstack/runtime-common';
import { setupDB } from './helpers/index.ts';
import {
  deleteRegistryRowByUrl,
  deletePublishedRowsBySourceUrl,
  upsertPublishedRealmInRegistry,
  insertSourceRealmInRegistry,
} from '../lib/realm-registry-writes.ts';

interface RegistryRow {
  url: string;
  kind: string;
  disk_id: string;
  owner_username: string;
  source_url: string | null;
  last_published_at: string | null;
  pinned: boolean;
}

async function getRegistryRow(
  dbAdapter: PgAdapter,
  url: string,
): Promise<RegistryRow | undefined> {
  const rows = (await query(dbAdapter, [
    `SELECT url, kind, disk_id, owner_username, source_url, last_published_at, pinned FROM realm_registry WHERE url = '${url.replace(/'/g, "''")}'`,
  ])) as Array<Record<string, unknown>>;
  if (!rows.length) return undefined;
  const r = rows[0];
  return {
    url: r.url as string,
    kind: r.kind as string,
    disk_id: r.disk_id as string,
    owner_username: r.owner_username as string,
    source_url: (r.source_url as string | null) ?? null,
    last_published_at: (r.last_published_at as string | null) ?? null,
    pinned: r.pinned as boolean,
  };
}

async function getAllRegistryRows(
  dbAdapter: PgAdapter,
): Promise<RegistryRow[]> {
  const rows = (await query(dbAdapter, [
    `SELECT url, kind, disk_id, owner_username, source_url, last_published_at, pinned FROM realm_registry ORDER BY url`,
  ])) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    url: r.url as string,
    kind: r.kind as string,
    disk_id: r.disk_id as string,
    owner_username: r.owner_username as string,
    source_url: (r.source_url as string | null) ?? null,
    last_published_at: (r.last_published_at as string | null) ?? null,
    pinned: r.pinned as boolean,
  }));
}

async function seedBootstrapRow(dbAdapter: PgAdapter, url: string) {
  const { nameExpressions, valueExpressions } = asExpressions({
    url,
    kind: 'bootstrap',
    disk_id: '/abs/bootstrap',
    owner_username: 'system',
    pinned: true,
  });
  await query(
    dbAdapter,
    insert('realm_registry', nameExpressions, valueExpressions),
  );
}

module(basename(import.meta.filename), function () {
  module('upsertPublishedRealmInRegistry', function (hooks) {
    let dbAdapter: PgAdapter;
    setupDB(hooks, {
      beforeEach: async (adapter) => {
        dbAdapter = adapter;
      },
    });

    test('inserts a published row when absent', async function (assert) {
      await upsertPublishedRealmInRegistry(dbAdapter, {
        publishedRealmURL: 'http://user.localhost:4201/site/',
        publishedRealmId: '11111111-2222-3333-4444-555555555555',
        ownerUsername: 'realm/_published_xyz',
        sourceRealmURL: 'http://localhost:4201/luke/src/',
        lastPublishedAt: 1_700_000_000_000,
      });

      const row = await getRegistryRow(
        dbAdapter,
        'http://user.localhost:4201/site/',
      );
      assert.ok(row, 'row inserted');
      assert.strictEqual(row!.kind, 'published');
      assert.strictEqual(row!.disk_id, '11111111-2222-3333-4444-555555555555');
      assert.strictEqual(row!.owner_username, 'realm/_published_xyz');
      assert.strictEqual(row!.source_url, 'http://localhost:4201/luke/src/');
      assert.strictEqual(row!.last_published_at, '1700000000000');
      assert.false(row!.pinned);
    });

    test('updates last_published_at on repeat publish', async function (assert) {
      const url = 'http://user.localhost:4201/site/';
      await upsertPublishedRealmInRegistry(dbAdapter, {
        publishedRealmURL: url,
        publishedRealmId: 'uuid-1',
        ownerUsername: 'realm/_published_x',
        sourceRealmURL: 'http://localhost:4201/luke/src/',
        lastPublishedAt: 1_700_000_000_000,
      });
      await upsertPublishedRealmInRegistry(dbAdapter, {
        publishedRealmURL: url,
        publishedRealmId: 'uuid-1',
        ownerUsername: 'realm/_published_x',
        sourceRealmURL: 'http://localhost:4201/luke/src/',
        lastPublishedAt: 1_800_000_000_000,
      });

      const row = await getRegistryRow(dbAdapter, url);
      assert.strictEqual(
        row!.last_published_at,
        '1800000000000',
        'timestamp advanced on repeat publish',
      );
    });

    test('does not clobber a bootstrap row that shares the URL', async function (assert) {
      const url = 'https://cardstack.com/base/';
      await seedBootstrapRow(dbAdapter, url);

      await upsertPublishedRealmInRegistry(dbAdapter, {
        publishedRealmURL: url,
        publishedRealmId: 'uuid-x',
        ownerUsername: 'realm/_published_x',
        sourceRealmURL: 'http://localhost:4201/some/src/',
        lastPublishedAt: 1_700_000_000_000,
      });

      const row = await getRegistryRow(dbAdapter, url);
      assert.strictEqual(row!.kind, 'bootstrap', 'bootstrap row untouched');
      assert.strictEqual(row!.disk_id, '/abs/bootstrap');
      assert.strictEqual(row!.source_url, null);
    });
  });

  module('insertSourceRealmInRegistry', function (hooks) {
    let dbAdapter: PgAdapter;
    setupDB(hooks, {
      beforeEach: async (adapter) => {
        dbAdapter = adapter;
      },
    });

    test('inserts a source row when absent', async function (assert) {
      await insertSourceRealmInRegistry(dbAdapter, {
        url: 'http://localhost:4201/luke/my-realm/',
        diskId: 'luke/my-realm',
        ownerUsername: 'luke',
      });

      const row = await getRegistryRow(
        dbAdapter,
        'http://localhost:4201/luke/my-realm/',
      );
      assert.ok(row, 'row inserted');
      assert.strictEqual(row!.kind, 'source');
      assert.strictEqual(row!.disk_id, 'luke/my-realm');
      assert.strictEqual(row!.owner_username, 'luke');
      assert.strictEqual(row!.source_url, null);
      assert.false(row!.pinned);
    });

    test('is a no-op when the url already exists (ON CONFLICT DO NOTHING)', async function (assert) {
      const url = 'http://localhost:4201/luke/my-realm/';
      await insertSourceRealmInRegistry(dbAdapter, {
        url,
        diskId: 'luke/my-realm',
        ownerUsername: 'luke',
      });
      await insertSourceRealmInRegistry(dbAdapter, {
        url,
        diskId: 'luke/different-path',
        ownerUsername: 'luke',
      });

      const row = await getRegistryRow(dbAdapter, url);
      assert.strictEqual(
        row!.disk_id,
        'luke/my-realm',
        'disk_id from first insert preserved (no conflict update)',
      );
    });
  });

  module('deleteRegistryRowByUrl', function (hooks) {
    let dbAdapter: PgAdapter;
    setupDB(hooks, {
      beforeEach: async (adapter) => {
        dbAdapter = adapter;
      },
    });

    test('deletes a published row', async function (assert) {
      const url = 'http://user.localhost:4201/site/';
      await upsertPublishedRealmInRegistry(dbAdapter, {
        publishedRealmURL: url,
        publishedRealmId: 'uuid',
        ownerUsername: 'realm/_published_x',
        sourceRealmURL: 'http://localhost:4201/luke/src/',
        lastPublishedAt: 1_700_000_000_000,
      });
      await deleteRegistryRowByUrl(dbAdapter, url);
      assert.strictEqual(
        await getRegistryRow(dbAdapter, url),
        undefined,
        'published row removed',
      );
    });

    test('deletes a source row', async function (assert) {
      const url = 'http://localhost:4201/luke/src/';
      await insertSourceRealmInRegistry(dbAdapter, {
        url,
        diskId: 'luke/src',
        ownerUsername: 'luke',
      });
      await deleteRegistryRowByUrl(dbAdapter, url);
      assert.strictEqual(
        await getRegistryRow(dbAdapter, url),
        undefined,
        'source row removed',
      );
    });

    test('does NOT delete a bootstrap row (kind != bootstrap guard)', async function (assert) {
      const url = 'https://cardstack.com/base/';
      await seedBootstrapRow(dbAdapter, url);
      await deleteRegistryRowByUrl(dbAdapter, url);

      const row = await getRegistryRow(dbAdapter, url);
      assert.ok(row, 'bootstrap row still exists');
      assert.strictEqual(row!.kind, 'bootstrap');
    });

    test('is a no-op when the url is absent', async function (assert) {
      await deleteRegistryRowByUrl(dbAdapter, 'http://does-not-exist.example/');
      assert.strictEqual(
        (await getAllRegistryRows(dbAdapter)).length,
        0,
        'nothing removed',
      );
    });
  });

  module('deletePublishedRowsBySourceUrl', function (hooks) {
    let dbAdapter: PgAdapter;
    setupDB(hooks, {
      beforeEach: async (adapter) => {
        dbAdapter = adapter;
      },
    });

    test('deletes all published rows sourced from a given url', async function (assert) {
      const sourceUrl = 'http://localhost:4201/luke/src/';
      await upsertPublishedRealmInRegistry(dbAdapter, {
        publishedRealmURL: 'http://user1.localhost:4201/a/',
        publishedRealmId: 'uuid-a',
        ownerUsername: 'realm/_published_a',
        sourceRealmURL: sourceUrl,
        lastPublishedAt: 1,
      });
      await upsertPublishedRealmInRegistry(dbAdapter, {
        publishedRealmURL: 'http://user2.localhost:4201/b/',
        publishedRealmId: 'uuid-b',
        ownerUsername: 'realm/_published_b',
        sourceRealmURL: sourceUrl,
        lastPublishedAt: 2,
      });
      // A published row sourced from a DIFFERENT realm — should survive.
      await upsertPublishedRealmInRegistry(dbAdapter, {
        publishedRealmURL: 'http://user3.localhost:4201/c/',
        publishedRealmId: 'uuid-c',
        ownerUsername: 'realm/_published_c',
        sourceRealmURL: 'http://localhost:4201/someone-else/src/',
        lastPublishedAt: 3,
      });

      await deletePublishedRowsBySourceUrl(dbAdapter, sourceUrl);

      const rows = await getAllRegistryRows(dbAdapter);
      assert.strictEqual(rows.length, 1, 'only the unrelated row remains');
      assert.strictEqual(rows[0].url, 'http://user3.localhost:4201/c/');
    });

    test('does not touch source rows even if they share the URL', async function (assert) {
      // A source realm whose URL happens to appear in the source_url field of
      // some published rows. The helper deletes the published rows but leaves
      // the source realm's own row alone (it's matched by url, not source_url).
      const sourceUrl = 'http://localhost:4201/luke/src/';
      await insertSourceRealmInRegistry(dbAdapter, {
        url: sourceUrl,
        diskId: 'luke/src',
        ownerUsername: 'luke',
      });
      await upsertPublishedRealmInRegistry(dbAdapter, {
        publishedRealmURL: 'http://user.localhost:4201/pub/',
        publishedRealmId: 'uuid-pub',
        ownerUsername: 'realm/_published_pub',
        sourceRealmURL: sourceUrl,
        lastPublishedAt: 1,
      });

      await deletePublishedRowsBySourceUrl(dbAdapter, sourceUrl);

      const rows = await getAllRegistryRows(dbAdapter);
      assert.strictEqual(rows.length, 1);
      assert.strictEqual(rows[0].url, sourceUrl, 'source row preserved');
      assert.strictEqual(rows[0].kind, 'source');
    });
  });
});
