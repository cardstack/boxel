import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { PgAdapter } from '@cardstack/postgres';
import type {
  IndexWriter,
  DefinitionLookup,
  Prerenderer,
  QueuePublisher,
  VirtualNetwork,
} from '@cardstack/runtime-common';
import {
  archiveRealm,
  baseRealm,
  fullReindex,
  insertPermissions,
  logger,
  systemInitiatedPriority,
  unarchiveRealm,
  userInitiatedPriority,
  uuidv4,
} from '@cardstack/runtime-common';
import { systemInitiatedIndexPriority } from '@cardstack/runtime-common/jobs/indexing';

import { getFullReindexRealmUrls } from '../lib/full-reindex-realm-urls.ts';
import {
  insertSourceRealmInRegistry,
  upsertPublishedRealmInRegistry,
} from '../lib/realm-registry-writes.ts';
import { setupDB } from './helpers/index.ts';

module(basename(import.meta.filename), function (hooks) {
  let dbAdapter: PgAdapter;
  let queuePublisher: QueuePublisher;

  setupDB(hooks, {
    beforeEach: async (
      _dbAdapter: PgAdapter,
      _publisher: QueuePublisher,
    ): Promise<void> => {
      dbAdapter = _dbAdapter;
      queuePublisher = _publisher;
    },
  });

  function buildFullReindexTask() {
    return fullReindex({
      reportStatus: () => {},
      log: logger('full-reindex-test'),
      dbAdapter,
      queuePublisher,
      indexWriter: null as unknown as IndexWriter,
      prerenderer: null as unknown as Prerenderer,
      definitionLookup: null as unknown as DefinitionLookup,
      virtualNetwork: null as unknown as VirtualNetwork,
      matrixURL: 'http://localhost:8008',
      getReader: () => {
        throw new Error('getReader is not used by full-reindex');
      },
      getAuthedFetch: async () => globalThis.fetch,
      createPrerenderAuth: () => '',
    });
  }

  async function insertPublishedRealm({
    sourceRealmURL,
    publishedRealmURL,
    ownerUsername,
  }: {
    sourceRealmURL: string;
    publishedRealmURL: string;
    ownerUsername: string;
  }) {
    await upsertPublishedRealmInRegistry(dbAdapter, {
      publishedRealmURL,
      publishedRealmId: uuidv4(),
      ownerUsername,
      sourceRealmURL,
      lastPublishedAt: Date.now(),
    });
  }

  test('enqueues jobs for source and published realms using the source owner', async function (assert) {
    const ownerUserId = '@owner:localhost';
    const sourceRealmURL = 'http://example.com/source/';
    const publishedRealmURL = 'http://example.com/published/';

    await insertPermissions(dbAdapter, new URL(sourceRealmURL), {
      [ownerUserId]: ['read', 'realm-owner'],
    });

    await insertPublishedRealm({
      sourceRealmURL,
      publishedRealmURL,
      ownerUsername: '@realm/published-owner',
    });

    let reindex = buildFullReindexTask();
    await reindex({
      realmUrls: [sourceRealmURL, publishedRealmURL],
    });

    type JobArgs = {
      realmURL: string;
      realmUsername: string;
      clearLastModified: boolean;
    };
    type JobRow = {
      job_type: string;
      concurrency_group: string | null;
      args: JobArgs;
    };

    let jobs = (await dbAdapter.execute('select * from jobs')) as JobRow[];
    assert.strictEqual(jobs.length, 2, 'from-scratch jobs were enqueued');

    let jobsByRealm = new Map(jobs.map((job) => [job.args.realmURL, job]));

    let sourceJob = jobsByRealm.get(sourceRealmURL);
    assert.ok(sourceJob, 'source realm job exists');
    assert.strictEqual(
      sourceJob?.job_type,
      'from-scratch-index',
      'source job type is correct',
    );
    assert.strictEqual(
      sourceJob?.concurrency_group,
      `indexing:${sourceRealmURL}`,
      'source job concurrency group is correct',
    );
    assert.deepEqual(
      sourceJob?.args,
      {
        realmURL: sourceRealmURL,
        realmUsername: 'owner',
        // full-reindex enqueues with clearLastModified: true so every
        // file re-renders even when its mtime is unchanged. Surfaced in
        // args so the from-scratch coalesce can refuse to attach a
        // clearing publish to an already-running same-realm
        // from-scratch.
        clearLastModified: true,
      },
      'source job args are correct',
    );

    let publishedJob = jobsByRealm.get(publishedRealmURL);
    assert.ok(publishedJob, 'published realm job exists');
    assert.strictEqual(
      publishedJob?.job_type,
      'from-scratch-index',
      'published job type is correct',
    );
    assert.strictEqual(
      publishedJob?.concurrency_group,
      `indexing:${publishedRealmURL}`,
      'published job concurrency group is correct',
    );
    assert.deepEqual(
      publishedJob?.args,
      {
        realmURL: publishedRealmURL,
        realmUsername: 'owner',
        clearLastModified: true,
      },
      'published job args use the source owner',
    );
  });

  test('skips bot-owned realms', async function (assert) {
    const botUserId = '@realm/bot:localhost';
    const botRealmURL = 'http://example.com/bot/';

    await insertPermissions(dbAdapter, new URL(botRealmURL), {
      [botUserId]: ['read', 'realm-owner'],
    });

    let reindex = buildFullReindexTask();
    await reindex({ realmUrls: [botRealmURL] });

    let jobs = await dbAdapter.execute('select * from jobs');
    assert.strictEqual(
      jobs.length,
      0,
      'no jobs are enqueued for bot-owned realms',
    );
  });

  test('enqueues the base realm above the system tier, every other realm at it', async function (assert) {
    const sourceRealmURL = 'http://example.com/source/';

    await insertPermissions(dbAdapter, new URL(sourceRealmURL), {
      '@owner:localhost': ['read', 'realm-owner'],
    });
    await insertPermissions(dbAdapter, new URL(baseRealm.url), {
      '@base_realm:localhost': ['read', 'realm-owner'],
    });

    let reindex = buildFullReindexTask();
    await reindex({ realmUrls: [baseRealm.url, sourceRealmURL] });

    type JobRow = { priority: number; args: { realmURL: string } };
    let jobs = (await dbAdapter.execute('select * from jobs')) as JobRow[];
    let priorityByRealm = new Map(
      jobs.map((job) => [job.args.realmURL, job.priority]),
    );

    // The sweep's own jobs are the backlog base would otherwise queue behind,
    // so base has to be reachable by a pool the backlog can't reach.
    assert.strictEqual(
      priorityByRealm.get(baseRealm.url),
      userInitiatedPriority,
      'the base realm is enqueued at the tier the high-priority pool serves',
    );
    assert.strictEqual(
      priorityByRealm.get(sourceRealmURL),
      systemInitiatedPriority,
      'other realms stay at the system tier',
    );
  });

  module('getFullReindexRealmUrls', function () {
    async function seedSourceRealm(realmURL: string) {
      await insertSourceRealmInRegistry(dbAdapter, {
        url: realmURL,
        diskId: uuidv4(),
        ownerUsername: '@owner:localhost',
      });
    }

    // Bootstrap rows are written by the boot-time registry backfill, not by
    // any of the mutation helpers (which all refuse to touch kind='bootstrap'
    // rows), so seed one directly.
    async function seedBootstrapRealm(realmURL: string) {
      await dbAdapter.execute(
        `INSERT INTO realm_registry (url, kind, disk_id, owner_username, pinned)
         VALUES ($1, 'bootstrap', $2, 'system', true)`,
        { bind: [realmURL, `/persistent/${uuidv4()}`] },
      );
    }

    test('returns only active realms from realm_registry', async function (assert) {
      const activeA = 'http://example.com/active-a/';
      const activeB = 'http://example.com/active-b/';
      const archived = 'http://example.com/archived/';

      await seedSourceRealm(activeA);
      await seedSourceRealm(activeB);
      await seedSourceRealm(archived);
      await archiveRealm(dbAdapter, new URL(archived));

      let urls = await getFullReindexRealmUrls(dbAdapter);
      assert.deepEqual(
        [...urls].sort(),
        [activeA, activeB].sort(),
        'archived realms are excluded from the sweep source',
      );
    });

    test('an unarchived realm returns to the sweep source', async function (assert) {
      const realmURL = 'http://example.com/restored/';

      await seedSourceRealm(realmURL);
      await archiveRealm(dbAdapter, new URL(realmURL));
      assert.notOk(
        (await getFullReindexRealmUrls(dbAdapter)).includes(realmURL),
        'archived realm is absent',
      );

      await unarchiveRealm(dbAdapter, new URL(realmURL));
      assert.ok(
        (await getFullReindexRealmUrls(dbAdapter)).includes(realmURL),
        'unarchived realm reappears',
      );
    });

    test('bootstrap realms sort ahead of every other realm', async function (assert) {
      // Both user realms sort before the base realm's url — the shape that
      // puts base last in a fleet-wide sweep under url ordering alone.
      const userRealm = 'https://app.boxel.ai/alice/notes/';
      const publishedRealm = 'https://boxel.site/zeta/';
      const catalogRealm = 'https://app.boxel.ai/catalog/';

      await seedSourceRealm(userRealm);
      await seedSourceRealm(publishedRealm);
      await seedBootstrapRealm(catalogRealm);
      await seedBootstrapRealm(baseRealm.url);

      assert.deepEqual(
        await getFullReindexRealmUrls(dbAdapter),
        [catalogRealm, baseRealm.url, userRealm, publishedRealm],
        'bootstrap realms come first, then each group ordered by url',
      );
    });
  });

  module('systemInitiatedIndexPriority', function () {
    test('the base realm is elevated above the system tier', function (assert) {
      assert.strictEqual(
        systemInitiatedIndexPriority(baseRealm.url),
        userInitiatedPriority,
        'the url form every deployment configures base with',
      );
      assert.strictEqual(
        systemInitiatedIndexPriority('@cardstack/base/'),
        userInitiatedPriority,
        'the alias form main.ts registers as the same realm',
      );
    });

    test('every other realm stays at the system tier', function (assert) {
      for (let realmURL of [
        'https://app.boxel.ai/catalog/',
        'https://app.boxel.ai/skills/',
        'https://boxel.site/zeta/',
        'http://example.com/source/',
        // Containing the base realm's path is not being the base realm: the
        // comparison is against the whole realm url, not a path segment.
        'https://app.boxel.ai/alice/base/',
      ]) {
        assert.strictEqual(
          systemInitiatedIndexPriority(realmURL),
          systemInitiatedPriority,
          `${realmURL} stays at the system tier`,
        );
      }
    });
  });
});
