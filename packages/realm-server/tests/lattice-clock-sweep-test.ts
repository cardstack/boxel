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
  insertPermissions,
  latticeClockSweep,
  logger,
  systemInitiatedPriority,
} from '@cardstack/runtime-common';
import { setupDB } from './helpers/index.ts';

// Time grain: a clock-reading computed stores the earliest boundary at which
// its value can differ (boxel_index.valid_until). The sweep must re-index
// exactly the rows whose boundary has passed, as the realm owner, one
// coalesced job per realm, and nothing else.
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

  function buildSweep() {
    return latticeClockSweep({
      reportStatus: () => {},
      log: logger('lattice-clock-sweep-test'),
      dbAdapter,
      queuePublisher,
      indexWriter: null as unknown as IndexWriter,
      prerenderer: null as unknown as Prerenderer,
      definitionLookup: null as unknown as DefinitionLookup,
      virtualNetwork: null as unknown as VirtualNetwork,
      matrixURL: 'http://localhost:8008',
      getReader: () => {
        throw new Error('getReader is not used by the clock sweep');
      },
      getAuthedFetch: async () => globalThis.fetch,
      createPrerenderAuth: () => '',
    });
  }

  async function insertRow(
    realmURL: string,
    name: string,
    validUntil: string | null,
    { deleted = false }: { deleted?: boolean } = {},
  ) {
    let url = new URL(`Card/${name}.json`, realmURL).href;
    await dbAdapter.execute(
      `INSERT INTO boxel_index(url,file_alias,realm_url,type,generation,is_deleted,has_error,pristine_doc,search_doc,types,valid_until)
       VALUES($1,$1,$2,'instance',1,$3,FALSE,'{}','{}','[]',$4)`,
      { bind: [url, realmURL, deleted, validUntil] },
    );
    return url;
  }

  test('re-indexes only the rows whose grain boundary has passed, as the realm owner', async function (assert) {
    let realmA = 'http://localhost:4444/a/';
    let realmB = 'http://localhost:4444/b/';
    await insertPermissions(dbAdapter, new URL(realmA), {
      '@owner-a:localhost': ['read', 'write', 'realm-owner'],
      '@reader-a:localhost': ['read'],
    });
    await insertPermissions(dbAdapter, new URL(realmB), {
      '@owner-b:localhost': ['read', 'write', 'realm-owner'],
    });

    let expiredA1 = await insertRow(realmA, 'age', '2020-01-01T00:00:00Z');
    let expiredA2 = await insertRow(
      realmA,
      'days-left',
      '2021-06-01T00:00:00Z',
    );
    let expiredB = await insertRow(realmB, 'alert', '2020-01-01T00:00:00Z');
    await insertRow(realmA, 'future', '2999-01-01T00:00:00Z');
    await insertRow(realmA, 'no-grain', null);
    await insertRow(realmA, 'gone', '2020-01-01T00:00:00Z', {
      deleted: true,
    });

    let result = await buildSweep()({ limit: 0 });
    assert.strictEqual(result.enqueued, 3, 'three expired rows re-indexed');

    let jobs = (await dbAdapter.execute(
      `select job_type, priority, concurrency_group, args from jobs order by id`,
    )) as {
      job_type: string;
      priority: number;
      concurrency_group: string;
      args: {
        realmURL: string;
        realmUsername: string;
        changes: { url: string; operation: string }[];
      };
    }[];
    assert.strictEqual(jobs.length, 2, 'one coalesced job per realm');
    assert.deepEqual(
      jobs.map((j) => j.job_type),
      ['incremental-index', 'incremental-index'],
    );
    assert.deepEqual(
      jobs.map((j) => j.priority),
      [systemInitiatedPriority, systemInitiatedPriority],
      'sweeps never outrank user-initiated work',
    );
    let byRealm = new Map(jobs.map((j) => [j.args.realmURL, j]));
    let jobA = byRealm.get(realmA)!;
    assert.strictEqual(jobA.concurrency_group, `indexing:${realmA}`);
    assert.strictEqual(
      jobA.args.realmUsername,
      'owner-a',
      "the bare Matrix username, as the realm's own jobs carry",
    );
    assert.deepEqual(
      jobA.args.changes.map((c) => c.url).sort(),
      [expiredA1, expiredA2].sort(),
      'future, grain-less and deleted rows are left alone',
    );
    assert.ok(
      jobA.args.changes.every((c) => c.operation === 'update'),
      'expired rows are updates, not deletes',
    );
    let jobB = byRealm.get(realmB)!;
    assert.strictEqual(jobB.args.realmUsername, 'owner-b');
    assert.deepEqual(
      jobB.args.changes.map((c) => c.url),
      [expiredB],
    );
  });

  test('a realm without an owner row is skipped rather than failing the sweep', async function (assert) {
    let realm = 'http://localhost:4444/orphan/';
    await insertRow(realm, 'age', '2020-01-01T00:00:00Z');
    let result = await buildSweep()({ limit: 0 });
    assert.strictEqual(result.enqueued, 0);
    let jobs = await dbAdapter.execute('select * from jobs');
    assert.strictEqual(jobs.length, 0, 'nothing enqueued without an owner');
  });

  test('the limit bounds one sweep; the rest wait for the next tick', async function (assert) {
    let realm = 'http://localhost:4444/many/';
    await insertPermissions(dbAdapter, new URL(realm), {
      '@owner:localhost': ['read', 'write', 'realm-owner'],
    });
    for (let i = 0; i < 5; i++) {
      await insertRow(realm, `c${i}`, `2020-01-0${i + 1}T00:00:00Z`);
    }
    let result = await buildSweep()({ limit: 2 });
    assert.strictEqual(result.enqueued, 2);
    let jobs = (await dbAdapter.execute('select args from jobs')) as {
      args: { changes: { url: string }[] };
    }[];
    assert.strictEqual(jobs.length, 1);
    assert.strictEqual(jobs[0].args.changes.length, 2);
  });
});
