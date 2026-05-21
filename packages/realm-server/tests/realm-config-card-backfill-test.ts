import { module, test } from 'qunit';
import { basename, join } from 'path';
import { dirSync, type DirResult } from 'tmp';
import {
  ensureDirSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from 'fs-extra';
import type { PgAdapter } from '@cardstack/postgres';
import {
  param,
  query,
  PUBLISHED_DIRECTORY_NAME,
} from '@cardstack/runtime-common';
import { setupDB } from './helpers';
import { runRealmConfigCardBackfill } from '../lib/realm-config-card-backfill';

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

function readCard(realmDir: string): unknown {
  return JSON.parse(readFileSync(join(realmDir, 'realm.json'), 'utf8'));
}

function cardExists(realmDir: string): boolean {
  return existsSync(join(realmDir, 'realm.json'));
}

module(basename(__filename), function () {
  module('runRealmConfigCardBackfill', function (hooks) {
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

    test('writes realm.json card from a source realm sidecar and trims migrated keys', async function (assert) {
      const realmDir = join(realmsRootPath, 'luke', 'my-realm');
      seedSidecar(realmDir, {
        name: 'My Realm',
        backgroundURL: 'https://example.com/bg.png',
        iconURL: 'https://example.com/icon.svg',
        hostHome: 'https://hosted.example.com/',
      });

      await runRealmConfigCardBackfill({
        dbAdapter,
        realmsRootPath,
        serverURL,
        bootstrapRealms: [],
      });

      assert.deepEqual(
        readCard(realmDir),
        {
          data: {
            type: 'card',
            attributes: {
              cardInfo: { name: 'My Realm' },
              backgroundURL: 'https://example.com/bg.png',
              iconURL: 'https://example.com/icon.svg',
            },
            meta: {
              adoptsFrom: {
                module: 'https://cardstack.com/base/realm-config',
                name: 'RealmConfig',
              },
            },
          },
        },
        'realm.json card written in canonical RealmConfig shape',
      );
      assert.deepEqual(
        readSidecar(realmDir),
        { hostHome: 'https://hosted.example.com/' },
        'migrated keys trimmed; non-migrated keys (hostHome) preserved',
      );
    });

    test('skips when realm.json already exists and leaves both files untouched', async function (assert) {
      const realmDir = join(realmsRootPath, 'luke', 'preserved');
      seedSidecar(realmDir, {
        name: 'Sidecar Name',
        backgroundURL: 'https://example.com/sidecar-bg.png',
      });
      const existingCard = {
        data: {
          type: 'card',
          attributes: {
            cardInfo: { name: 'Card Name' },
            backgroundURL: 'https://example.com/card-bg.png',
          },
          meta: {
            adoptsFrom: {
              module: 'https://cardstack.com/base/realm-config',
              name: 'RealmConfig',
            },
          },
        },
      };
      writeFileSync(
        join(realmDir, 'realm.json'),
        JSON.stringify(existingCard, null, 2),
      );

      await runRealmConfigCardBackfill({
        dbAdapter,
        realmsRootPath,
        serverURL,
        bootstrapRealms: [],
      });

      assert.deepEqual(
        readCard(realmDir),
        existingCard,
        'existing card preserved',
      );
      assert.deepEqual(
        readSidecar(realmDir),
        {
          name: 'Sidecar Name',
          backgroundURL: 'https://example.com/sidecar-bg.png',
        },
        'sidecar untouched when card already exists',
      );
    });

    test('skips realms whose sidecar has no migratable keys', async function (assert) {
      const realmDir = join(realmsRootPath, 'luke', 'hosthome-only');
      seedSidecar(realmDir, {
        hostHome: 'https://hosted.example.com/',
      });

      await runRealmConfigCardBackfill({
        dbAdapter,
        realmsRootPath,
        serverURL,
        bootstrapRealms: [],
      });

      assert.notOk(cardExists(realmDir), 'no card written');
      assert.deepEqual(
        readSidecar(realmDir),
        { hostHome: 'https://hosted.example.com/' },
        'sidecar untouched',
      );
    });

    test('skips realms whose sidecar is empty {}', async function (assert) {
      const realmDir = join(realmsRootPath, 'luke', 'empty');
      seedSidecar(realmDir, {});

      await runRealmConfigCardBackfill({
        dbAdapter,
        realmsRootPath,
        serverURL,
        bootstrapRealms: [],
      });

      assert.notOk(cardExists(realmDir));
      assert.deepEqual(readSidecar(realmDir), {});
    });

    test('skips realms with no sidecar at all', async function (assert) {
      const realmDir = join(realmsRootPath, 'luke', 'no-sidecar');
      ensureDirSync(realmDir);

      await runRealmConfigCardBackfill({
        dbAdapter,
        realmsRootPath,
        serverURL,
        bootstrapRealms: [],
      });

      assert.notOk(cardExists(realmDir));
      assert.notOk(existsSync(join(realmDir, '.realm.json')));
    });

    test('migrates hostRoutingRules array verbatim', async function (assert) {
      const realmDir = join(realmsRootPath, 'luke', 'with-routes');
      const routes = [
        { path: '/', instance: 'https://example.com/home' },
        { path: '/about', instance: 'https://example.com/about' },
      ];
      seedSidecar(realmDir, {
        name: 'With Routes',
        hostRoutingRules: routes,
      });

      await runRealmConfigCardBackfill({
        dbAdapter,
        realmsRootPath,
        serverURL,
        bootstrapRealms: [],
      });

      const card = readCard(realmDir) as {
        data: { attributes: Record<string, unknown> };
      };
      assert.deepEqual(card.data.attributes.cardInfo, { name: 'With Routes' });
      assert.deepEqual(
        card.data.attributes.hostRoutingRules,
        routes,
        'hostRoutingRules migrated verbatim into card attributes',
      );
      assert.deepEqual(readSidecar(realmDir), {}, 'sidecar fully trimmed');
    });

    test('writes a card from a bootstrap realm sidecar', async function (assert) {
      const bootstrapDir = join(dir.name, 'base');
      seedSidecar(bootstrapDir, {
        name: 'Base Workspace',
        backgroundURL: 'https://example.com/base-bg.jpg',
        iconURL: 'https://example.com/base-icon.png',
      });

      await runRealmConfigCardBackfill({
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

      const card = readCard(bootstrapDir) as {
        data: { attributes: Record<string, unknown> };
      };
      assert.deepEqual(card.data.attributes.cardInfo, {
        name: 'Base Workspace',
      });
      assert.strictEqual(
        card.data.attributes.backgroundURL,
        'https://example.com/base-bg.jpg',
      );
      assert.deepEqual(readSidecar(bootstrapDir), {});
    });

    test('writes a card from a published realm sidecar correlated via realm_registry', async function (assert) {
      const publishedRoot = join(realmsRootPath, PUBLISHED_DIRECTORY_NAME);
      const uuid = '00000000-0000-0000-0000-000000000001';
      const publishedRealmUrl = 'http://localhost:4201/_published/abc/';
      const publishedDir = join(publishedRoot, uuid);
      seedSidecar(publishedDir, {
        name: 'Published Realm',
        iconURL: 'https://example.com/pub.svg',
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

      await runRealmConfigCardBackfill({
        dbAdapter,
        realmsRootPath,
        serverURL,
        bootstrapRealms: [],
      });

      const card = readCard(publishedDir) as {
        data: { attributes: Record<string, unknown> };
      };
      assert.deepEqual(card.data.attributes.cardInfo, {
        name: 'Published Realm',
      });
      assert.strictEqual(
        card.data.attributes.iconURL,
        'https://example.com/pub.svg',
      );
      assert.deepEqual(readSidecar(publishedDir), {});
    });

    test('migrates a published realm even when realm_registry has no row for it', async function (assert) {
      // Models the multi-instance startup race called out in PR review:
      // a peer process holds the registry-backfill advisory lock while
      // this process wins the config-card-backfill lock, so the
      // registry table is empty (or sparse) when this pass runs. The
      // disk-walk must still migrate the realm.
      const publishedRoot = join(realmsRootPath, PUBLISHED_DIRECTORY_NAME);
      const uuid = '00000000-0000-0000-0000-000000000002';
      const publishedDir = join(publishedRoot, uuid);
      seedSidecar(publishedDir, {
        name: 'Orphan Published Realm',
        backgroundURL: 'https://example.com/orphan-bg.png',
      });

      await runRealmConfigCardBackfill({
        dbAdapter,
        realmsRootPath,
        serverURL,
        bootstrapRealms: [],
      });

      const card = readCard(publishedDir) as {
        data: { attributes: Record<string, unknown> };
      };
      assert.deepEqual(card.data.attributes.cardInfo, {
        name: 'Orphan Published Realm',
      });
      assert.strictEqual(
        card.data.attributes.backgroundURL,
        'https://example.com/orphan-bg.png',
      );
      assert.deepEqual(readSidecar(publishedDir), {});
    });

    test('is idempotent across reruns', async function (assert) {
      const realmDir = join(realmsRootPath, 'luke', 'rerun');
      seedSidecar(realmDir, {
        name: 'Rerun',
        backgroundURL: 'https://example.com/bg.png',
      });

      await runRealmConfigCardBackfill({
        dbAdapter,
        realmsRootPath,
        serverURL,
        bootstrapRealms: [],
      });
      const firstCard = readCard(realmDir);
      const firstSidecar = readSidecar(realmDir);

      await runRealmConfigCardBackfill({
        dbAdapter,
        realmsRootPath,
        serverURL,
        bootstrapRealms: [],
      });

      assert.deepEqual(
        readCard(realmDir),
        firstCard,
        'card unchanged on rerun',
      );
      assert.deepEqual(
        readSidecar(realmDir),
        firstSidecar,
        'sidecar unchanged on rerun',
      );
    });

    test('tolerates malformed sidecar JSON without crashing', async function (assert) {
      const realmDir = join(realmsRootPath, 'luke', 'broken');
      ensureDirSync(realmDir);
      writeFileSync(join(realmDir, '.realm.json'), '{ not valid');

      await runRealmConfigCardBackfill({
        dbAdapter,
        realmsRootPath,
        serverURL,
        bootstrapRealms: [],
      });

      assert.notOk(cardExists(realmDir), 'no card written from broken sidecar');
      assert.strictEqual(
        readFileSync(join(realmDir, '.realm.json'), 'utf8'),
        '{ not valid',
        'malformed sidecar left untouched',
      );
    });

    test('tolerates a non-object sidecar JSON (array) without crashing', async function (assert) {
      const realmDir = join(realmsRootPath, 'luke', 'array');
      ensureDirSync(realmDir);
      writeFileSync(join(realmDir, '.realm.json'), '[1, 2, 3]');

      await runRealmConfigCardBackfill({
        dbAdapter,
        realmsRootPath,
        serverURL,
        bootstrapRealms: [],
      });

      assert.notOk(cardExists(realmDir));
      assert.strictEqual(
        readFileSync(join(realmDir, '.realm.json'), 'utf8'),
        '[1, 2, 3]',
        'array sidecar left untouched',
      );
    });
  });
});
