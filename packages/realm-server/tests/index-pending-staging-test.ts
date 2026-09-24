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

  // A `job_reservations` row for `jobId`, as the queue writes one when a
  // worker claims the job: a lease `leaseSec` long from now (negative for one
  // that has already lapsed), optionally closed.
  async function insertReservation(
    jobId: number,
    opts: { leaseSec?: number; closed?: boolean } = {},
  ): Promise<number> {
    let [row] = (await adapter.execute(
      `INSERT INTO job_reservations (job_id, locked_until, worker_id, completed_at, completion_reason)
       VALUES ($1, now() + ($2 || ' seconds')::interval, 'test-worker',
               CASE WHEN $3 THEN now() ELSE NULL END,
               CASE WHEN $3 THEN 'timeout-expired' ELSE NULL END)
       RETURNING id`,
      { bind: [jobId, String(opts.leaseSec ?? 600), opts.closed ?? false] },
    )) as { id: number }[];
    return Number(row.id);
  }

  test('a retry resumes, in its own staging, what an earlier attempt of its job staged', async function (assert) {
    let retried = await insertJob('unfulfilled');
    let peerJob = await insertJob('unfulfilled');

    let attempt1 = await createBatch(jobInfo(retried, 1));
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
    assert.notStrictEqual(
      attempt2.stagingId,
      attempt1.stagingId,
      'each attempt of a job stages under its own id',
    );
    assert.true(
      attempt2.resumedRows.has(url('a')),
      'the retry resumes the row the earlier attempt staged',
    );
    assert.deepEqual(
      [
        ...(await stagedURLs('boxel_index_pending', attempt2.stagingId)),
        ...(await stagedURLs('prerendered_html_pending', attempt2.stagingId)),
      ],
      [url('a'), url('a')],
      "the resumed row is copied into the retry's own staging, on both channels",
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
      "the retry's commit deletes its own staged rows",
    );
    assert.deepEqual(
      await stagedURLs('boxel_index_pending', attempt1.stagingId),
      [url('a')],
      "the earlier attempt's rows stay while its job is still unfulfilled",
    );

    await adapter.execute(`UPDATE jobs SET status = 'resolved' WHERE id = $1`, {
      bind: [retried],
    });
    let later = await createBatch(jobInfo(peerJob, 2));
    await stageCard(later, 'c');
    await later.done();
    assert.deepEqual(
      await stagedURLs('boxel_index_pending', attempt1.stagingId),
      [],
      "once the job resolves, a later commit's janitor clears what its earlier attempt left",
    );
  });

  test('two attempts of one job that overlap do not clear each other’s staged rows', async function (assert) {
    let job = await insertJob('unfulfilled');
    // A lease that lapsed while its worker was stalled: the job is claimed
    // again while the first attempt is still running.
    let stalled = await createBatch(jobInfo(job, 1));
    await stageCard(stalled, 'a');
    let retry = await createBatch(jobInfo(job, 2));
    await stageCard(retry, 'found-by-retry');

    await stalled.done();
    assert.deepEqual(
      await stagedURLs('boxel_index_pending', retry.stagingId),
      [url('a'), url('found-by-retry')],
      "the first attempt's cleanup leaves the retry's staged rows alone",
    );

    await retry.done();
    let promoted = (await adapter.execute(
      `SELECT url FROM boxel_index WHERE realm_url = $1 AND type = 'instance' ORDER BY url`,
      { bind: [testRealm] },
    )) as { url: string }[];
    assert.deepEqual(
      promoted.map((row) => row.url),
      [url('a'), url('found-by-retry')],
      "the retry's commit promotes a row only it staged",
    );
  });

  test('a commit is refused once its attempt no longer holds its job', async function (assert) {
    let timedOut = await insertJob('rejected');
    let timedOutReservation = await insertReservation(timedOut, {
      closed: true,
    });
    let zombie = await createBatch(jobInfo(timedOut, timedOutReservation));
    await stageCard(zombie, 'zombie');
    await assert.rejects(
      zombie.done(),
      /no longer holds its job/,
      'an attempt whose job was rejected under it cannot commit',
    );

    let reclaimed = await insertJob('unfulfilled');
    let lapsed = await insertReservation(reclaimed, { leaseSec: -60 });
    let current = await insertReservation(reclaimed);
    let superseded = await createBatch(jobInfo(reclaimed, lapsed));
    await stageCard(superseded, 'superseded');
    await assert.rejects(
      superseded.done(),
      /no longer holds its job/,
      'an attempt whose lease lapsed and was claimed again cannot commit',
    );
    let holder = await createBatch(jobInfo(reclaimed, current));
    await stageCard(holder, 'holder');
    await holder.done();

    let promoted = (await adapter.execute(
      `SELECT url FROM boxel_index WHERE realm_url = $1 AND type = 'instance' ORDER BY url`,
      { bind: [testRealm] },
    )) as { url: string }[];
    assert.deepEqual(
      promoted.map((row) => row.url),
      [url('holder'), url('superseded')],
      'the attempt holding the job commits, and publishes the row it resumed from the superseded attempt; the refused commits publish nothing of their own',
    );
  });

  test("a commit's janitor clears staging no pass can commit any more, and nothing else", async function (assert) {
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
      ['abandoned-adhoc', undefined],
      ['recent-adhoc', undefined],
    ] as const) {
      let batch = await createBatch(info);
      await stageCard(batch, name);
      staged.set(name, batch);
    }
    // An ad-hoc batch that stopped writing two days ago.
    let longAgo = Date.now() - 2 * 24 * 60 * 60 * 1000;
    let abandoned = staged.get('abandoned-adhoc')!.stagingId;
    await adapter.execute(
      `UPDATE boxel_index_pending SET indexed_at = $1,
         diagnostics = jsonb_set(diagnostics, '{indexedAt}', to_jsonb($1::bigint))
       WHERE staging_id = $2`,
      { bind: [longAgo, abandoned] },
    );
    await adapter.execute(
      `UPDATE prerendered_html_pending SET rendered_at = $1,
         diagnostics = jsonb_set(diagnostics, '{indexedAt}', to_jsonb($1::bigint))
       WHERE staging_id = $2`,
      { bind: [longAgo, abandoned] },
    );

    let committer = await createBatch(jobInfo(committing));
    await stageCard(committer, 'committed');
    let result = await committer.done();

    assert.strictEqual(
      result.janitorStagingsCleared,
      3,
      "the janitor counts the stagings it cleared: two finished jobs' and the abandoned ad-hoc one",
    );
    assert.strictEqual(
      result.janitorRowsCleared,
      6,
      'each cleared staging held an index row and an HTML row',
    );
    for (let name of ['rejected', 'resolved', 'abandoned-adhoc']) {
      let { stagingId } = staged.get(name)!;
      assert.deepEqual(
        [
          ...(await stagedURLs('boxel_index_pending', stagingId)),
          ...(await stagedURLs('prerendered_html_pending', stagingId)),
        ],
        [],
        `the rows the ${name} staging left behind are gone`,
      );
    }
    for (let [name, reason] of [
      ['running', 'its retry resumes from them'],
      ['unrecorded', 'nothing says its job has stopped'],
      ['recent-adhoc', 'it wrote recently enough to still be running'],
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
