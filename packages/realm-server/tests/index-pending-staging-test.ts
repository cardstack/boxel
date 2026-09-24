import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import {
  IndexWriter,
  VirtualNetwork,
  rri,
  type Batch,
  type JobInfo,
} from '@cardstack/runtime-common';
import type { PgAdapter } from '@cardstack/postgres';
import {
  createTestPgAdapter,
  prepareTestDB,
  testRealm,
} from './helpers/index.ts';

const cardDefKey = 'https://cardstack.com/base/card-api/CardDef';
const personKey = `${testRealm}person/Person`;

module(basename(import.meta.filename), function (hooks) {
  let adapter: PgAdapter;
  let indexWriter: IndexWriter;
  let virtualNetwork: VirtualNetwork;

  hooks.beforeEach(async function () {
    prepareTestDB();
    adapter = await createTestPgAdapter();
    indexWriter = new IndexWriter(adapter);
    virtualNetwork = new VirtualNetwork();
  });

  hooks.afterEach(async function () {
    await adapter.close();
  });

  const url = (name: string) => `${testRealm}${name}.json`;

  // A `jobs` row in `status`, so the janitor has a job to judge the rows by.
  async function insertJob(
    status: 'unfulfilled' | 'resolved' | 'rejected',
  ): Promise<number> {
    let [row] = (await adapter.execute(
      `INSERT INTO jobs (job_type, concurrency_group, args, status, timeout)
       VALUES ('incremental-index', $1, '{}'::jsonb, $2, 60)
       RETURNING id`,
      { bind: [`indexing:${testRealm}`, status] },
    )) as { id: number }[];
    return Number(row.id);
  }

  function jobInfo(jobId: number, reservationId = 1): JobInfo {
    return { jobId, reservationId, priority: 0, queueWaitMs: null };
  }

  async function createBatch(info?: JobInfo) {
    return await indexWriter.createBatch(
      new URL(testRealm),
      virtualNetwork,
      info,
      { splitPrerenderHtml: false },
    );
  }

  // Stages one card in the batch, both channels, the way a fused index visit
  // would.
  async function stageCard(batch: Batch, name: string) {
    let cardURL = new URL(url(name));
    await batch.updateEntry(cardURL, {
      type: 'instance',
      resource: {
        id: rri(cardURL.href),
        type: 'card',
        attributes: { name },
        meta: { adoptsFrom: { module: rri(`${testRealm}person`), name } },
      },
      lastModified: Date.now(),
      resourceCreatedAt: Date.now(),
      searchData: { name },
      deps: new Set(),
      displayNames: [name],
      types: [personKey, cardDefKey],
      isolatedHtml: `<div>${name}</div>`,
    });
  }

  async function stagedURLs(
    table: 'boxel_index_pending' | 'prerendered_html_pending',
    stagingId: string,
  ): Promise<string[]> {
    let rows = (await adapter.execute(
      `SELECT DISTINCT url FROM ${table} WHERE staging_id = $1 ORDER BY url`,
      { bind: [stagingId] },
    )) as { url: string }[];
    return rows.map((row) => row.url);
  }

  async function productionDiagnostics(
    name: string,
  ): Promise<Record<string, unknown> | undefined> {
    let [row] = (await adapter.execute(
      `SELECT diagnostics FROM boxel_index WHERE url = $1 AND type = 'instance'`,
      { bind: [url(name)] },
    )) as { diagnostics: Record<string, unknown> | null }[];
    return row?.diagnostics ?? undefined;
  }

  test('a retry resumes what an earlier attempt staged, across a peer commit', async function (assert) {
    let retried = await insertJob('unfulfilled');
    let peerJob = await insertJob('unfulfilled');

    let attempt1 = await createBatch(jobInfo(retried));
    await stageCard(attempt1, 'a');
    // No done(): the attempt's reservation lapses before its commit.

    let peer = await createBatch(jobInfo(peerJob));
    await stageCard(peer, 'b');
    let peerResult = await peer.done();
    assert.strictEqual(
      peerResult.janitorRowsCleared,
      0,
      "the peer's janitor leaves the rows of a job that is still unfulfilled",
    );
    assert.deepEqual(
      await stagedURLs('boxel_index_pending', attempt1.stagingId),
      [url('a')],
      "the earlier attempt's staged index row survives the peer's commit",
    );
    assert.deepEqual(
      await stagedURLs('boxel_index_pending', peer.stagingId),
      [],
      'a commit deletes the index rows it staged',
    );
    assert.deepEqual(
      await stagedURLs('prerendered_html_pending', peer.stagingId),
      [],
      'a commit deletes the HTML rows it staged',
    );
    let [peerCommit] = (await adapter.execute(
      `SELECT pass_id FROM realm_index_commits WHERE realm_url = $1 AND job_id = $2`,
      { bind: [testRealm, peerJob] },
    )) as { pass_id: string }[];
    assert.strictEqual(
      (await productionDiagnostics('b'))?.passId,
      peerCommit.pass_id,
      "a promoted row's diagnostics name the pass on its commit's ledger row",
    );

    let attempt2 = await createBatch(jobInfo(retried, 2));
    assert.strictEqual(
      attempt2.stagingId,
      attempt1.stagingId,
      "a job's attempts share one staging id",
    );
    assert.true(
      attempt2.resumedRows.has(url('a')),
      'the retry resumes the row the earlier attempt staged',
    );
    let result = await attempt2.done();
    assert.strictEqual(
      typeof result.pendingCleanupMs,
      'number',
      'the commit reports its pending cleanup',
    );
    let [promoted] = (await adapter.execute(
      `SELECT generation FROM boxel_index WHERE url = $1 AND type = 'instance'`,
      { bind: [url('a')] },
    )) as { generation: number }[];
    assert.strictEqual(
      Number(promoted?.generation),
      attempt2.committedGeneration,
      "the retry's commit promotes the resumed row",
    );
    assert.strictEqual(
      (await productionDiagnostics('a'))?.passId,
      attempt1.passId,
      'a resumed row still names the attempt that staged it',
    );
    assert.deepEqual(
      await stagedURLs('boxel_index_pending', attempt2.stagingId),
      [],
      "the retry's commit deletes the job's staged rows",
    );
  });

  test("a commit's janitor clears the rows of jobs that are no longer running, and nothing else", async function (assert) {
    let rejected = await insertJob('rejected');
    let resolved = await insertJob('resolved');
    let running = await insertJob('unfulfilled');
    let unrecorded = (await insertJob('unfulfilled')) + 1000;
    let committing = await insertJob('unfulfilled');

    let staged = new Map<string, Batch>();
    for (let [name, info] of [
      ['rejected', jobInfo(rejected)],
      ['resolved', jobInfo(resolved)],
      ['running', jobInfo(running)],
      ['unrecorded', jobInfo(unrecorded)],
      ['adhoc', undefined],
    ] as const) {
      let batch = await createBatch(info);
      await stageCard(batch, name);
      staged.set(name, batch);
    }

    let committer = await createBatch(jobInfo(committing));
    await stageCard(committer, 'committed');
    let result = await committer.done();

    assert.strictEqual(
      result.janitorJobsCleared,
      2,
      'the janitor counts the two finished jobs it cleared',
    );
    assert.strictEqual(
      result.janitorRowsCleared,
      4,
      "each finished job's index and HTML rows are cleared",
    );
    for (let name of ['rejected', 'resolved']) {
      let { stagingId } = staged.get(name)!;
      assert.deepEqual(
        [
          ...(await stagedURLs('boxel_index_pending', stagingId)),
          ...(await stagedURLs('prerendered_html_pending', stagingId)),
        ],
        [],
        `the rows a ${name} job left behind are gone`,
      );
    }
    for (let [name, reason] of [
      ['running', 'its retry resumes from them'],
      ['unrecorded', 'nothing says its job has stopped'],
      ['adhoc', 'nothing records whether the batch is still running'],
    ] as const) {
      let { stagingId } = staged.get(name)!;
      assert.deepEqual(
        await stagedURLs('boxel_index_pending', stagingId),
        [url(name)],
        `the ${name} rows stay: ${reason}`,
      );
    }
  });
});
