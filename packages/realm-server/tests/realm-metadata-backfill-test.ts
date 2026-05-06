import { module, test } from 'qunit';
import { basename, join } from 'path';
import { dirSync, type DirResult } from 'tmp';
import { ensureDirSync, readFileSync, writeFileSync } from 'fs-extra';
import type { PgAdapter } from '@cardstack/postgres';
import {
  param,
  query,
  PUBLISHED_DIRECTORY_NAME,
} from '@cardstack/runtime-common';
import { setupDB } from './helpers';
import { runRealmMetadataBackfill } from '../lib/realm-metadata-backfill';

interface MetadataRow {
  url: string;
  show_as_catalog: boolean | null;
  publishable: boolean | null;
}

async function metadataRowFor(
  dbAdapter: PgAdapter,
  url: string,
): Promise<MetadataRow | undefined> {
  let rows = (await query(dbAdapter, [
    `SELECT url, show_as_catalog, publishable FROM realm_metadata WHERE url =`,
    param(url),
  ])) as Array<Record<string, unknown>>;
  if (rows.length === 0) {
    return undefined;
  }
  return {
    url: rows[0].url as string,
    show_as_catalog: rows[0].show_as_catalog as boolean | null,
    publishable: rows[0].publishable as boolean | null,
  };
}

function seedSidecar(realmDir: string, payload: Record<string, unknown>) {
  ensureDirSync(realmDir);
  writeFileSync(
    join(realmDir, '.realm.json'),
    JSON.stringify(payload, null, 2),
  );
}

function readSidecar(realmDir: string): unknown {
  return JSON.parse(readFileSync(join(realmDir, '.realm.json'), 'utf8'));
}

