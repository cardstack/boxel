import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import {
  COMMIT_VALIDATION_MAX_ROUNDS,
  IndexWriter,
  VirtualNetwork,
  mintRealmLoaderEpoch,
  rri,
  type Batch,
  type CommitValidation,
  type CommitValidationRound,
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
  // Job ids for passes with no `jobs` row, well clear of the ids the table
  // hands out, so no such pass shares a staging id with a real job's.
  let jobCounter = 1_000_000;

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
  const nameOf = (href: string) =>
    href.slice(testRealm.length).replace(/\.json$/, '');

  async function createBatch(jobId = jobCounter++): Promise<Batch> {
    let jobInfo: JobInfo = {
      jobId,
      reservationId: 1,
      priority: 0,
      queueWaitMs: null,
    };
    return await indexWriter.createBatch(
      new URL(testRealm),
      virtualNetwork,
      jobInfo,
    );
  }

  // The write an index visit makes for one card. `deps` are the URLs its
  // render read, and `label` records which visit wrote the row.
  async function writeCard(
    batch: Batch,
    name: string,
    { deps = [], label = name }: { deps?: string[]; label?: string } = {},
  ) {
    let cardURL = new URL(url(name));
    await batch.updateEntry(cardURL, {
      type: 'instance',
      resource: {
        id: rri(cardURL.href),
        type: 'card',
        attributes: { name, label },
        meta: {
          adoptsFrom: { module: rri(`${testRealm}person`), name: 'Person' },
        },
      },
      lastModified: Date.now(),
      resourceCreatedAt: Date.now(),
      searchData: { name, label },
      deps: new Set(deps),
      displayNames: [name],
      types: [personKey, cardDefKey],
      isolatedHtml: `<div>${label}</div>`,
    });
  }

  // A card the pass itself changed: invalidated, then visited.
  async function stageCard(
    batch: Batch,
    name: string,
    opts?: { deps?: string[]; label?: string },
  ) {
    await batch.invalidate([new URL(url(name))]);
    await writeCard(batch, name, opts);
  }

  // A validation whose re-visits rewrite every URL of the round, labelled
  // with the round and carrying the deps `deps` names for it, and which
  // records each round it is handed. `beforeRevisit` runs at the start of a
  // round, while the pass holds no commit lock.
  function recordingValidation(
    batch: Batch,
    opts: {
      deps?: Record<string, string[]>;
      beforeRevisit?(round: CommitValidationRound): Promise<void>;
      followUp?: true;
    } = {},
  ): { validation: CommitValidation; rounds: CommitValidationRound[] } {
    let rounds: CommitValidationRound[] = [];
    let validation: CommitValidation = {
      revisit: async (round) => {
        rounds.push(round);
        await opts.beforeRevisit?.(round);
        for (let href of round.urls) {
          let name = nameOf(href);
          await writeCard(batch, name, {
            deps: opts.deps?.[name],
            label: `${name} (round ${round.round})`,
          });
        }
      },
      ...(opts.followUp
        ? {
            followUpJobArgs: (urls: string[]) => ({
              realmURL: testRealm,
              changes: urls.map((href) => ({ url: href, operation: 'update' })),
            }),
          }
        : {}),
    };
    return { validation, rounds };
  }

  async function production(name: string) {
    let [row] = (await adapter.execute(
      `SELECT pristine_doc, diagnostics, generation, is_deleted FROM boxel_index
        WHERE url = $1 AND type = 'instance'`,
      { bind: [url(name)] },
    )) as {
      pristine_doc: { attributes?: { label?: string } } | null;
      diagnostics: Record<string, unknown> | null;
      generation: number;
      is_deleted: boolean | null;
    }[];
    if (!row) {
      return undefined;
    }
    return {
      label: row.pristine_doc?.attributes?.label,
      passId: row.diagnostics?.passId,
      validationRound: row.diagnostics?.validationRound,
      generation: Number(row.generation),
      isDeleted: Boolean(row.is_deleted),
    };
  }

  async function ledgerURLs(passId: string): Promise<string[] | null> {
    let [row] = (await adapter.execute(
      `SELECT urls FROM realm_index_commits WHERE realm_url = $1 AND pass_id = $2`,
      { bind: [testRealm, passId] },
    )) as { urls: string[] | null }[];
    return row?.urls ?? null;
  }

  test('a commit no peer overlapped runs no check and re-visits nothing', async function (assert) {
    let a = await createBatch();
    await stageCard(a, 'a');
    let { validation, rounds } = recordingValidation(a);
    let result = await a.done({ validation });

    assert.deepEqual(rounds, [], 'the commit did not roll back');
    assert.deepEqual(
      [
        result.validationMs,
        result.validationRounds,
        result.revisitCount,
        result.extendCount,
        result.followUpJobId,
      ],
      [undefined, undefined, undefined, undefined, undefined],
      'the result reports no validation, because no peer committed',
    );
    assert.strictEqual(
      (await production('a'))?.validationRound,
      undefined,
      'the row carries no validation round',
    );
    assert.strictEqual(a.committedGeneration, 1, 'the pass commits');
  });

  test('a peer commit that touched nothing the pass read is checked and changes nothing', async function (assert) {
    let a = await createBatch();
    let b = await createBatch();
    await stageCard(a, 'a');
    await stageCard(b, 'b');
    await b.done();

    let { validation, rounds } = recordingValidation(a);
    let result = await a.done({ validation });

    assert.deepEqual(rounds, [], 'the commit did not roll back');
    assert.deepEqual(
      {
        validationRounds: result.validationRounds,
        revisitCount: result.revisitCount,
        extendCount: result.extendCount,
        followUpJobId: result.followUpJobId,
      },
      {
        validationRounds: 0,
        revisitCount: 0,
        extendCount: 0,
        followUpJobId: undefined,
      },
      'the check ran and found nothing to re-visit',
    );
    assert.strictEqual(
      typeof result.validationMs,
      'number',
      'the check is timed',
    );
    assert.strictEqual(a.committedGeneration, 2, 'the pass commits after B');
  });

  test('a URL both passes visited is re-visited once the peer has committed it', async function (assert) {
    let a = await createBatch();
    let b = await createBatch();
    await stageCard(a, 'x', { label: 'x (a)' });
    await stageCard(a, 'y', { label: 'y (a)' });
    await stageCard(b, 'x', { label: 'x (b)' });
    await b.done();
    // A module write after A was set up, the way a save mints one.
    let minted = await mintRealmLoaderEpoch(adapter, testRealm);

    let { validation, rounds } = recordingValidation(a);
    let result = await a.done({ validation });

    assert.deepEqual(
      rounds.map(({ round, urls, addedURLs }) => ({ round, urls, addedURLs })),
      [{ round: 1, urls: [url('x')], addedURLs: [] }],
      'the commit rolled back once and re-visited only the URL B committed',
    );
    assert.true(
      rounds[0].loaderEpochChanged,
      'the round reports that the loader epoch moved',
    );
    assert.strictEqual(
      a.loaderEpoch,
      minted,
      'the re-visit renders under the epoch minted since the pass began',
    );
    assert.deepEqual(
      {
        validationRounds: result.validationRounds,
        revisitCount: result.revisitCount,
        extendCount: result.extendCount,
      },
      { validationRounds: 1, revisitCount: 1, extendCount: 0 },
      'the result counts the round and its re-visit',
    );
    assert.deepEqual(
      await production('x'),
      {
        label: 'x (round 1)',
        passId: a.passId,
        validationRound: 1,
        generation: 2,
        isDeleted: false,
      },
      "production holds A's re-visited row, marked with its round",
    );
    assert.deepEqual(
      await production('y'),
      {
        label: 'y (a)',
        passId: a.passId,
        validationRound: undefined,
        generation: 2,
        isDeleted: false,
      },
      'a row B did not touch keeps the visit A made before validating',
    );
  });

  test('a row that depends on a card the peer created is re-visited', async function (assert) {
    let a = await createBatch();
    let b = await createBatch();
    // A's report links a student that does not exist yet when A visits it.
    await stageCard(a, 'report', {
      deps: [url('student')],
      label: 'report (a)',
    });
    await stageCard(a, 'other', { label: 'other (a)' });
    await stageCard(b, 'student', { label: 'student (b)' });
    await b.done();

    let { validation, rounds } = recordingValidation(a, {
      deps: { report: [url('student')] },
    });
    let result = await a.done({ validation });

    assert.deepEqual(
      rounds.map(({ round, urls }) => ({ round, urls })),
      [{ round: 1, urls: [url('report')] }],
      'only the row whose deps name the card B committed is re-visited',
    );
    assert.strictEqual(result.revisitCount, 1, 'one re-visit is counted');
    assert.strictEqual(
      (await production('report'))?.label,
      'report (round 1)',
      'the report is published as the round re-visited it',
    );
    assert.strictEqual(
      (await production('report'))?.validationRound,
      1,
      'the report row carries its round',
    );
    assert.strictEqual(
      (await production('other'))?.label,
      'other (a)',
      'a row that does not depend on the student keeps its first visit',
    );
    assert.strictEqual(
      (await production('student'))?.label,
      'student (b)',
      "the student stays as B published it, since A's pass never touched it",
    );
  });

  test('a peer-committed row that depends on the pass is extended to, with its dependents', async function (assert) {
    // Committed before either pass begins: a digest of a report that does
    // not exist yet.
    let seed = await createBatch();
    await stageCard(seed, 'digest', {
      deps: [url('report')],
      label: 'digest (seed)',
    });
    await seed.done();

    let a = await createBatch();
    let b = await createBatch();
    await stageCard(a, 'student', { label: 'student (a)' });
    // B introduces a report that reads A's student, and re-visits the digest
    // that reads the report, as its fan-out requires.
    await stageCard(b, 'report', {
      deps: [url('student')],
      label: 'report (b)',
    });
    await writeCard(b, 'digest', {
      deps: [url('report')],
      label: 'digest (b)',
    });
    await b.done();

    let { validation, rounds } = recordingValidation(a, {
      deps: { report: [url('student')], digest: [url('report')] },
    });
    let result = await a.done({ validation });

    assert.deepEqual(
      rounds.map(({ round, urls, addedURLs }) => ({
        round,
        urls,
        addedURLs: [...addedURLs].sort(),
      })),
      [
        {
          round: 1,
          urls: [url('digest'), url('report')],
          addedURLs: [url('digest'), url('report')],
        },
      ],
      "A extends to B's report, which depends on A's student, and to the digest that depends on the report",
    );
    assert.deepEqual(
      {
        revisitCount: result.revisitCount,
        extendCount: result.extendCount,
      },
      { revisitCount: 2, extendCount: 1 },
      'one peer-committed URL was extended to, and two URLs were re-visited',
    );
    assert.deepEqual(
      [
        (await production('report'))?.label,
        (await production('digest'))?.label,
      ],
      ['report (round 1)', 'digest (round 1)'],
      'both are published as A re-visited them',
    );
    assert.strictEqual(
      (await production('report'))?.passId,
      a.passId,
      "the report's published row is A's",
    );
    assert.deepEqual(
      await ledgerURLs(a.passId),
      [url('digest'), url('report'), url('student')],
      "A's ledger row lists what the extension added",
    );
    assert.true(
      a.invalidations.includes(url('report')),
      "the report is in A's invalidation set",
    );
  });

  test('a commit whose peers keep committing over it stops after its rounds and enqueues a follow-up in its own lane', async function (assert) {
    let lane = `indexing:${testRealm}#user:@writer:localhost`;
    let [{ id: jobId }] = (await adapter.execute(
      `INSERT INTO jobs (job_type, concurrency_group, args, status, timeout, priority, initiated_by)
       VALUES ('incremental-index', $1, '{}'::jsonb, 'unfulfilled', 600, 7, '["@writer:localhost"]'::jsonb)
       RETURNING id`,
      { bind: [lane] },
    )) as { id: number }[];
    let a = await createBatch(Number(jobId));
    await stageCard(a, 'x', { label: 'x (a)' });

    // Every peer commits over the same card, one before A's first check and
    // one during each of its rounds, so every check finds a fresh one.
    let peerCommits = 0;
    let peerCommit = async () => {
      let peer = await createBatch();
      await stageCard(peer, 'x', { label: `x (peer ${peerCommits++})` });
      await peer.done();
    };
    await peerCommit();

    let { validation, rounds } = recordingValidation(a, {
      beforeRevisit: async () => await peerCommit(),
      followUp: true,
    });
    let result = await a.done({ validation });

    assert.deepEqual(
      rounds.map(({ round, urls }) => ({ round, urls })),
      Array.from({ length: COMMIT_VALIDATION_MAX_ROUNDS }, (_, i) => ({
        round: i + 1,
        urls: [url('x')],
      })),
      'the commit rolled back once per round, and no further',
    );
    assert.strictEqual(
      result.validationRounds,
      COMMIT_VALIDATION_MAX_ROUNDS,
      'the result counts every round',
    );
    assert.strictEqual(
      a.committedGeneration,
      COMMIT_VALIDATION_MAX_ROUNDS + 2,
      'A committed anyway, after every peer',
    );
    assert.deepEqual(
      await production('x'),
      {
        label: `x (round ${COMMIT_VALIDATION_MAX_ROUNDS})`,
        passId: a.passId,
        validationRound: COMMIT_VALIDATION_MAX_ROUNDS,
        generation: COMMIT_VALIDATION_MAX_ROUNDS + 2,
        isDeleted: false,
      },
      "production holds A's last re-visit",
    );

    assert.strictEqual(
      typeof result.followUpJobId,
      'number',
      'the result names the follow-up job',
    );
    let [followUp] = (await adapter.execute(
      `SELECT job_type, concurrency_group, priority, timeout, initiated_by, status, args
         FROM jobs WHERE id = $1`,
      { bind: [result.followUpJobId ?? null] },
    )) as {
      job_type: string;
      concurrency_group: string;
      priority: number;
      timeout: number;
      initiated_by: string[];
      status: string;
      args: { changes: { url: string; operation: string }[] };
    }[];
    assert.deepEqual(
      {
        jobType: followUp?.job_type,
        concurrencyGroup: followUp?.concurrency_group,
        priority: Number(followUp?.priority),
        initiatedBy: followUp?.initiated_by,
        status: followUp?.status,
        changes: followUp?.args.changes,
      },
      {
        jobType: 'incremental-index',
        concurrencyGroup: lane,
        priority: 7,
        initiatedBy: ['@writer:localhost'],
        status: 'unfulfilled',
        changes: [{ url: url('x'), operation: 'update' }],
      },
      "the follow-up re-indexes the card still stale, in A's lane, at its priority, for its writer",
    );
  });
});
