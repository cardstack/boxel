import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename, join } from 'path';
import type { ChildProcess } from 'child_process';
import fsExtra from 'fs-extra';
import { dirSync, setGracefulCleanup, type DirResult } from 'tmp';
import {
  realmHistoryState,
  type DefinitionLookup,
  type QueuePublisher,
  type Realm,
  type RealmAdapter,
} from '@cardstack/runtime-common';
import {
  commitBatch,
  isOperationFailure,
  setRealmRecoverySink,
  type RealmRecoveryEvent,
} from '@cardstack/runtime-common/card-operations';
import {
  HISTORY_DIR,
  type HistoryBackend,
  type HistoryCommitRequest,
  type HistoryCommitResult,
  type HistoryOutcome,
  type HistoryReadResult,
  type HistoryTreeEntry,
  type PreparedCommit,
} from '@cardstack/runtime-common/realm-history';
import {
  DRIFT_MESSAGE,
  GAP_MESSAGE,
} from '@cardstack/runtime-common/realm-history-recovery';
import { realmHistoryRecovery } from '@cardstack/runtime-common/tasks/realm-history-recovery';
import type { PgAdapter } from '@cardstack/postgres';
import { DeckdHistoryBackend } from '../lib/deckd-client.ts';
import {
  createJWT,
  createRealm,
  createVirtualNetwork,
  setupDB,
} from './helpers/index.ts';
import {
  findDeckd,
  historyFrom,
  readRevision,
  startDeckd,
} from './helpers/realm-history.ts';

const { ensureDirSync, existsSync, readFileSync, removeSync, writeFileSync } =
  fsExtra;

// Recovery brings a realm that records history back into agreement with it:
// after a crash at any step of a write, a write whose answer was lost, or an
// edit made to the realm directory directly. Each module below mounts a realm,
// does something to it, and mounts it again — as a realm-server restarting
// would — over one directory, one database and one real deckd.

const realmURL = 'http://127.0.0.1:4464/recovering/';

// deckd, with the faults a test asks for injected around it.
class FaultyHistory implements HistoryBackend {
  inner: DeckdHistoryBackend;
  // Commit, then lose the response.
  loseCommitResponses = false;
  // Lose the request before it reaches deckd, so nothing commits.
  dropCommits = false;
  // Every outcome query fails, as with deckd unreachable.
  failOutcomes = false;
  // Every read of a revision's files fails.
  failReads = false;

  constructor(inner: DeckdHistoryBackend) {
    this.inner = inner;
  }

  prepareCommit(request: Omit<HistoryCommitRequest, 'parent'>): PreparedCommit {
    let prepared = this.inner.prepareCommit(request);
    return {
      commit: async (parent: string): Promise<HistoryCommitResult> => {
        if (this.dropCommits) {
          throw new Error('socket hang up');
        }
        let result = await prepared.commit(parent);
        if (this.loseCommitResponses) {
          throw new Error('socket hang up');
        }
        return result;
      },
    };
  }

  async outcome(operationId: string): Promise<HistoryOutcome> {
    if (this.failOutcomes) {
      throw new Error('connect ECONNREFUSED');
    }
    return await this.inner.outcome(operationId);
  }

  head(): Promise<string> {
    return this.inner.head();
  }

  tree(revision: string): Promise<HistoryTreeEntry[]> {
    return this.inner.tree(revision);
  }

  async read(revision: string, paths: string[]): Promise<HistoryReadResult> {
    if (this.failReads) {
      throw new Error('connect ECONNREFUSED');
    }
    return await this.inner.read(revision, paths);
  }
}

class Crash extends Error {}

const deckdBinary = findDeckd();
if (!deckdBinary && process.env.CI) {
  throw new Error(
    'realm-history-recovery-test needs deckd: set DECKD_BIN or put deckd on PATH',
  );
}
const recordingTest = deckdBinary ? test : QUnit.skip;

