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
  fullReindex,
  insertPermissions,
  logger,
  unarchiveRealm,
  uuidv4,
} from '@cardstack/runtime-common';

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

  module('getFullReindexRealmUrls', function () {
    async function seedSourceRealm(realmURL: string) {
      await insertSourceRealmInRegistry(dbAdapter, {
        url: realmURL,
        diskId: uuidv4(),
        ownerUsername: '@owner:localhost',
      });
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
  });
});
