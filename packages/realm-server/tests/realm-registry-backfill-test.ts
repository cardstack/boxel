import { module, test } from 'qunit';
import { basename, join } from 'path';
import { dirSync, type DirResult } from 'tmp';
import { ensureDirSync, writeFileSync } from 'fs-extra';
import type { PgAdapter } from '@cardstack/postgres';
import {
  asExpressions,
  insert,
  insertPermissions,
  query,
  param,
  PUBLISHED_DIRECTORY_NAME,
} from '@cardstack/runtime-common';
import { setupDB } from './helpers';
import { runRegistryBackfill } from '../lib/realm-registry-backfill';

async function publicReadGranted(
  dbAdapter: PgAdapter,
  realmURL: string,
): Promise<boolean> {
  let rows = (await query(dbAdapter, [
    `SELECT read FROM realm_user_permissions WHERE realm_url =`,
    param(realmURL),
    `AND username = '*'`,
  ])) as Array<{ read: boolean }>;
  return rows.length > 0 && rows[0].read === true;
}

interface RegistryRow {
  url: string;
  kind: string;
  disk_id: string;
  owner_username: string;
  source_url: string | null;
  last_published_at: string | null;
  pinned: boolean;
}

async function allRegistryRows(dbAdapter: PgAdapter): Promise<RegistryRow[]> {
  let rows = (await query(dbAdapter, [
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

function seedRealmJson(realmDir: string, payload: Record<string, unknown>) {
  ensureDirSync(realmDir);
  writeFileSync(
    join(realmDir, '.realm.json'),
    JSON.stringify(payload, null, 2),
  );
}

module(basename(__filename), function () {
  module('runRegistryBackfill', function (hooks) {
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

    test('inserts a bootstrap row with pinned=true, owner_username=system, absolute disk_id', async function (assert) {
      const bootstrapPath = join(dir.name, 'base');
      seedRealmJson(bootstrapPath, { name: 'base' });

      await runRegistryBackfill({
        dbAdapter,
        realmsRootPath,
        serverURL,
        bootstrapRealms: [
          { diskPath: bootstrapPath, url: 'https://cardstack.com/base/' },
        ],
      });

      const rows = (await allRegistryRows(dbAdapter)).filter(
        (r) => r.kind === 'bootstrap',
      );
      assert.strictEqual(rows.length, 1, 'one bootstrap row written');
      assert.strictEqual(rows[0].url, 'https://cardstack.com/base/');
      assert.true(rows[0].pinned, 'pinned=true');
      assert.strictEqual(
        rows[0].owner_username,
        'system',
        'owner_username is sentinel',
      );
      assert.ok(
        rows[0].disk_id.endsWith('/base'),
        `disk_id is an absolute path ending in /base (got ${rows[0].disk_id})`,
      );
    });

    test('inserts source rows from disk scan with pinned=false', async function (assert) {
      seedRealmJson(join(realmsRootPath, 'luke', 'my-realm'), {
        name: 'my-realm',
      });
      seedRealmJson(join(realmsRootPath, 'luke', 'other-realm'), {
        name: 'other-realm',
      });
      // A directory without .realm.json should be skipped:
      ensureDirSync(join(realmsRootPath, 'luke', 'not-a-realm'));

      await runRegistryBackfill({
        dbAdapter,
        realmsRootPath,
        serverURL,
        bootstrapRealms: [],
      });

      const rows = (await allRegistryRows(dbAdapter)).filter(
        (r) => r.kind === 'source',
      );
      assert.strictEqual(rows.length, 2, 'two source rows written');
      assert.deepEqual(
        rows.map((r) => r.url),
        [
          'http://localhost:4201/luke/my-realm/',
          'http://localhost:4201/luke/other-realm/',
        ],
      );
      for (const r of rows) {
        assert.false(r.pinned);
        assert.strictEqual(r.owner_username, 'luke');
        assert.strictEqual(r.source_url, null);
        assert.strictEqual(r.last_published_at, null);
      }
    });

    test('skips the _published directory during source-realm scan', async function (assert) {
      seedRealmJson(join(realmsRootPath, 'luke', 'src'), { name: 'src' });
      // Create a _published/<uuid>/.realm.json — should NOT be picked up as
      // a source realm. (Published rows are written by the publish handler
      // directly into realm_registry; the boot-time scan does not recover
      // them from disk.)
      seedRealmJson(
        join(realmsRootPath, PUBLISHED_DIRECTORY_NAME, 'some-uuid'),
        { name: 'pub' },
      );

      await runRegistryBackfill({
        dbAdapter,
        realmsRootPath,
        serverURL,
        bootstrapRealms: [],
      });

      const rows = await allRegistryRows(dbAdapter);
      assert.strictEqual(
        rows.filter((r) => r.kind === 'source').length,
        1,
        'only the non-_published source realm was registered',
      );
      assert.strictEqual(
        rows.filter((r) => r.kind === 'published').length,
        0,
        'boot-time scan does not write published rows from disk',
      );
    });

    test('is idempotent: running twice produces the same rows', async function (assert) {
      const bootstrapPath = join(dir.name, 'base');
      seedRealmJson(bootstrapPath, { name: 'base' });
      seedRealmJson(join(realmsRootPath, 'luke', 'src'), { name: 'src' });

      const opts = {
        dbAdapter,
        realmsRootPath,
        serverURL,
        bootstrapRealms: [
          { diskPath: bootstrapPath, url: 'https://cardstack.com/base/' },
        ],
      };
      await runRegistryBackfill(opts);
      const firstRun = await allRegistryRows(dbAdapter);

      await runRegistryBackfill(opts);
      const secondRun = await allRegistryRows(dbAdapter);

      assert.deepEqual(
        secondRun.map((r) => [r.url, r.kind, r.disk_id, r.pinned]),
        firstRun.map((r) => [r.url, r.kind, r.disk_id, r.pinned]),
        'second run produces the same logical rows',
      );
      assert.strictEqual(secondRun.length, 2);
    });

    test('re-homing a bootstrap path updates disk_id on second run', async function (assert) {
      const pathA = join(dir.name, 'base-a');
      const pathB = join(dir.name, 'base-b');
      seedRealmJson(pathA, { name: 'base' });
      seedRealmJson(pathB, { name: 'base' });

      await runRegistryBackfill({
        dbAdapter,
        realmsRootPath,
        serverURL,
        bootstrapRealms: [
          { diskPath: pathA, url: 'https://cardstack.com/base/' },
        ],
      });
      const firstDiskId = (await allRegistryRows(dbAdapter)).find(
        (r) => r.kind === 'bootstrap',
      )!.disk_id;
      assert.ok(firstDiskId.endsWith('/base-a'), 'first disk_id is base-a');

      await runRegistryBackfill({
        dbAdapter,
        realmsRootPath,
        serverURL,
        bootstrapRealms: [
          { diskPath: pathB, url: 'https://cardstack.com/base/' },
        ],
      });
      const secondDiskId = (await allRegistryRows(dbAdapter)).find(
        (r) => r.kind === 'bootstrap',
      )!.disk_id;
      assert.ok(
        secondDiskId.endsWith('/base-b'),
        'second disk_id is base-b (rehomed)',
      );
    });

    module('env-mode public-read parity', function (envHooks) {
      let priorBoxelEnvironment: string | undefined;
      const envSkillsURL = 'https://realm-server.test-env.localhost/skills/';
      const envPrivateURL = 'https://realm-server.test-env.localhost/private/';
      const stdSkillsURL = 'http://localhost:4201/skills/';

      envHooks.beforeEach(function () {
        priorBoxelEnvironment = process.env.BOXEL_ENVIRONMENT;
        process.env.BOXEL_ENVIRONMENT = 'test-env';
      });
      envHooks.afterEach(function () {
        if (priorBoxelEnvironment === undefined) {
          delete process.env.BOXEL_ENVIRONMENT;
        } else {
          process.env.BOXEL_ENVIRONMENT = priorBoxelEnvironment;
        }
      });

      test('grants public read at the env-mode URL for an already-public path', async function (assert) {
        // Stand in for the migration seed that makes the standard-mode skills
        // realm public.
        await insertPermissions(dbAdapter, new URL(stdSkillsURL), {
          '*': ['read'],
        });
        const bootstrapPath = join(dir.name, 'skills');
        seedRealmJson(bootstrapPath, { name: 'skills' });

        await runRegistryBackfill({
          dbAdapter,
          realmsRootPath,
          serverURL,
          bootstrapRealms: [{ diskPath: bootstrapPath, url: envSkillsURL }],
        });

        assert.true(
          await publicReadGranted(dbAdapter, envSkillsURL),
          'env-mode skills realm is now public-readable',
        );
      });

      test('does not promote a realm whose path is not already public', async function (assert) {
        await insertPermissions(dbAdapter, new URL(stdSkillsURL), {
          '*': ['read'],
        });
        const bootstrapPath = join(dir.name, 'private');
        seedRealmJson(bootstrapPath, { name: 'private' });

        await runRegistryBackfill({
          dbAdapter,
          realmsRootPath,
          serverURL,
          bootstrapRealms: [{ diskPath: bootstrapPath, url: envPrivateURL }],
        });

        assert.false(
          await publicReadGranted(dbAdapter, envPrivateURL),
          'a path with no existing public grant stays private',
        );
      });

      test('is a no-op when BOXEL_ENVIRONMENT is unset', async function (assert) {
        delete process.env.BOXEL_ENVIRONMENT;
        await insertPermissions(dbAdapter, new URL(stdSkillsURL), {
          '*': ['read'],
        });
        const bootstrapPath = join(dir.name, 'skills');
        seedRealmJson(bootstrapPath, { name: 'skills' });

        await runRegistryBackfill({
          dbAdapter,
          realmsRootPath,
          serverURL,
          bootstrapRealms: [{ diskPath: bootstrapPath, url: envSkillsURL }],
        });

        assert.false(
          await publicReadGranted(dbAdapter, envSkillsURL),
          'standard mode does not seed env-mode parity rows',
        );
      });
    });

    test('bootstrap upsert does not clobber a non-bootstrap row with a colliding URL', async function (assert) {
      const { valueExpressions, nameExpressions } = asExpressions({
        url: 'http://localhost:4201/luke/app/',
        kind: 'source',
        disk_id: 'luke/app',
        owner_username: 'luke',
        pinned: false,
      });
      await query(
        dbAdapter,
        insert('realm_registry', nameExpressions, valueExpressions),
      );

      const typoPath = join(dir.name, 'typo');
      seedRealmJson(typoPath, { name: 'typo' });

      await runRegistryBackfill({
        dbAdapter,
        realmsRootPath,
        serverURL,
        bootstrapRealms: [
          { diskPath: typoPath, url: 'http://localhost:4201/luke/app/' },
        ],
      });

      const rows = await allRegistryRows(dbAdapter);
      const row = rows.find((r) => r.url === 'http://localhost:4201/luke/app/');
      assert.strictEqual(row!.kind, 'source', 'kind unchanged');
      assert.strictEqual(row!.disk_id, 'luke/app', 'disk_id unchanged');
      assert.strictEqual(row!.owner_username, 'luke');
    });
  });
});