module(basename(__filename), function () {
  module('runRealmMetadataBackfill', function (hooks) {
    let dbAdapter: PgAdapter;
    let dir: DirResult;
    let realmsRootPath: string;
    const serverURL = new URL('http://localhost:4201/');

    setupDB(hooks, {
      beforeEach: async (_dbAdapter) => {
        dbAdapter = _dbAdapter;
        dir = dirSync({ unsafeCleanup: true });
        realmsRootPath = join(dir.name, 'realms');
        ensureDirSync(realmsRootPath);
      },
      afterEach: async () => {
        dir.removeCallback();
      },
    });

    test('inserts a metadata row from a source realm sidecar and trims the migrated keys', async function (assert) {
      const realmDir = join(realmsRootPath, 'luke', 'my-realm');
      seedSidecar(realmDir, {
        name: 'My Realm',
        publishable: true,
        showAsCatalog: false,
        hostHome: 'https://hosted.example.com/',
      });

      await runRealmMetadataBackfill({
        dbAdapter,
        realmsRootPath,
        serverURL,
        bootstrapRealms: [],
      });

      const url = 'http://localhost:4201/luke/my-realm/';
      const row = await metadataRowFor(dbAdapter, url);
      assert.ok(row, 'metadata row inserted');
      assert.true(row?.publishable, 'publishable copied');
      assert.false(row?.show_as_catalog, 'show_as_catalog copied');
      assert.deepEqual(
        readSidecar(realmDir),
        { name: 'My Realm', hostHome: 'https://hosted.example.com/' },
        'migrated keys trimmed; other keys preserved',
      );
    });

    test('inserts a row from a bootstrap realm sidecar', async function (assert) {
      const bootstrapDir = join(dir.name, 'base');
      seedSidecar(bootstrapDir, {
        name: 'base',
        showAsCatalog: false,
      });

      await runRealmMetadataBackfill({
        dbAdapter,
        realmsRootPath,
        serverURL,
        bootstrapRealms: [
          {
            diskPath: bootstrapDir,
            url: 'https://cardstack.com/base/',
          },
        ],
      });

      const row = await metadataRowFor(
        dbAdapter,
        'https://cardstack.com/base/',
      );
      assert.ok(row, 'metadata row inserted for bootstrap');
      assert.false(row?.show_as_catalog);
      assert.strictEqual(row?.publishable, null, 'publishable absent → null');
      assert.deepEqual(
        readSidecar(bootstrapDir),
        { name: 'base' },
        'showAsCatalog trimmed from bootstrap sidecar',
      );
    });

    test('inserts a row from a published realm sidecar correlated via realm_registry', async function (assert) {
      const publishedRoot = join(realmsRootPath, PUBLISHED_DIRECTORY_NAME);
      const uuid = '00000000-0000-0000-0000-000000000001';
      const publishedRealmUrl = 'http://localhost:4201/_published/abc/';
      seedSidecar(join(publishedRoot, uuid), {
        publishable: false,
      });
      await query(dbAdapter, [
        `INSERT INTO realm_registry (url, kind, disk_id, owner_username, source_url, last_published_at, pinned) VALUES (`,
        param(publishedRealmUrl),
        `, 'published', `,
        param(uuid),
        `,`,
        param('luke'),
        `,`,
        param('http://localhost:4201/luke/my-realm/'),
        `,`,
        param(Date.now()),
        `, false)`,
      ]);

      await runRealmMetadataBackfill({
        dbAdapter,
        realmsRootPath,
        serverURL,
        bootstrapRealms: [],
      });

      const row = await metadataRowFor(dbAdapter, publishedRealmUrl);
      assert.ok(row, 'metadata row inserted for published realm');
      assert.false(row?.publishable);
    });

    test('skips realms whose sidecar has no migratable keys', async function (assert) {
      const realmDir = join(realmsRootPath, 'luke', 'name-only');
      seedSidecar(realmDir, { name: 'Name Only' });

      await runRealmMetadataBackfill({
        dbAdapter,
        realmsRootPath,
        serverURL,
        bootstrapRealms: [],
      });

      const row = await metadataRowFor(
        dbAdapter,
        'http://localhost:4201/luke/name-only/',
      );
      assert.notOk(row, 'no row inserted when sidecar has no migratable keys');
      assert.deepEqual(
        readSidecar(realmDir),
        { name: 'Name Only' },
        'sidecar untouched',
      );
    });

    test('preserves an existing DB row on rerun (ON CONFLICT DO NOTHING) and re-trims the sidecar idempotently', async function (assert) {
      const realmDir = join(realmsRootPath, 'luke', 'preserved');
      seedSidecar(realmDir, { publishable: true });

      // Pre-existing row with the opposite value — simulates a runtime
      // write that arrived before the backfill.
      const url = 'http://localhost:4201/luke/preserved/';
      await query(dbAdapter, [
        `INSERT INTO realm_metadata (url, publishable) VALUES (`,
        param(url),
        `,`,
        param(false),
        `)`,
      ]);

      await runRealmMetadataBackfill({
        dbAdapter,
        realmsRootPath,
        serverURL,
        bootstrapRealms: [],
      });

      const row = await metadataRowFor(dbAdapter, url);
      assert.false(
        row?.publishable,
        'existing DB row preserved; sidecar value did not overwrite',
      );
      assert.deepEqual(
        readSidecar(realmDir),
        {},
        'sidecar trimmed even when DB row already existed',
      );

      // Run again — no change.
      await runRealmMetadataBackfill({
        dbAdapter,
        realmsRootPath,
        serverURL,
        bootstrapRealms: [],
      });
      const rowAgain = await metadataRowFor(dbAdapter, url);
      assert.false(rowAgain?.publishable);
      assert.deepEqual(readSidecar(realmDir), {});
    });

    test('tolerates malformed sidecar JSON without crashing', async function (assert) {
      const realmDir = join(realmsRootPath, 'luke', 'broken');
      ensureDirSync(realmDir);
      writeFileSync(join(realmDir, '.realm.json'), '{ not valid');

      await runRealmMetadataBackfill({
        dbAdapter,
        realmsRootPath,
        serverURL,
        bootstrapRealms: [],
      });

      const row = await metadataRowFor(
        dbAdapter,
        'http://localhost:4201/luke/broken/',
      );
      assert.notOk(row, 'no row inserted from malformed sidecar');
      assert.strictEqual(
        readFileSync(join(realmDir, '.realm.json'), 'utf8'),
        '{ not valid',
        'malformed sidecar left untouched',
      );
    });

    test('tolerates a non-object sidecar JSON without crashing', async function (assert) {
      const realmDir = join(realmsRootPath, 'luke', 'array');
      ensureDirSync(realmDir);
      writeFileSync(join(realmDir, '.realm.json'), '[1, 2, 3]');

      await runRealmMetadataBackfill({
        dbAdapter,
        realmsRootPath,
        serverURL,
        bootstrapRealms: [],
      });

      const row = await metadataRowFor(
        dbAdapter,
        'http://localhost:4201/luke/array/',
      );
      assert.notOk(row);
    });
  });
});