module(basename(import.meta.filename), function (hooks) {
  let deckd: { url: string; process: ChildProcess } | undefined;
  let dbAdapter: PgAdapter;
  let publisher: QueuePublisher;
  let tmpDir: DirResult;
  let realmDir: string;
  let recoveries: RealmRecoveryEvent[];
  let broadcasts: { realm: number; event: Record<string, any> }[];
  let mounted: number;

  setGracefulCleanup();

  hooks.before(async function () {
    if (deckdBinary) {
      deckd = await startDeckd(deckdBinary);
    }
  });

  hooks.after(function () {
    deckd?.process.kill();
  });

  setupDB(hooks, {
    beforeEach: async (_dbAdapter, _publisher) => {
      dbAdapter = _dbAdapter;
      publisher = _publisher;
      tmpDir = dirSync({ unsafeCleanup: true });
      realmDir = join(tmpDir.name, 'realm');
      ensureDirSync(realmDir);
      writeFileSync(
        join(realmDir, 'realm.json'),
        JSON.stringify({
          data: {
            type: 'card',
            attributes: { cardInfo: { name: 'Recovering Realm' } },
            meta: {
              adoptsFrom: {
                module: '@cardstack/base/realm-config',
                name: 'RealmConfig',
              },
            },
          },
        }),
      );
      writeFileSync(join(realmDir, 'a.txt'), 'alpha');
      writeFileSync(join(realmDir, 'b.txt'), 'bravo');
      recoveries = [];
      broadcasts = [];
      mounted = 0;
      setRealmRecoverySink((event) => recoveries.push(event));
    },
  });

  hooks.afterEach(function () {
    setRealmRecoverySink(undefined);
  });

  // Raw source writes resolve no definition, so a lookup that only answers
  // the write path's invalidation is enough.
  let definitionLookup = {
    forRealm() {
      return this;
    },
    async invalidate() {
      return [];
    },
  } as unknown as DefinitionLookup;

  // A realm over the test's directory and database, as one realm-server
  // replica mounts it. Started unless asked not to, which runs recovery.
  async function mount(opts?: {
    recording?: false;
    historyConfigured?: true;
    start?: false;
    faulty?: (history: FaultyHistory) => void;
  }): Promise<{
    realm: Realm;
    adapter: RealmAdapter;
    history: FaultyHistory | undefined;
  }> {
    let history: FaultyHistory | undefined;
    let { realm, adapter } = await createRealm({
      dir: realmDir,
      definitionLookup,
      realmURL,
      permissions: {
        '*': ['read', 'write'],
        owner: ['read', 'write', 'realm-owner'],
      },
      virtualNetwork: createVirtualNetwork(),
      publisher,
      dbAdapter,
      skipBootIndex: true,
      ...(opts?.historyConfigured ? { historyConfigured: true } : {}),
      ...(opts?.recording === false
        ? {}
        : {
            history: (dir: string) => {
              history = new FaultyHistory(
                new DeckdHistoryBackend({
                  deckdURL: deckd!.url,
                  realmDir: dir,
                }),
              );
              opts?.faulty?.(history);
              return history;
            },
          }),
    });
    let index = mounted++;
    let broadcast = adapter.broadcastRealmEvent.bind(adapter);
    adapter.broadcastRealmEvent = async (event, ...rest) => {
      broadcasts.push({ realm: index, event: event as Record<string, any> });
      return await broadcast(event, ...rest);
    };
    if (opts?.start !== false) {
      await realm.start();
    }
    return { realm, adapter, history };
  }

  function write(
    realm: Realm,
    files: Record<string, string>,
    operationId: string,
  ) {
    return commitBatch(
      realm.batchCore,
      Object.entries(files).map(([path, content]) => ({
        op: 'update' as const,
        href: `${realmURL}${path}`,
        content,
        rawSource: true,
      })),
      {
        waitForIndex: false,
        // A retry is recognized by asking for what its first attempt asked
        // for, as a request's digest would show.
        recording: {
          operationId,
          channel: 'operations',
          fingerprint: JSON.stringify(files),
        },
      },
    );
  }

  // What a write that failed was refused with: the operation error it
  // answered, or the error itself for one that is not an operation's.
  async function failure(promise: Promise<unknown>): Promise<{
    status?: number;
    code?: string;
    meta?: Record<string, unknown>;
    message: string;
  }> {
    try {
      await promise;
    } catch (err: unknown) {
      if (isOperationFailure(err)) {
        return {
          status: err.error.status,
          code: err.error.code,
          meta: err.error.meta as Record<string, unknown> | undefined,
          message: err.message,
        };
      }
      return {
        code: (err as { code?: string }).code,
        message: err instanceof Error ? err.message : String(err),
      };
    }
    throw new Error('expected the write to fail');
  }

  function onDisk(path: string): string | undefined {
    let file = join(realmDir, path);
    return existsSync(file) ? readFileSync(file, 'utf8') : undefined;
  }

  function backend() {
    return new DeckdHistoryBackend({ deckdURL: deckd!.url, realmDir });
  }

  async function atHead(path: string): Promise<string | undefined> {
    let history = backend();
    let { files } = await history.read(await history.head(), [path]);
    let content = files[0]?.content;
    return content ? new TextDecoder().decode(content) : undefined;
  }

  async function journal() {
    return (await dbAdapter.execute(
      `SELECT operation_id, revision, state, kind, paths,
              materialized_at IS NOT NULL AS materialized,
              post_committed_at IS NOT NULL AS post_committed
       FROM realm_history_revisions WHERE realm_url = $1 ORDER BY seq`,
      { bind: [realmURL] },
    )) as {
      operation_id: string;
      revision: string | null;
      state: string;
      kind: string;
      paths: string[];
      materialized: boolean;
      post_committed: boolean;
    }[];
  }

  // No worker runs here, so the index passes earlier steps queued are still
  // pending, and a later pass in the same lane would merge into one of them.
  // Settled as a worker would have, so each step's passes are its own. Answers
  // the latest job id, for `indexedSince`.
  async function settleJobs(): Promise<number> {
    await dbAdapter.execute(
      `UPDATE jobs SET status = 'resolved' WHERE status = 'unfulfilled'`,
    );
    let [row] = (await dbAdapter.execute(
      'SELECT coalesce(max(id), 0) AS max FROM jobs',
    )) as { max: number }[];
    return Number(row.max);
  }

  // The paths every incremental index pass queued since `since` covers.
  async function indexedSince(since: number): Promise<string[]> {
    let rows = (await dbAdapter.execute(
      `SELECT args FROM jobs WHERE id > $1 AND job_type = 'incremental-index'
       ORDER BY id`,
      { bind: [since] },
    )) as { args: { changes: { url: string }[] } }[];
    return [
      ...new Set(
        rows.flatMap(({ args }) =>
          args.changes.map(({ url }) => url.replace(realmURL, '')),
        ),
      ),
    ].sort();
  }

  function updatedBy(realm: number): string[] {
    return [
      ...new Set(
        broadcasts
          .filter(
            ({ realm: from, event }) =>
              from === realm && event.eventName === 'update',
          )
          .flatMap(({ event }) => [
            ...(event.added ?? []),
            ...(event.updated ?? []),
            ...(event.removed ?? []),
          ]),
      ),
    ].sort();
  }

  async function handle(realm: Realm, request: Request) {
    request.headers.set(
      'Authorization',
      `Bearer ${createJWT(realm, 'owner', ['read', 'write', 'realm-owner'])}`,
    );
    return (await realm.handle(request))!;
  }

  module('a realm mounted recording for the first time', function () {
    recordingTest(
      'takes in what the realm already held as one gap revision',
      async function (assert) {
        await mount();
        let head = await backend().head();
        assert.strictEqual(historyFrom(realmDir, head).length, 1);
        let gap = readRevision(realmDir, head);
        assert.strictEqual(gap.subject, GAP_MESSAGE);
        assert.strictEqual(gap.trailers['Boxel-Gap'], 'recording-disabled');
        assert.strictEqual(gap.trailers['Boxel-Channel'], 'system');
        assert.deepEqual(gap.changes, ['A a.txt', 'A b.txt', 'A realm.json']);
        let [row] = await journal();
        assert.strictEqual(row.kind, 'gap', 'the journal knows it is a gap');
        assert.strictEqual(
          recoveries.at(-1)?.gapRevisions[0],
          head,
          'reported as a gap, not drift',
        );
        assert.deepEqual(recoveries.at(-1)?.driftRevisions, []);
        assert.true(
          (await realmHistoryState(dbAdapter, realmURL))?.recording,
          'the realm is noted as recording',
        );

        await mount();
        assert.strictEqual(
          await backend().head(),
          head,
          'a second mount records nothing',
        );
        assert.strictEqual(recoveries.at(-1)?.outcome, 'clean');
      },
    );

    recordingTest(
      'records one gap for what changed while recording was off',
      async function (assert) {
        let { realm: first } = await mount();
        await write(first, { 'a.txt': 'alpha 2' }, 'recorded-1');
        let before = await backend().head();

        // A deploy that turns recording off for the realm.
        let { realm: unrecorded } = await mount({
          recording: false,
          historyConfigured: true,
        });
        assert.false(
          (await realmHistoryState(dbAdapter, realmURL))?.recording,
          'noted as not recording',
        );
        await commitBatch(
          unrecorded.batchCore,
          [
            {
              op: 'update',
              href: `${realmURL}b.txt`,
              content: 'bravo, unrecorded',
              rawSource: true,
            },
          ],
          { waitForIndex: false },
        );
        assert.strictEqual(
          await backend().head(),
          before,
          'the unrecorded write made no revision',
        );

        // And one that turns it back on.
        await mount();
        let head = await backend().head();
        assert.deepEqual(
          historyFrom(realmDir, head).slice(0, 2),
          [head, before],
          'exactly one revision was added',
        );
        let gap = readRevision(realmDir, head);
        assert.strictEqual(gap.subject, GAP_MESSAGE);
        assert.deepEqual(gap.changes, ['M b.txt']);
        assert.strictEqual(
          await first.history!.revisionKind(head),
          'gap',
          'the revision is known to be a gap',
        );
        assert.deepEqual(recoveries.at(-1)?.driftRevisions, [], 'not drift');
      },
    );
  });

  module('a crash part-way through a write', function () {
    for (let step of [
      'afterRecord',
      'midMaterialize',
      'afterMaterialize',
    ] as const) {
      recordingTest(
        `at ${step} is completed by the next mount`,
        async function (assert) {
          let { realm: crashed } = await mount();
          crashed.__testOnlySetHistoryFaults({
            [step]: async () => {
              throw new Crash(step);
            },
          });
          let err = await failure(
            write(
              crashed,
              { 'c.txt': `charlie ${step}`, 'd.txt': `delta ${step}` },
              `crash-${step}`,
            ),
          );
          assert.strictEqual(
            err.status,
            500,
            `the write reports it was recorded and not completed: ${err.message}`,
          );
          let head = await backend().head();
          assert.notStrictEqual(
            await crashed.history!.materializedRevision(),
            head,
            'disk is behind HEAD',
          );

          let jobsBefore = await settleJobs();
          let { realm } = await mount();
          assert.strictEqual(onDisk('c.txt'), `charlie ${step}`);
          assert.strictEqual(onDisk('d.txt'), `delta ${step}`);
          assert.strictEqual(
            await realm.history!.materializedRevision(),
            head,
            'disk is at HEAD',
          );
          assert.deepEqual(
            await indexedSince(jobsBefore),
            ['c.txt', 'd.txt'],
            'both paths were queued for indexing',
          );
          assert.deepEqual(
            updatedBy(1),
            ['c.txt', 'd.txt'],
            'and both were announced',
          );
          assert.strictEqual(recoveries.at(-1)?.outcome, 'recovered');
          assert.strictEqual(recoveries.at(-1)?.caughtUpRevisions, 1);
          let row = (await journal()).at(-1)!;
          assert.true(row.materialized && row.post_committed, 'complete');
          assert.strictEqual(
            await backend().head(),
            head,
            'completing the write recorded nothing new',
          );
        },
      );
    }

    recordingTest(
      'after post-commit and before the answer leaves nothing to do',
      async function (assert) {
        let { realm: crashed } = await mount();
        crashed.__testOnlySetHistoryFaults({
          afterPostCommit: async () => {
            throw new Crash('afterPostCommit');
          },
        });
        await failure(
          write(crashed, { 'c.txt': 'charlie late' }, 'crash-late'),
        );
        let head = await backend().head();
        assert.strictEqual(onDisk('c.txt'), 'charlie late');

        let jobsBefore = await settleJobs();
        let { realm } = await mount();
        assert.strictEqual(recoveries.at(-1)?.outcome, 'clean');
        assert.strictEqual(await realm.history!.materializedRevision(), head);
        assert.deepEqual(await indexedSince(jobsBefore), [], 'no index pass');
        assert.strictEqual(await backend().head(), head);
      },
    );

    recordingTest(
      'two replicas mounting at once complete it once',
      async function (assert) {
        let { realm: crashed } = await mount();
        crashed.__testOnlySetHistoryFaults({
          afterRecord: async () => {
            throw new Crash('afterRecord');
          },
        });
        await failure(write(crashed, { 'c.txt': 'charlie' }, 'crash-twice'));
        let head = await backend().head();

        recoveries = [];
        await Promise.all([mount(), mount()]);
        let outcomes = recoveries.map(({ outcome }) => outcome).sort();
        assert.deepEqual(
          outcomes,
          ['leased', 'recovered'],
          'one replica recovered, the other waited for it',
        );
        assert.strictEqual(onDisk('c.txt'), 'charlie');
        assert.deepEqual(
          [...updatedBy(1), ...updatedBy(2)],
          ['c.txt'],
          'the path was written and announced once',
        );
        assert.strictEqual(await backend().head(), head);
      },
    );

    recordingTest(
      'holds back a later write to its paths until recovery completes it',
      async function (assert) {
        let { realm: crashed } = await mount();
        crashed.__testOnlySetHistoryFaults({
          afterRecord: async () => {
            throw new Crash('afterRecord');
          },
        });
        await failure(write(crashed, { 'c.txt': 'charlie' }, 'crash-guard'));

        // A peer replica that was already serving the realm, so no mount of
        // its own brings disk up to HEAD first.
        let { realm: peer } = await mount({ start: false });
        let err = await failure(
          write(peer, { 'c.txt': 'charlie, again' }, 'after-crash'),
        );
        assert.deepEqual(
          { status: err.status, code: err.code },
          { status: 503, code: 'realm-recovering' },
          `refused while disk is behind HEAD there: ${err.message}`,
        );
        // The refusal set recovery going; waiting on it joins that run.
        await peer.recoverHistory({ trigger: 'write' });
        assert.strictEqual(onDisk('c.txt'), 'charlie', 'brought up to HEAD');
        await write(peer, { 'c.txt': 'charlie, again' }, 'after-crash-2');
        assert.strictEqual(onDisk('c.txt'), 'charlie, again');
        assert.strictEqual(await atHead('c.txt'), 'charlie, again');
      },
    );
  });

  module('a write whose answer was lost', function () {
    async function backdatePending() {
      // Recovery leaves a pending write five minutes to finish before asking
      // about it, since asking fences it.
      await dbAdapter.execute(
        `UPDATE realm_history_revisions
         SET recorded_at = now() - interval '1 hour'
         WHERE state = 'pending' AND realm_url = $1`,
        { bind: [realmURL] },
      );
    }

    recordingTest(
      'that committed is completed, and a retry is pointed at its revision',
      async function (assert) {
        let { realm: first, history } = await mount();
        history!.loseCommitResponses = true;
        history!.failOutcomes = true;
        let err = await failure(
          write(first, { 'c.txt': 'charlie' }, 'lost-commit'),
        );
        assert.strictEqual(err.code, 'revision-outcome-unknown', err.message);
        assert.strictEqual((await journal()).at(-1)?.state, 'pending');
        assert.strictEqual(onDisk('c.txt'), undefined, 'nothing on disk yet');
        let head = await backend().head();

        await backdatePending();
        let { realm } = await mount();
        assert.strictEqual(recoveries.at(-1)?.resolvedCommitted, 1);
        assert.strictEqual(onDisk('c.txt'), 'charlie', 'completed');
        let row = (await journal()).at(-1)!;
        assert.deepEqual(
          { state: row.state, revision: row.revision },
          { state: 'committed', revision: head },
        );

        let retry = await failure(
          write(realm, { 'c.txt': 'charlie' }, 'lost-commit'),
        );
        assert.deepEqual(
          { code: retry.code, revision: retry.meta?.revision },
          { code: 'revision-already-applied', revision: head },
          `the retry is told its write landed: ${retry.message}`,
        );
        assert.strictEqual(await backend().head(), head, 'nothing rewritten');
      },
    );

    recordingTest(
      'that never committed is fenced, and stays aborted',
      async function (assert) {
        let { realm: first, history } = await mount();
        let before = await backend().head();
        history!.dropCommits = true;
        history!.failOutcomes = true;
        await failure(write(first, { 'c.txt': 'charlie' }, 'lost-request'));
        assert.strictEqual((await journal()).at(-1)?.state, 'pending');

        await backdatePending();
        let { realm } = await mount();
        assert.strictEqual(recoveries.at(-1)?.resolvedAborted, 1);
        assert.strictEqual((await journal()).at(-1)?.state, 'aborted');
        assert.strictEqual(onDisk('c.txt'), undefined);
        assert.strictEqual(await backend().head(), before);

        let retry = await failure(
          write(realm, { 'c.txt': 'charlie' }, 'lost-request'),
        );
        assert.deepEqual(
          { status: retry.status, code: retry.code },
          { status: 409, code: 'operation-fenced' },
          `a retry under the id is refused: ${retry.message}`,
        );
        let late = await failure(
          backend()
            .prepareCommit({
              operationId: 'lost-request',
              author: { name: 'late', email: 'late@example.com' },
              message: 'Update c.txt',
              trailers: [],
              changes: [
                { path: 'c.txt', content: new TextEncoder().encode('late') },
              ],
            })
            .commit(before),
        );
        assert.strictEqual(
          late.code,
          'operation-fenced',
          'and so is a commit that arrives late',
        );
      },
    );

    recordingTest(
      'that committed holds back a later write to its paths until recovery completes it',
      async function (assert) {
        let { realm, history } = await mount();
        history!.loseCommitResponses = true;
        history!.failOutcomes = true;
        await failure(write(realm, { 'c.txt': 'charlie' }, 'lost-then-edit'));
        let head = await backend().head();
        assert.strictEqual(await atHead('c.txt'), 'charlie');
        assert.strictEqual(onDisk('c.txt'), undefined);
        history!.loseCommitResponses = false;
        history!.failOutcomes = false;

        let err = await failure(
          write(realm, { 'c.txt': 'charlie, again' }, 'edit-after-lost'),
        );
        assert.deepEqual(
          { status: err.status, code: err.code },
          { status: 503, code: 'realm-recovering' },
          `refused while disk lacks the lost write: ${err.message}`,
        );
        assert.strictEqual(await backend().head(), head, 'nothing recorded');
        assert.strictEqual(
          (await journal()).find((row) => row.operation_id === 'lost-then-edit')
            ?.state,
          'committed',
          'the lost write was settled without waiting out its grace period',
        );

        await realm.recoverHistory({ trigger: 'write' });
        assert.strictEqual(onDisk('c.txt'), 'charlie', 'brought up to HEAD');
        await write(realm, { 'c.txt': 'charlie, again' }, 'edit-after-lost');
        assert.strictEqual(await atHead('c.txt'), 'charlie, again');
        let retry = await failure(
          write(realm, { 'c.txt': 'charlie' }, 'lost-then-edit'),
        );
        assert.deepEqual(
          { code: retry.code, revision: retry.meta?.revision },
          { code: 'revision-already-applied', revision: head },
          `a retry of the lost write is told it landed: ${retry.message}`,
        );
      },
    );

    recordingTest(
      'that never committed is fenced by a later write to its paths',
      async function (assert) {
        let { realm, history } = await mount();
        history!.dropCommits = true;
        history!.failOutcomes = true;
        await failure(
          write(realm, { 'c.txt': 'charlie' }, 'dropped-then-edit'),
        );
        history!.dropCommits = false;
        history!.failOutcomes = false;

        await write(realm, { 'c.txt': 'charlie, again' }, 'edit-after-dropped');
        assert.strictEqual(onDisk('c.txt'), 'charlie, again');
        assert.strictEqual(await atHead('c.txt'), 'charlie, again');
        assert.strictEqual(
          (await journal()).find(
            (row) => row.operation_id === 'dropped-then-edit',
          )?.state,
          'aborted',
        );
        let retry = await failure(
          write(realm, { 'c.txt': 'charlie' }, 'dropped-then-edit'),
        );
        assert.deepEqual(
          { status: retry.status, code: retry.code },
          { status: 409, code: 'operation-fenced' },
          `a retry of the dropped write is refused: ${retry.message}`,
        );
      },
    );

    recordingTest(
      'whose outcome still cannot be had holds back a later write to its paths',
      async function (assert) {
        let { realm, history } = await mount();
        history!.loseCommitResponses = true;
        history!.failOutcomes = true;
        await failure(write(realm, { 'c.txt': 'charlie' }, 'lost-unreachable'));
        let head = await backend().head();
        history!.loseCommitResponses = false;

        let err = await failure(
          write(realm, { 'c.txt': 'charlie, again' }, 'edit-unreachable'),
        );
        assert.deepEqual(
          { status: err.status, code: err.code },
          { status: 503, code: 'revision-aborted' },
          err.message,
        );
        assert.strictEqual(await backend().head(), head, 'nothing recorded');
        assert.strictEqual(
          (await journal()).find(
            (row) => row.operation_id === 'lost-unreachable',
          )?.state,
          'pending',
        );
      },
    );
  });

  module('an edit made to the realm directory directly', function () {
    recordingTest(
      'is recorded at the next mount as a system revision',
      async function (assert) {
        let { realm: first } = await mount();
        let before = await backend().head();
        writeFileSync(join(realmDir, 'a.txt'), 'alpha, by hand');
        writeFileSync(join(realmDir, 'e.txt'), 'echo');
        removeSync(join(realmDir, 'b.txt'));

        let jobsBefore = await settleJobs();
        await mount();
        let head = await backend().head();
        assert.deepEqual(historyFrom(realmDir, head).slice(0, 2), [
          head,
          before,
        ]);
        let drift = readRevision(realmDir, head);
        assert.strictEqual(drift.subject, DRIFT_MESSAGE);
        assert.strictEqual(drift.trailers['Boxel-Channel'], 'system');
        assert.notStrictEqual(drift.author, 'owner', 'authored by no user');
        assert.deepEqual(drift.changes, ['A e.txt', 'D b.txt', 'M a.txt']);
        assert.strictEqual(await first.history!.revisionKind(head), 'drift');
        let event = recoveries.at(-1)!;
        assert.deepEqual(event.driftRevisions, [head]);
        assert.strictEqual(event.driftPaths, 3, 'the alert has its count');
        assert.deepEqual(await indexedSince(jobsBefore), [
          'a.txt',
          'b.txt',
          'e.txt',
        ]);
      },
    );

    recordingTest(
      'is recorded by the scheduled check, which leaves a clean realm alone',
      async function (assert) {
        let { realm } = await mount();
        let head = await backend().head();
        let jobsBefore = await settleJobs();
        let task = realmHistoryRecovery({
          dbAdapter,
          reportStatus: () => undefined,
          log: { info: () => undefined, warn: () => undefined },
          getAuthedFetch: async () =>
            (async (input: RequestInfo | URL) =>
              await handle(
                realm,
                new Request(String(input), {
                  method: 'POST',
                  headers: { Accept: 'application/json' },
                }),
              )) as unknown as typeof globalThis.fetch,
        } as any);
        let { realms } = await task({});
        assert.deepEqual(realms, { [realmURL]: 'clean' });
        assert.strictEqual(await backend().head(), head, 'no revision');
        assert.deepEqual(await indexedSince(jobsBefore), [], 'no index pass');

        writeFileSync(join(realmDir, 'a.txt'), 'alpha, by hand');
        ({ realms } = await task({}));
        assert.deepEqual(realms, { [realmURL]: 'recovered' });
        let drift = readRevision(realmDir, await backend().head());
        assert.strictEqual(drift.subject, DRIFT_MESSAGE);
        assert.deepEqual(drift.changes, ['M a.txt']);
      },
    );
  });

  module('a realm whose recovery fails', function () {
    async function crashAfterRecord() {
      let { realm: crashed } = await mount();
      crashed.__testOnlySetHistoryFaults({
        afterRecord: async () => {
          throw new Crash('afterRecord');
        },
      });
      await failure(write(crashed, { 'c.txt': 'charlie' }, 'crash-sealed'));
      await settleJobs();
    }

    async function assertReadOnly(assert: Assert, realm: Realm) {
      let write = await handle(
        realm,
        new Request(`${realmURL}f.txt`, {
          method: 'POST',
          headers: { Accept: 'application/vnd.card+source' },
          body: 'foxtrot',
        }),
      );
      assert.strictEqual(write.status, 423, 'a write is refused');
      assert.strictEqual(
        write.headers.get('X-Boxel-Realm-Read-Only'),
        'recovery-failed',
      );
      let body = JSON.parse(await write.text());
      assert.strictEqual(body.errors[0].code, 'realm-read-only');
      assert.false(existsSync(join(realmDir, 'f.txt')), 'nothing written');

      let read = await handle(
        realm,
        new Request(`${realmURL}a.txt`, {
          headers: { Accept: 'application/vnd.card+source' },
        }),
      );
      assert.strictEqual(read.status, 200, 'a read is served');
      let ready = await handle(
        realm,
        new Request(`${realmURL}_readiness-check`, {
          headers: { Accept: 'application/vnd.api+json' },
        }),
      );
      assert.strictEqual(ready.status, 200, 'the realm is ready to read');
      assert.strictEqual(
        ready.headers.get('X-Boxel-Realm-Read-Only'),
        'recovery-failed',
      );
    }

    recordingTest(
      'with history unreachable goes read-only until an operator clears it',
      async function (assert) {
        await crashAfterRecord();
        let { realm, history } = await mount({
          faulty: (history) => (history.failReads = true),
        });
        assert.strictEqual(recoveries.at(-1)?.outcome, 'read-only');
        assert.ok(recoveries.at(-1)?.error, 'with its reason');
        await assertReadOnly(assert, realm);

        // Remounting, or the schedule, leaves it read-only.
        history!.failReads = false;
        assert.strictEqual(
          await realm.recoverHistory({ trigger: 'schedule' }),
          undefined,
          'the schedule does not clear it',
        );
        await assertReadOnly(assert, realm);

        let cleared = await realm.recoverHistory({ trigger: 'operator' });
        assert.strictEqual(cleared?.outcome, 'recovered');
        assert.strictEqual(onDisk('c.txt'), 'charlie', 'completed');
        let write = await handle(
          realm,
          new Request(`${realmURL}f.txt`, {
            method: 'POST',
            headers: { Accept: 'application/vnd.card+source' },
            body: 'foxtrot',
          }),
        );
        assert.strictEqual(write.status, 204, 'writes are back');
      },
    );

    recordingTest(
      'with a corrupt history goes read-only',
      async function (assert) {
        await crashAfterRecord();
        removeSync(
          join(realmDir, HISTORY_DIR, 'jj', 'store', 'git', 'objects'),
        );
        let { realm } = await mount();
        assert.strictEqual(recoveries.at(-1)?.outcome, 'read-only');
        await assertReadOnly(assert, realm);
      },
    );
  });

  module('a realm that records no history', function () {
    recordingTest('runs no recovery', async function (assert) {
      await mount({ recording: false });
      assert.deepEqual(recoveries, []);
      assert.strictEqual(
        await realmHistoryState(dbAdapter, realmURL),
        undefined,
        'and keeps no recovery state',
      );
      assert.false(existsSync(join(realmDir, HISTORY_DIR)));
    });
  });
});
