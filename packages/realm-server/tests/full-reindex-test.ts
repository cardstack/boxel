import { module, test } from 'qunit';
import { basename } from 'path';
import type { PgAdapter } from '@cardstack/postgres';
import type {
  IndexWriter,
  Prerenderer,
  QueuePublisher,
} from '@cardstack/runtime-common';
import {
  asExpressions,
  fullReindex,
  insert,
  insertPermissions,
  logger,
  query,
  uuidv4,
} from '@cardstack/runtime-common';

import { setupDB } from './helpers';

module(basename(__filename), function (hooks) {
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
    let { nameExpressions, valueExpressions } = asExpressions({
      id: uuidv4(),
      owner_username: ownerUsername,
      source_realm_url: sourceRealmURL,
      published_realm_url: publishedRealmURL,
      last_published_at: Date.now().toString(),
    });
    await query(
      dbAdapter,
      insert('published_realms', nameExpressions, valueExpressions),
    );
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

    type JobArgs = { realmURL: string; realmUsername: string };
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
});
