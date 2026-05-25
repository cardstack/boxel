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

function seedCard(realmDir: string, card: object) {
  ensureDirSync(realmDir);
  writeFileSync(join(realmDir, 'realm.json'), JSON.stringify(card, null, 2));
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

const REALM_CONFIG_ADOPTS_FROM = {
  module: 'https://cardstack.com/base/realm-config',
  name: 'RealmConfig',
};

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

    test('writes realm.json card from a source realm sidecar, migrates hostHome into a /-rule, trims all migrated keys', async function (assert) {
      const realmDir = join(realmsRootPath, 'luke', 'my-realm');
      seedSidecar(realmDir, {
        name: 'My Realm',
        backgroundURL: 'https://example.com/bg.png',
        iconURL: 'https://example.com/icon.svg',
        hostHome: 'http://localhost:4201/luke/my-realm/SiteConfig/home-card-id',
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
              hostRoutingRules: [{ path: '/' }],
            },
            relationships: {
              'hostRoutingRules.0.instance': {
                links: { self: './SiteConfig/home-card-id' },
              },
            },
            meta: { adoptsFrom: REALM_CONFIG_ADOPTS_FROM },
          },
        },
        'card written in canonical RealmConfig shape with split relationships',
      );
      assert.deepEqual(readSidecar(realmDir), {}, 'sidecar fully trimmed');
    });

    test('drops interactHome from the sidecar without writing it to the card', async function (assert) {
      const realmDir = join(realmsRootPath, 'luke', 'interact-only');
      seedSidecar(realmDir, {
        name: 'IH Realm',
        interactHome: 'http://localhost:4201/luke/interact-only/something',
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
      assert.deepEqual(card.data.attributes.cardInfo, { name: 'IH Realm' });
      assert.notOk(
        'interactHome' in card.data.attributes,
        'interactHome not on card',
      );
      assert.notOk(
        'hostRoutingRules' in card.data.attributes,
        'no spurious hostRoutingRules array',
      );
      assert.deepEqual(readSidecar(realmDir), {}, 'interactHome trimmed');
    });

    test('adds a /-rule to an existing card and trims hostHome from the sidecar', async function (assert) {
      const realmDir = join(realmsRootPath, 'luke', 'hosthome-only-existing');
      seedSidecar(realmDir, {
        hostHome:
          'http://localhost:4201/luke/hosthome-only-existing/SiteConfig/h1',
      });
      seedCard(realmDir, {
        data: {
          type: 'card',
          attributes: {
            cardInfo: { name: 'Existing' },
            iconURL: 'https://example.com/x.svg',
          },
          meta: { adoptsFrom: REALM_CONFIG_ADOPTS_FROM },
        },
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
              cardInfo: { name: 'Existing' },
              iconURL: 'https://example.com/x.svg',
              hostRoutingRules: [{ path: '/' }],
            },
            relationships: {
              'hostRoutingRules.0.instance': {
                links: { self: './SiteConfig/h1' },
              },
            },
            meta: { adoptsFrom: REALM_CONFIG_ADOPTS_FROM },
          },
        },
        'existing card augmented with /-rule and matching relationship',
      );
      assert.deepEqual(readSidecar(realmDir), {}, 'sidecar fully trimmed');
    });

    test('preserves an existing /-rule when sidecar hostHome points elsewhere (log + no overwrite)', async function (assert) {
      const realmDir = join(realmsRootPath, 'luke', 'slash-rule-already');
      seedSidecar(realmDir, {
        hostHome:
          'http://localhost:4201/luke/slash-rule-already/SiteConfig/sidecar-target',
      });
      const existingCard = {
        data: {
          type: 'card',
          attributes: {
            hostRoutingRules: [{ path: '/' }, { path: '/about' }],
          },
          relationships: {
            'hostRoutingRules.0.instance': {
              links: { self: './SiteConfig/card-target' },
            },
            'hostRoutingRules.1.instance': {
              links: { self: './AboutPage/x' },
            },
          },
          meta: { adoptsFrom: REALM_CONFIG_ADOPTS_FROM },
        },
      };
      seedCard(realmDir, existingCard);

      await runRealmConfigCardBackfill({
        dbAdapter,
        realmsRootPath,
        serverURL,
        bootstrapRealms: [],
      });

      assert.deepEqual(
        readCard(realmDir),
        existingCard,
        'existing /-rule wins; card unchanged',
      );
      assert.deepEqual(
        readSidecar(realmDir),
        {},
        'sidecar still trimmed (hostHome dropped) even though card was the source of truth',
      );
    });

    test('drops interactHome from sidecar when card already exists, without touching the card', async function (assert) {
      const realmDir = join(realmsRootPath, 'luke', 'ih-existing-card');
      seedSidecar(realmDir, {
        interactHome: 'http://localhost:4201/luke/ih-existing-card/something',
      });
      const existingCard = {
        data: {
          type: 'card',
          attributes: { cardInfo: { name: 'Existing' } },
          meta: { adoptsFrom: REALM_CONFIG_ADOPTS_FROM },
        },
      };
      seedCard(realmDir, existingCard);

      await runRealmConfigCardBackfill({
        dbAdapter,
        realmsRootPath,
        serverURL,
        bootstrapRealms: [],
      });

      assert.deepEqual(readCard(realmDir), existingCard, 'card unchanged');
      assert.deepEqual(readSidecar(realmDir), {}, 'interactHome trimmed');
    });

    test('no-op when card exists and sidecar has nothing migratable', async function (assert) {
      const realmDir = join(realmsRootPath, 'luke', 'noop');
      seedSidecar(realmDir, {
        name: 'Stale Sidecar Name',
        backgroundURL: 'https://example.com/sidecar-bg.png',
      });
      const existingCard = {
        data: {
          type: 'card',
          attributes: {
            cardInfo: { name: 'Card Name' },
            backgroundURL: 'https://example.com/card-bg.png',
          },
          meta: { adoptsFrom: REALM_CONFIG_ADOPTS_FROM },
        },
      };
      seedCard(realmDir, existingCard);

      await runRealmConfigCardBackfill({
        dbAdapter,
        realmsRootPath,
        serverURL,
        bootstrapRealms: [],
      });

      assert.deepEqual(readCard(realmDir), existingCard, 'card unchanged');
      assert.deepEqual(
        readSidecar(realmDir),
        {
          name: 'Stale Sidecar Name',
          backgroundURL: 'https://example.com/sidecar-bg.png',
        },
        'sidecar untouched — name/bg are card-owned when card exists',
      );
    });

    test('writes a card when only hostHome is in the sidecar and no card exists', async function (assert) {
      const realmDir = join(realmsRootPath, 'luke', 'hosthome-only-fresh');
      seedSidecar(realmDir, {
        hostHome:
          'http://localhost:4201/luke/hosthome-only-fresh/SiteConfig/h2',
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
              hostRoutingRules: [{ path: '/' }],
            },
            relationships: {
              'hostRoutingRules.0.instance': {
                links: { self: './SiteConfig/h2' },
              },
            },
            meta: { adoptsFrom: REALM_CONFIG_ADOPTS_FROM },
          },
        },
        'fresh card carries only the /-rule + relationship',
      );
      assert.deepEqual(readSidecar(realmDir), {}, 'sidecar fully trimmed');
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

    test('migrates hostRoutingRules from sidecar into split attributes/relationships shape', async function (assert) {
      const realmDir = join(realmsRootPath, 'luke', 'with-routes');
      seedSidecar(realmDir, {
        name: 'With Routes',
        hostRoutingRules: [
          {
            path: '/',
            instance:
              'http://localhost:4201/luke/with-routes/PersonalHome/home',
          },
          {
            path: '/quiz',
            instance: 'http://localhost:4201/luke/with-routes/Quiz/q1',
          },
        ],
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
              cardInfo: { name: 'With Routes' },
              hostRoutingRules: [{ path: '/' }, { path: '/quiz' }],
            },
            relationships: {
              'hostRoutingRules.0.instance': {
                links: { self: './PersonalHome/home' },
              },
              'hostRoutingRules.1.instance': {
                links: { self: './Quiz/q1' },
              },
            },
            meta: { adoptsFrom: REALM_CONFIG_ADOPTS_FROM },
          },
        },
        'hostRoutingRules split into {path} attributes + linksTo relationships',
      );
      assert.deepEqual(readSidecar(realmDir), {});
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
        hostHome: 'http://localhost:4201/_published/abc/SiteConfig/p1',
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

      assert.deepEqual(
        readCard(publishedDir),
        {
          data: {
            type: 'card',
            attributes: {
              cardInfo: { name: 'Published Realm' },
              iconURL: 'https://example.com/pub.svg',
              hostRoutingRules: [{ path: '/' }],
            },
            relationships: {
              'hostRoutingRules.0.instance': {
                links: { self: './SiteConfig/p1' },
              },
            },
            meta: { adoptsFrom: REALM_CONFIG_ADOPTS_FROM },
          },
        },
        'published realm card has /-rule with relative link computed against the registry URL',
      );
      assert.deepEqual(readSidecar(publishedDir), {});
    });

    test('migrates non-hostHome fields for a published realm even when realm_registry has no row', async function (assert) {
      // Multi-instance startup race: registry-backfill held by a peer
      // while this process wins the config-card-backfill lock. The
      // card-keys-only migration still runs; the hostHome migration is
      // skipped (URL is required to compute the relative link) and the
      // sidecar's hostHome is preserved for a future boot.
      const publishedRoot = join(realmsRootPath, PUBLISHED_DIRECTORY_NAME);
      const uuid = '00000000-0000-0000-0000-000000000002';
      const publishedDir = join(publishedRoot, uuid);
      seedSidecar(publishedDir, {
        name: 'Orphan Published Realm',
        backgroundURL: 'https://example.com/orphan-bg.png',
        hostHome: 'http://localhost:4201/_published/abc/SiteConfig/orphan',
      });

      await runRealmConfigCardBackfill({
        dbAdapter,
        realmsRootPath,
        serverURL,
        bootstrapRealms: [],
      });

      const card = readCard(publishedDir) as {
        data: {
          attributes: Record<string, unknown>;
          relationships?: Record<string, unknown>;
        };
      };
      assert.deepEqual(card.data.attributes.cardInfo, {
        name: 'Orphan Published Realm',
      });
      assert.strictEqual(
        card.data.attributes.backgroundURL,
        'https://example.com/orphan-bg.png',
      );
      assert.notOk(
        'hostRoutingRules' in card.data.attributes,
        'no /-rule added; hostHome migration was deferred',
      );
      assert.deepEqual(
        readSidecar(publishedDir),
        {
          hostHome: 'http://localhost:4201/_published/abc/SiteConfig/orphan',
        },
        'hostHome preserved in sidecar so a future boot can complete the migration',
      );
    });

    test('is idempotent across reruns', async function (assert) {
      const realmDir = join(realmsRootPath, 'luke', 'rerun');
      seedSidecar(realmDir, {
        name: 'Rerun',
        backgroundURL: 'https://example.com/bg.png',
        hostHome: 'http://localhost:4201/luke/rerun/SiteConfig/r1',
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

    test('leaves an unparseable existing card alone (does not overwrite)', async function (assert) {
      const realmDir = join(realmsRootPath, 'luke', 'broken-card');
      seedSidecar(realmDir, {
        hostHome: 'http://localhost:4201/luke/broken-card/SiteConfig/whatever',
      });
      writeFileSync(join(realmDir, 'realm.json'), '{ partly written');

      await runRealmConfigCardBackfill({
        dbAdapter,
        realmsRootPath,
        serverURL,
        bootstrapRealms: [],
      });

      assert.strictEqual(
        readFileSync(join(realmDir, 'realm.json'), 'utf8'),
        '{ partly written',
        'malformed card left untouched',
      );
      assert.deepEqual(
        readSidecar(realmDir),
        {
          hostHome:
            'http://localhost:4201/luke/broken-card/SiteConfig/whatever',
        },
        'sidecar untouched when we cannot safely modify the card',
      );
    });

    test('skips invalid entries in sidecar hostRoutingRules without misaligning relationship keys', async function (assert) {
      // Pre-fix: relationship keys used the original sidecar array index
      // while attributes.hostRoutingRules used a push-only output index,
      // so a null entry before a valid one would orphan the link
      // (attribute at [0], relationship at "hostRoutingRules.1.instance").
      const realmDir = join(realmsRootPath, 'luke', 'sparse-rules');
      seedSidecar(realmDir, {
        name: 'Sparse',
        hostRoutingRules: [
          null,
          {
            path: '/',
            instance: 'http://localhost:4201/luke/sparse-rules/Home/h',
          },
        ],
      });

      await runRealmConfigCardBackfill({
        dbAdapter,
        realmsRootPath,
        serverURL,
        bootstrapRealms: [],
      });

      const card = readCard(realmDir) as {
        data: {
          attributes: { hostRoutingRules?: { path?: string }[] };
          relationships?: Record<string, { links: { self: string | null } }>;
        };
      };
      assert.deepEqual(
        card.data.attributes.hostRoutingRules,
        [{ path: '/' }],
        'invalid entry filtered out, valid /-rule landed at index 0',
      );
      assert.deepEqual(
        card.data.relationships?.['hostRoutingRules.0.instance'],
        { links: { self: './Home/h' } },
        'relationship indexed to match the post-filter attribute position',
      );
      assert.notOk(
        card.data.relationships?.['hostRoutingRules.1.instance'],
        'no orphaned relationship at the original (unfiltered) index',
      );
    });

    test('treats a card whose `data` is not a plain object as unparseable', async function (assert) {
      // Parses cleanly as JSON, has a `data` key, but `data` is a string.
      // augmentExistingCard would mutate `card.data.attributes` and throw
      // (TypeError on a primitive); we want migrateOne to skip cleanly
      // instead of bubbling out and aborting the rest of the step.
      // Subsequent realms in the same backfill walk should still run.
      const brokenDir = join(realmsRootPath, 'luke', 'broken-data');
      seedSidecar(brokenDir, {
        hostHome: 'http://localhost:4201/luke/broken-data/SiteConfig/x',
      });
      writeFileSync(
        join(brokenDir, 'realm.json'),
        JSON.stringify({ data: 'oops' }),
      );

      const goodDir = join(realmsRootPath, 'luke', 'good-after-broken');
      seedSidecar(goodDir, {
        name: 'Good After Broken',
        hostHome: 'http://localhost:4201/luke/good-after-broken/SiteConfig/g',
      });

      await runRealmConfigCardBackfill({
        dbAdapter,
        realmsRootPath,
        serverURL,
        bootstrapRealms: [],
      });

      assert.strictEqual(
        readFileSync(join(brokenDir, 'realm.json'), 'utf8'),
        JSON.stringify({ data: 'oops' }),
        'malformed-shape card left untouched',
      );
      assert.deepEqual(
        readSidecar(brokenDir),
        {
          hostHome: 'http://localhost:4201/luke/broken-data/SiteConfig/x',
        },
        'sidecar untouched when card is structurally unsafe to modify',
      );

      // Critical: the broken realm did not abort the walk.
      const goodCard = readCard(goodDir) as {
        data: {
          attributes: Record<string, unknown>;
          relationships?: Record<string, unknown>;
        };
      };
      assert.deepEqual(goodCard.data.attributes.cardInfo, {
        name: 'Good After Broken',
      });
      assert.deepEqual(
        goodCard.data.relationships?.['hostRoutingRules.0.instance'],
        { links: { self: './SiteConfig/g' } },
        'realm encountered after the broken one still got its /-rule',
      );
    });
  });
});
