import QUnit from 'qunit';
const { module, test } = QUnit;
import {
  appendFile,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  computeContentHash,
  type ChangeEvent,
  type ChangeEventChange,
  type ChangeStatus,
} from '@cardstack/runtime-common';
import {
  Recorder,
  RecorderFatalError,
  type RecorderStep,
} from '../src/recorder.ts';
import { Semaphore } from '../src/semaphore.ts';
import { LeaseLostError } from '../src/lease.ts';
import { DEFAULT_GROUPING_LIMITS } from '../src/grouper.ts';
import { Historian } from '../src/historian.ts';
import { Heartbeat } from '../src/health.ts';
import {
  MAIN_REF,
  parseIncludesSuperseded,
  parseJournalSeq,
  parseSizeOnlyMarker,
  readMain,
  readRevisions,
  repoPath,
  runGit,
  SIZE_ONLY_MARKER_NAME,
  type RevisionRecord,
} from '../src/repo-format.ts';
import {
  appendEvent,
  appendEventOn,
  insertRealm,
  setCursor,
  setupTestDatabase,
  sleep,
  waitUntil,
  type EventFields,
  type TestRealm,
} from './helpers.ts';
import { fsck, git } from './git-objects-test.ts';

const HOLDER = 'recorder-test-task';
const ALICE = '@alice:localhost';
const BOB = '@bob:localhost';
const AGENT = 'anthropic/claude-sonnet';
const ROOM = '!room:localhost';
const PATH = 'Author/jane.json';
const T0 = Date.parse('2026-11-11T10:00:00.000Z');
const { quietPeriodMs, maxAgeMs } = DEFAULT_GROUPING_LIMITS;

function at(offsetMs: number): Date {
  return new Date(T0 + offsetMs);
}

module('recorder', (hooks) => {
  let database = setupTestDatabase(hooks);
  let root: string;
  let realmDir: string;
  let historyRoot: string;
  let realm: TestRealm;
  let gitDir: string;
  let fatals: Error[];
  let recorders: Recorder[];

  hooks.beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'realm-recorder-'));
    realmDir = join(root, 'realm');
    historyRoot = join(root, 'history');
    await mkdir(realmDir, { recursive: true });
    realm = await insertRealm(database.db, {
      url: 'http://localhost:4201/test-user/realm/',
    });
    gitDir = repoPath(historyRoot, realm.id);
    await holdLease(HOLDER);
    fatals = [];
    recorders = [];
  });

  hooks.afterEach(async (assert) => {
    for (let recorder of recorders.splice(0)) {
      await recorder.stop();
    }
    for (let repo of await readdir(historyRoot).catch(() => [] as string[])) {
      assert.strictEqual(
        await fsck(join(historyRoot, repo)),
        '',
        `${repo} passes git fsck --strict`,
      );
    }
    await rm(root, { recursive: true, force: true });
  });

  async function holdLease(holder: string): Promise<void> {
    await database.db.execute(
      `INSERT INTO realm_historian_leases (shard, holder, expires_at)
       VALUES ('0', $1, now() + interval '1 hour')
       ON CONFLICT (shard) DO UPDATE
         SET holder = EXCLUDED.holder, expires_at = EXCLUDED.expires_at`,
      { bind: [holder] },
    );
  }

  async function expireLease(): Promise<void> {
    await database.db.execute(
      `UPDATE realm_historian_leases SET expires_at = now() - interval '1 second'
       WHERE shard = '0'`,
    );
  }

  function recorder(
    options: {
      holder?: string;
      onFatal?: (error: Error) => void;
      sizeOnlyThresholdBytes?: number;
      maxQueuedEvents?: number;
      before?: (step: RecorderStep) => Promise<void>;
    } = {},
  ): Recorder {
    let created = new Recorder({
      db: database.db,
      realm: { id: realm.id, url: realm.url, directory: realmDir, shard: 0 },
      historyRoot,
      holder: options.holder ?? HOLDER,
      io: new Semaphore(4),
      onFatal: options.onFatal ?? ((error) => fatals.push(error)),
      sizeOnlyThresholdBytes: options.sizeOnlyThresholdBytes,
      maxQueuedEvents: options.maxQueuedEvents,
      testHooks: options.before ? { before: options.before } : undefined,
    });
    recorders.push(created);
    return created;
  }

  // Writes the file into the realm and describes the change as the realm
  // server's journal does.
  async function put(
    path: string,
    content: string | Uint8Array,
    status: ChangeStatus = 'M',
  ): Promise<ChangeEventChange> {
    let full = join(realmDir, path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content);
    let bytes = typeof content === 'string' ? Buffer.from(content) : content;
    return {
      path,
      status,
      contentHash: computeContentHash(bytes),
      size: bytes.byteLength,
    };
  }

  async function grow(
    path: string,
    content: string,
    status: ChangeStatus = 'M',
  ): Promise<ChangeEventChange> {
    let full = join(realmDir, path);
    await mkdir(dirname(full), { recursive: true });
    await appendFile(full, content);
    let bytes = await readRealm(path);
    return {
      path,
      status,
      contentHash: computeContentHash(bytes),
      size: bytes.byteLength,
      appended: true,
    };
  }

  async function readRealm(path: string): Promise<Buffer> {
    let { readFile } = await import('node:fs/promises');
    return readFile(join(realmDir, path));
  }

  function event(fields: EventFields): Promise<ChangeEvent> {
    return appendEvent(database.db, realm, fields);
  }

  async function feed(
    target: Recorder,
    events: ChangeEvent[],
    tickAt?: number,
  ): Promise<void> {
    for (let next of events) {
      await target.record(next);
    }
    if (tickAt !== undefined) {
      target.tick(tickAt);
    }
    await target.settled();
  }

  // A first revision of `PATH` by Bob, a minute before T0, so the writes
  // the tests make are updates.
  async function recordInitial(target: Recorder): Promise<ChangeEvent> {
    let initial = await event({
      author: BOB,
      changes: [await put(PATH, '{"v":"initial"}', 'A')],
      occurredAt: at(-60_000),
    });
    await feed(target, [initial], T0 - 60_000 + quietPeriodMs);
    return initial;
  }

  // Oldest first.
  async function history(): Promise<RevisionRecord[]> {
    return (await readRevisions(gitDir, [MAIN_REF])).reverse();
  }

  function subjectOf(revision: RevisionRecord): string {
    return revision.message.split('\n')[0];
  }

  async function show(revision: string, path: string): Promise<string> {
    return (await runGit(gitDir, ['show', `${revision}:${path}`])).toString();
  }

  async function authorOf(
    revision: string,
  ): Promise<{ name: string; email: string; date: number; committer: string }> {
    let [name, email, date, committer] = (
      await git(
        gitDir,
        'log',
        '-1',
        '--format=%an%x00%ae%x00%at%x00%cn',
        revision,
      )
    )
      .trim()
      .split('\0');
    return { name, email, date: Number(date), committer };
  }

  async function treeOf(revision: string): Promise<string> {
    return (await git(gitDir, 'rev-parse', `${revision}^{tree}`)).trim();
  }

  async function state(): Promise<{ cursorSeq: number; head: string | null }> {
    let [row] = await database.db.execute(
      `SELECT cursor_seq::text AS cursor_seq, head FROM realm_history_state
       WHERE realm_id = $1`,
      { bind: [realm.id] },
    );
    return {
      cursorSeq: Number(row.cursor_seq),
      head: (row.head as string | null) ?? null,
    };
  }

  async function cursorOf(): Promise<{ xid: string; seq: number }> {
    let [row] = await database.db.execute(
      `SELECT cursor_xid::text AS xid, cursor_seq::text AS seq
       FROM realm_history_state WHERE realm_id = $1`,
      { bind: [realm.id] },
    );
    return { xid: row.xid as string, seq: Number(row.seq) };
  }

  async function statusOf(): Promise<string> {
    let [row] = await database.db.execute(
      `SELECT status FROM realm_history_state WHERE realm_id = $1`,
      { bind: [realm.id] },
    );
    return row.status as string;
  }

  async function pathState(): Promise<
    Record<string, { hash: string; size: number; object: string }>
  > {
    let rows = await database.db.execute(
      `SELECT path, content_hash, size::text AS size, object_id
       FROM realm_history_path_state WHERE realm_id = $1 ORDER BY path`,
      { bind: [realm.id] },
    );
    return Object.fromEntries(
      rows.map((row) => [
        row.path as string,
        {
          hash: row.content_hash as string,
          size: Number(row.size),
          object: row.object_id as string,
        },
      ]),
    );
  }

  // Every event `seq` each revision's `Boxel-Journal-Seq` covers. The tests'
  // events commit in `seq` order, so a range is every `seq` from its first to
  // its last that belongs to the realm.
  async function coveredSeqs(revisions: RevisionRecord[]): Promise<number[][]> {
    let rows = await database.db.execute(
      `SELECT seq FROM realm_change_events WHERE realm_id = $1 ORDER BY seq`,
      { bind: [realm.id] },
    );
    let seqs = rows.map((row) => Number(row.seq));
    return revisions.map((revision) =>
      (revision.trailers.journalSeq ?? []).flatMap((value) => {
        let range = parseJournalSeq(value)!;
        return seqs.filter((seq) => seq >= range.first && seq <= range.last);
      }),
    );
  }

  test('an autosave burst becomes one revision of the last content', async (assert) => {
    let target = recorder();
    await recordInitial(target);
    let burst: ChangeEvent[] = [];
    for (let i = 0; i < 8; i++) {
      let saved = await event({
        author: ALICE,
        channel: 'host',
        changes: [await put(PATH, `{"v":${i}}`)],
        occurredAt: at(i * 1000),
      });
      await target.record(saved);
      burst.push(saved);
    }
    target.tick(T0 + 7000 + quietPeriodMs);
    await target.settled();

    let revisions = await history();
    assert.strictEqual(revisions.length, 2, 'the burst is one revision');
    let revision = revisions[1];
    assert.strictEqual(
      subjectOf(revision),
      'Update Author/jane.json (8 writes)',
    );
    assert.deepEqual(revision.trailers.writeCount, ['8']);
    assert.deepEqual(revision.trailers.firstWriteAt, [at(0).toISOString()]);
    assert.deepEqual(revision.trailers.channel, ['host']);
    assert.deepEqual(revision.trailers.journalSeq, [
      `${burst[0].seq}-${burst[7].seq}`,
    ]);
    let author = await authorOf(revision.id);
    assert.strictEqual(author.name, ALICE);
    assert.strictEqual(author.email, ALICE);
    assert.strictEqual(
      author.date,
      (T0 + 7000) / 1000,
      'dated at the last save',
    );
    assert.strictEqual(author.committer, 'realm-historian');
    assert.strictEqual(
      await show(revision.id, PATH),
      '{"v":7}',
      'only the last content',
    );
    assert.deepEqual(await state(), {
      cursorSeq: burst[7].seq,
      head: revision.id,
    });
    let paths = await pathState();
    assert.strictEqual(paths[PATH].hash, computeContentHash('{"v":7}'));
    assert.strictEqual(paths[PATH].size, 7);
    assert.deepEqual(fatals, []);
  });

  test("a user's edit and the AI's patch that follows are two revisions", async (assert) => {
    let target = recorder();
    await recordInitial(target);
    let edit = await event({
      author: ALICE,
      channel: 'host',
      changes: [await put(PATH, '{"v":"alice"}')],
      occurredAt: at(0),
    });
    await feed(target, [edit]);
    let patch = await event({
      author: ALICE,
      channel: 'ai-assistant',
      agent: AGENT,
      room: ROOM,
      correlationId: 'tool-call-1',
      changes: [await put(PATH, '{"v":"ai"}')],
      occurredAt: at(300),
    });
    await feed(target, [patch], T0 + 300 + quietPeriodMs);

    let revisions = await history();
    assert.strictEqual(revisions.length, 3);
    let [, userRevision, aiRevision] = revisions;
    assert.strictEqual(subjectOf(userRevision), 'Update Author/jane.json');
    assert.deepEqual(userRevision.trailers.channel, ['host']);
    assert.strictEqual(await show(userRevision.id, PATH), '{"v":"alice"}');
    assert.strictEqual(subjectOf(aiRevision), 'Update Author/jane.json');
    assert.deepEqual(aiRevision.trailers.channel, ['ai-assistant']);
    assert.deepEqual(aiRevision.trailers.agent, [AGENT]);
    assert.deepEqual(aiRevision.trailers.room, [ROOM]);
    assert.deepEqual(aiRevision.trailers.correlationIds, ['tool-call-1']);
    assert.strictEqual(
      (await authorOf(aiRevision.id)).name,
      ALICE,
      'the human stays the author',
    );
    assert.strictEqual(await show(aiRevision.id, PATH), '{"v":"ai"}');
    for (let revision of revisions) {
      assert.strictEqual(revision.trailers.superseded, undefined);
      assert.strictEqual(revision.trailers.includesSuperseded, undefined);
    }
  });

  test("a user's edit replaced before capture is recorded as having happened, with its content not kept", async (assert) => {
    let target = recorder();
    await recordInitial(target);
    let edit = await event({
      author: ALICE,
      channel: 'host',
      changes: [await put(PATH, '{"v":"alice"}')],
      occurredAt: at(0),
    });
    let patch = await event({
      author: ALICE,
      channel: 'ai-assistant',
      agent: AGENT,
      room: ROOM,
      correlationId: 'tool-call-1',
      changes: [await put(PATH, '{"v":"ai"}')],
      occurredAt: at(300),
    });
    // Capture is behind: the file already holds the AI's bytes when the
    // user's edit is captured.
    await feed(target, [edit, patch], T0 + 300 + quietPeriodMs);

    let revisions = await history();
    assert.strictEqual(revisions.length, 3);
    let [initial, userRevision, aiRevision] = revisions;
    assert.strictEqual(
      subjectOf(userRevision),
      'Update Author/jane.json (content not kept)',
    );
    assert.strictEqual((await authorOf(userRevision.id)).name, ALICE);
    assert.deepEqual(userRevision.trailers.channel, ['host']);
    assert.deepEqual(userRevision.trailers.superseded, [PATH]);
    assert.deepEqual(userRevision.trailers.journalSeq, [`${edit.seq}`]);
    assert.strictEqual(
      await treeOf(userRevision.id),
      await treeOf(initial.id),
      "the user's revision is an empty commit",
    );
    assert.deepEqual(aiRevision.trailers.includesSuperseded, [
      `${userRevision.id} ${PATH}`,
    ]);
    assert.deepEqual(
      parseIncludesSuperseded(aiRevision.trailers.includesSuperseded![0]),
      { revision: userRevision.id, path: PATH },
    );
    assert.strictEqual(await show(aiRevision.id, PATH), '{"v":"ai"}');
    assert.deepEqual(aiRevision.trailers.journalSeq, [`${patch.seq}`]);
    assert.deepEqual(await state(), {
      cursorSeq: patch.seq,
      head: aiRevision.id,
    });
  });

  test('an append above the size threshold is a size-only entry no later append supersedes', async (assert) => {
    let target = recorder({ sizeOnlyThresholdBytes: 1000 });
    let first = await event({
      author: ALICE,
      changes: [await grow('logs/events.jsonl', 'a'.repeat(1500), 'A')],
      occurredAt: at(0),
    });
    let second = await event({
      author: BOB,
      changes: [await grow('logs/events.jsonl', 'b'.repeat(100))],
      occurredAt: at(500),
    });
    // Both appends have landed before either is captured.
    await feed(target, [first, second], T0 + 500 + quietPeriodMs);

    let revisions = await history();
    assert.strictEqual(revisions.length, 2);
    for (let [index, expected] of [
      [0, first],
      [1, second],
    ] as const) {
      let revision = revisions[index];
      assert.strictEqual(
        revision.trailers.superseded,
        undefined,
        'nothing is superseded',
      );
      let [type] = (
        await git(gitDir, 'cat-file', '-t', `${revision.id}:logs/events.jsonl`)
      ).split('\n');
      assert.strictEqual(type, 'tree', 'the file is a size-only entry');
      let marker = parseSizeOnlyMarker(
        await show(revision.id, `logs/events.jsonl/${SIZE_ONLY_MARKER_NAME}`),
      );
      assert.deepEqual(marker, {
        size: expected.changes[0].size,
        fingerprint: expected.changes[0].contentHash,
      });
    }
    let paths = await pathState();
    assert.strictEqual(paths['logs/events.jsonl'].size, 1600);
    assert.strictEqual(
      paths['logs/events.jsonl'].hash,
      second.changes[0].contentHash,
    );
  });

  test("an append below the size threshold keeps the bytes up to its event's size", async (assert) => {
    let target = recorder();
    let first = await event({
      author: ALICE,
      changes: [await grow('logs/small.jsonl', 'a'.repeat(100), 'A')],
      occurredAt: at(0),
    });
    let second = await event({
      author: BOB,
      changes: [await grow('logs/small.jsonl', 'b'.repeat(50))],
      occurredAt: at(500),
    });
    await feed(target, [first, second], T0 + 500 + quietPeriodMs);

    let revisions = await history();
    assert.strictEqual(revisions.length, 2);
    assert.strictEqual(
      await show(revisions[0].id, 'logs/small.jsonl'),
      'a'.repeat(100),
    );
    assert.strictEqual(
      await show(revisions[1].id, 'logs/small.jsonl'),
      'a'.repeat(100) + 'b'.repeat(50),
    );
    for (let revision of revisions) {
      assert.strictEqual(revision.trailers.superseded, undefined);
    }
  });

  test('a batch that failed partway records the paths that landed, marked partial', async (assert) => {
    let target = recorder();
    let batch = await event({
      author: ALICE,
      channel: 'ai-assistant',
      agent: AGENT,
      room: ROOM,
      correlationId: 'tool-call-7',
      partial: true,
      changes: [
        await put('Author/a.json', '{"a":1}', 'A'),
        await put('Author/b.json', '{"b":1}', 'A'),
      ],
      occurredAt: at(0),
    });
    await feed(target, [batch], T0 + quietPeriodMs);

    let [revision] = await history();
    assert.strictEqual(subjectOf(revision), 'Add 2 files in Author/');
    assert.deepEqual(revision.trailers.partial, ['true']);
    assert.deepEqual(revision.trailers.agent, [AGENT]);
    assert.deepEqual(
      (await git(gitDir, 'ls-tree', '-r', '--name-only', revision.id))
        .trim()
        .split('\n'),
      ['Author/a.json', 'Author/b.json'],
    );
  });

  for (let [step, when] of [
    ['commit', 'before its HEAD check'],
    ['update-ref', 'between its HEAD check and moving HEAD'],
  ] as const) {
    test(`a recorder whose HEAD another writer moves ${when} regroups, so no event is in two revisions`, async (assert) => {
      let first = await event({
        author: ALICE,
        changes: [await put('a.json', '{"a":1}', 'A')],
        occurredAt: at(0),
      });
      let second = await event({
        author: ALICE,
        changes: [await put('b.json', '{"b":1}', 'A')],
        occurredAt: at(1000),
      });
      let third = await event({
        author: BOB,
        changes: [await put('c.json', '{"c":1}', 'A')],
        occurredAt: at(1500),
      });
      // Another task, which has lost the lease, records the first event alone
      // while this recorder commits the first two together. Its commit lands;
      // its cursor update fails on the lease.
      let otherFatals: Error[] = [];
      let interfered = false;
      let target = recorder({
        before: async (reached) => {
          if (reached !== step || interfered) {
            return;
          }
          interfered = true;
          let other = recorder({
            holder: 'a-task-that-lost-the-lease',
            onFatal: (error) => otherFatals.push(error),
          });
          await feed(other, [first], T0 + 10_000);
        },
      });
      await feed(target, [first, second, third], T0 + 1500 + quietPeriodMs);

      assert.true(interfered);
      assert.strictEqual(otherFatals.length, 1);
      assert.true(
        otherFatals[0] instanceof LeaseLostError,
        'the other task loses on the lease',
      );
      assert.deepEqual(fatals, []);
      let revisions = await history();
      let covered = await coveredSeqs(revisions);
      assert.deepEqual(covered, [[first.seq], [second.seq], [third.seq]]);
      let all = covered.flat();
      assert.strictEqual(
        new Set(all).size,
        all.length,
        'no event is in two revisions',
      );
      assert.deepEqual(await state(), {
        cursorSeq: third.seq,
        head: revisions[2].id,
      });
      let paths = await pathState();
      assert.deepEqual(Object.keys(paths), ['a.json', 'b.json', 'c.json']);
      assert.strictEqual(
        paths['a.json'].hash,
        computeContentHash('{"a":1}'),
        "path state includes the other writer's revision",
      );
    });
  }

  for (let [lease, takeLease] of [
    ['another task holds it', () => holdLease('another-task')],
    ['it has expired', () => expireLease()],
  ] as const) {
    test(`the cursor never advances without the lease: ${lease}`, async (assert) => {
      await takeLease();
      let target = recorder();
      let edit = await event({
        author: ALICE,
        changes: [await put(PATH, '{"v":1}', 'A')],
        occurredAt: at(0),
      });
      await feed(target, [edit], T0 + quietPeriodMs);

      assert.strictEqual(fatals.length, 1);
      assert.true(fatals[0] instanceof LeaseLostError);
      assert.strictEqual(target.state, 'stopped');
      assert.deepEqual(await state(), { cursorSeq: 0, head: null });
      assert.deepEqual(await pathState(), {});
      assert.notStrictEqual(
        await readMain(gitDir),
        undefined,
        'the commit landed, and the next holder skips past it',
      );
    });
  }

  test('a mismatch with no newer event waits the maximum age, then records the disk content as unattributed', async (assert) => {
    let target = recorder();
    await recordInitial(target);
    let edit = await event({
      author: ALICE,
      changes: [await put(PATH, '{"v":"alice"}')],
      occurredAt: at(0),
    });
    // Replaced on disk by something that writes no event.
    await put(PATH, '{"v":"out of band"}');
    await feed(target, [edit], T0 + quietPeriodMs);
    assert.strictEqual((await history()).length, 1, 'the group waits');
    await feed(target, [], T0 + maxAgeMs - 1);
    assert.strictEqual((await history()).length, 1, 'until the maximum age');
    await feed(target, [], T0 + maxAgeMs);

    let revisions = await history();
    assert.strictEqual(revisions.length, 3);
    let [, userRevision, unattributed] = revisions;
    assert.strictEqual(
      subjectOf(userRevision),
      'Update Author/jane.json (content not kept)',
    );
    assert.deepEqual(userRevision.trailers.superseded, [PATH]);
    assert.strictEqual(subjectOf(unattributed), 'Unattributed changes');
    assert.strictEqual((await authorOf(unattributed.id)).name, 'boxel-system');
    assert.deepEqual(unattributed.trailers.channel, ['system']);
    assert.deepEqual(unattributed.trailers.includesSuperseded, [
      `${userRevision.id} ${PATH}`,
    ]);
    assert.strictEqual(unattributed.trailers.journalSeq, undefined);
    assert.strictEqual(
      await show(unattributed.id, PATH),
      '{"v":"out of band"}',
    );
    assert.deepEqual(await state(), {
      cursorSeq: edit.seq,
      head: unattributed.id,
    });
    assert.strictEqual(
      (await pathState())[PATH].hash,
      computeContentHash('{"v":"out of band"}'),
    );
  });

  test('a mismatch is superseded once a newer event for the path reaches the journal during the wait', async (assert) => {
    let target = recorder();
    await recordInitial(target);
    let edit = await event({
      author: ALICE,
      changes: [await put(PATH, '{"v":"alice"}')],
      occurredAt: at(0),
    });
    let replacement = await put(PATH, '{"v":"ai"}');
    await feed(target, [edit], T0 + quietPeriodMs);
    assert.strictEqual((await history()).length, 1, 'the group waits');
    // The newer write's event commits, but the recorder hasn't been handed
    // it yet.
    let patch = await event({
      author: ALICE,
      channel: 'ai-assistant',
      agent: AGENT,
      room: ROOM,
      correlationId: 'tool-call-2',
      changes: [replacement],
      occurredAt: at(500),
    });
    await feed(target, [], T0 + quietPeriodMs + 1);
    let revisions = await history();
    assert.strictEqual(revisions.length, 2, "the user's write is superseded");
    assert.deepEqual(revisions[1].trailers.superseded, [PATH]);
    await feed(target, [patch], T0 + 500 + quietPeriodMs);
    revisions = await history();
    assert.strictEqual(revisions.length, 3);
    assert.deepEqual(revisions[2].trailers.includesSuperseded, [
      `${revisions[1].id} ${PATH}`,
    ]);
  });

  test('a group whose content equals HEAD records no revision but moves the cursor', async (assert) => {
    let target = recorder();
    let initial = await recordInitial(target);
    let same = await event({
      author: ALICE,
      changes: [await put(PATH, '{"v":"initial"}')],
      occurredAt: at(0),
    });
    await feed(target, [same], T0 + quietPeriodMs);
    let revisions = await history();
    assert.strictEqual(revisions.length, 1);
    assert.deepEqual(await state(), {
      cursorSeq: same.seq,
      head: revisions[0].id,
    });
    assert.notStrictEqual(same.seq, initial.seq);
  });

  test('a revert carries the revert trailers and is never coalesced', async (assert) => {
    let target = recorder();
    await recordInitial(target);
    let [initial] = await history();
    let edit = await event({
      author: BOB,
      changes: [await put(PATH, '{"v":"edited"}')],
      occurredAt: at(0),
    });
    // Captured before the revert writes, so the edit is kept.
    await feed(target, [edit]);
    let revert = await event({
      author: BOB,
      intent: {
        kind: 'revert',
        revision: initial.id,
        path: 'Author/',
        forced: false,
      },
      changes: [await put(PATH, '{"v":"initial"}')],
      occurredAt: at(500),
    });
    await feed(target, [revert], T0 + 500 + quietPeriodMs);

    let revisions = await history();
    assert.strictEqual(
      revisions.length,
      3,
      'the revert is not coalesced with the edit',
    );
    assert.deepEqual(revisions[1].trailers.journalSeq, [`${edit.seq}`]);
    let reverted = revisions[2];
    assert.strictEqual(
      subjectOf(reverted),
      `Revert Author/ to ${initial.id.slice(0, 7)}`,
    );
    assert.deepEqual(reverted.trailers.revertOf, [initial.id]);
    assert.deepEqual(reverted.trailers.revertForced, ['false']);
    assert.deepEqual(reverted.trailers.journalSeq, [`${revert.seq}`]);
    assert.strictEqual(await show(reverted.id, PATH), '{"v":"initial"}');
  });

  test('events at or below the cursor are ignored', async (assert) => {
    let before = await event({
      author: ALICE,
      changes: [await put('old.json', '{}', 'A')],
      occurredAt: at(0),
    });
    let after = await event({
      author: ALICE,
      changes: [await put('new.json', '{}', 'A')],
      occurredAt: at(100),
    });
    await setCursor(database.db, realm, { xid: before.xid, seq: before.seq });
    let target = recorder();
    await feed(target, [before, after, before], T0 + 100 + quietPeriodMs);
    let [revision, ...rest] = await history();
    assert.deepEqual(rest, []);
    assert.deepEqual(revision.trailers.journalSeq, [`${after.seq}`]);
    assert.deepEqual(revision.changedPaths, ['new.json']);
  });

  test('a recorder that starts after a crash between a commit and its cursor update skips the events that commit covers', async (assert) => {
    let edit = await event({
      author: ALICE,
      changes: [await put('a.json', '{"a":1}', 'A')],
      occurredAt: at(0),
    });
    let crashed = recorder({
      before: async (step) => {
        if (step === 'cursor') {
          throw new Error('simulated crash');
        }
      },
    });
    await feed(crashed, [edit], T0 + quietPeriodMs);
    assert.strictEqual(fatals.length, 1);
    assert.true(fatals[0] instanceof RecorderFatalError);
    assert.deepEqual(await state(), { cursorSeq: 0, head: null });

    let next = await event({
      author: BOB,
      changes: [await put('b.json', '{"b":1}', 'A')],
      occurredAt: at(1000),
    });
    let restarted = recorder();
    await feed(restarted, [edit, next], T0 + 1000 + quietPeriodMs);
    let revisions = await history();
    assert.deepEqual(await coveredSeqs(revisions), [[edit.seq], [next.seq]]);
    assert.deepEqual(await state(), {
      cursorSeq: next.seq,
      head: revisions[1].id,
    });
    assert.deepEqual(Object.keys(await pathState()), ['a.json', 'b.json']);
  });

  test('a superseded path remembered across a restart is named by the next revision that records it', async (assert) => {
    let first = recorder();
    await recordInitial(first);
    let edit = await event({
      author: ALICE,
      changes: [await put(PATH, '{"v":"alice"}')],
      occurredAt: at(0),
    });
    let patch = await event({
      author: ALICE,
      channel: 'ai-assistant',
      agent: AGENT,
      room: ROOM,
      correlationId: 'tool-call-3',
      changes: [await put(PATH, '{"v":"ai"}')],
      occurredAt: at(300),
    });
    // The user's revision commits; the task stops before the AI's.
    await feed(first, [edit], T0 + quietPeriodMs);
    await first.stop();
    let restarted = recorder();
    await feed(restarted, [patch], T0 + 300 + quietPeriodMs);

    let [, userRevision, aiRevision] = await history();
    assert.deepEqual(userRevision.trailers.superseded, [PATH]);
    assert.deepEqual(aiRevision.trailers.includesSuperseded, [
      `${userRevision.id} ${PATH}`,
    ]);
  });

  test("a failure in the realm's own files stalls the realm without ending the task", async (assert) => {
    let target = recorder();
    let bad = await event({
      author: ALICE,
      changes: [{ path: '../outside.json', status: 'A' }],
      occurredAt: at(0),
    });
    await feed(target, [bad], T0 + quietPeriodMs);
    assert.strictEqual(target.state, 'stalled');
    assert.deepEqual(fatals, []);
    let [row] = await database.db.execute(
      `SELECT status, stalled_reason FROM realm_history_state WHERE realm_id = $1`,
      { bind: [realm.id] },
    );
    assert.strictEqual(row.status, 'stalled');
    assert.true(String(row.stalled_reason).includes('../outside.json'));
    assert.strictEqual(
      target.idleSince(),
      undefined,
      'a stalled recorder is never dropped as idle',
    );

    let again = recorder();
    let later = await event({
      author: ALICE,
      changes: [await put('fine.json', '{}', 'A')],
      occurredAt: at(1000),
    });
    await feed(again, [later], T0 + 1000 + quietPeriodMs);
    assert.strictEqual(again.state, 'stalled', 'a stalled realm stays stalled');
  });

  test('a task that has lost the lease leaves a failing realm unstalled', async (assert) => {
    await holdLease('another-task');
    let target = recorder();
    let bad = await event({
      author: ALICE,
      changes: [{ path: '../outside.json', status: 'A' }],
      occurredAt: at(0),
    });
    await feed(target, [bad], T0 + quietPeriodMs);
    assert.strictEqual(fatals.length, 1);
    assert.true(fatals[0] instanceof LeaseLostError);
    assert.strictEqual(target.state, 'stopped');
    assert.strictEqual(await statusOf(), 'ok');
  });

  test('an event queued while its recorder loads survives the cursor moving under the load', async (assert) => {
    let first = await event({
      author: ALICE,
      changes: [await put('a.json', '{"a":1}', 'A')],
      occurredAt: at(0),
    });
    // A commit lands without its cursor update, as after a crash.
    let crashed = recorder({
      before: async (step) => {
        if (step === 'cursor') {
          throw new Error('simulated crash');
        }
      },
    });
    await feed(crashed, [first], T0 + quietPeriodMs);
    let [revision] = await history();
    let second = await event({
      author: BOB,
      changes: [await put('b.json', '{"b":1}', 'A')],
      occurredAt: at(1000),
    });
    // The next recorder's load catches up with that commit, and another
    // task moves the cursor past it first.
    let raced = false;
    let target = recorder({
      before: async (step) => {
        if (step !== 'cursor' || raced) {
          return;
        }
        raced = true;
        await database.db.execute(
          `UPDATE realm_history_state
           SET cursor_xid = $2::xid8, cursor_seq = $3, head = $4
           WHERE realm_id = $1`,
          { bind: [realm.id, first.xid, first.seq, revision.id] },
        );
      },
    });
    await feed(target, [second], T0 + 1000 + quietPeriodMs);

    assert.true(raced);
    assert.strictEqual(fatals.length, 1, 'only the crash is fatal');
    assert.strictEqual(target.state, 'running');
    let revisions = await history();
    assert.deepEqual(await coveredSeqs(revisions), [[first.seq], [second.seq]]);
    assert.deepEqual(await state(), {
      cursorSeq: second.seq,
      head: revisions[1].id,
    });
  });

  test('a revision covers its events in journal order, by transaction before seq', async (assert) => {
    // The earlier write's transaction takes its xid, then waits while a
    // later write's commits: the earlier event has the lower xid and the
    // higher seq.
    let aChange = await put('a.json', '{"a":1}', 'A');
    let bChange = await put('b.json', '{"b":1}', 'A');
    let began!: () => void;
    let begun = new Promise<void>((resolve) => (began = resolve));
    let release!: () => void;
    let released = new Promise<void>((resolve) => (release = resolve));
    let pending = database.another().withTransaction(async (query) => {
      await query(['SELECT pg_current_xact_id()']);
      began();
      await released;
      return appendEventOn(query, realm, {
        author: ALICE,
        changes: [aChange],
        occurredAt: at(0),
      });
    });
    await begun;
    let later = await event({
      author: ALICE,
      changes: [bChange],
      occurredAt: at(500),
    });
    release();
    let earlier = await pending;
    assert.true(
      earlier.seq > later.seq,
      'the earlier event has the higher seq',
    );
    assert.true(BigInt(earlier.xid) < BigInt(later.xid), 'and the lower xid');

    // One recorder commits both, in journal order, and crashes before its
    // cursor update.
    let crashed = recorder({
      before: async (step) => {
        if (step === 'cursor') {
          throw new Error('simulated crash');
        }
      },
    });
    await feed(crashed, [earlier, later], T0 + 500 + quietPeriodMs);
    let [revision] = await history();
    assert.deepEqual(revision.trailers.journalSeq, [
      `${earlier.seq}-${later.seq}`,
    ]);

    // The next recorder's HEAD check, as it loads, moves the cursor to the
    // last of them in journal order, so neither is handled again.
    let restarted = recorder();
    await feed(restarted, [earlier]);
    assert.deepEqual(await cursorOf(), { xid: later.xid, seq: later.seq });
    await feed(restarted, [later], T0 + 10_000);
    assert.strictEqual((await history()).length, 1);
  });

  test('a change to a path history cannot hold is left out, and the rest of its event is recorded', async (assert) => {
    let target = recorder();
    let batch = await event({
      author: ALICE,
      changes: [
        await put('Author/a.json', '{"a":1}', 'A'),
        await put('vendor/.git/config', '[core]', 'A'),
        await put('vendor/GIT~1', 'x', 'A'),
        await put(`Logs/${SIZE_ONLY_MARKER_NAME}`, 'not a marker', 'A'),
        await put('line\nbreak.json', '{}', 'A'),
      ],
      occurredAt: at(0),
    });
    await feed(target, [batch], T0 + quietPeriodMs);
    assert.strictEqual(target.state, 'running');
    let [revision] = await history();
    assert.strictEqual(subjectOf(revision), 'Add Author/a.json');
    assert.deepEqual(revision.trailers.journalSeq, [`${batch.seq}`]);
    assert.deepEqual(Object.keys(await pathState()), ['Author/a.json']);

    // A recorder that loads the repo afresh records a file beside the one
    // that took the reserved name.
    await target.stop();
    let restarted = recorder();
    let next = await event({
      author: ALICE,
      changes: [await put('Logs/today.json', '{}', 'A')],
      occurredAt: at(10_000),
    });
    await feed(restarted, [next], T0 + 10_000 + quietPeriodMs);
    assert.strictEqual(restarted.state, 'running');
    assert.deepEqual(
      (await git(gitDir, 'ls-tree', '-r', '--name-only', MAIN_REF))
        .trim()
        .split('\n'),
      ['Author/a.json', 'Logs/today.json'],
    );
  });

  for (let restart of [false, true]) {
    test(`a write superseded by one that changed nothing is named by no later revision${restart ? ', across a restart' : ''}`, async (assert) => {
      let target = recorder();
      await recordInitial(target);
      let edit = await event({
        author: ALICE,
        changes: [await put(PATH, '{"v":"alice"}')],
        occurredAt: at(0),
      });
      let undo = await event({
        author: BOB,
        changes: [await put(PATH, '{"v":"initial"}')],
        occurredAt: at(300),
      });
      // Both land before either is captured: the edit is superseded, and
      // the undo leaves the path as HEAD has it.
      await feed(target, [edit, undo], T0 + 300 + quietPeriodMs);
      let revisions = await history();
      assert.strictEqual(revisions.length, 2);
      assert.deepEqual(revisions[1].trailers.superseded, [PATH]);
      assert.deepEqual(await state(), {
        cursorSeq: undo.seq,
        head: revisions[1].id,
      });

      if (restart) {
        await target.stop();
        target = recorder();
      }
      let later = await event({
        author: ALICE,
        changes: [await put(PATH, '{"v":"later"}')],
        occurredAt: at(10_000),
      });
      await feed(target, [later], T0 + 10_000 + quietPeriodMs);
      revisions = await history();
      assert.strictEqual(revisions.length, 3);
      assert.strictEqual(
        revisions[2].trailers.includesSuperseded,
        undefined,
        "the edit's bytes were replaced by the undo, not by this write",
      );
    });
  }

  test('a full queue makes the consumer wait', async (assert) => {
    let release!: () => void;
    let released = new Promise<void>((resolve) => (release = resolve));
    let captures = 0;
    let target = recorder({
      maxQueuedEvents: 1,
      before: async (step) => {
        if (step === 'capture') {
          captures++;
          await released;
        }
      },
    });
    let events: ChangeEvent[] = [];
    for (let i = 0; i < 3; i++) {
      events.push(
        await event({
          author: ALICE,
          changes: [await put(`card-${i}.json`, `{"i":${i}}`, 'A')],
          occurredAt: at(i * 100),
        }),
      );
    }
    await target.record(events[0]);
    await waitUntil(() => captures === 1, { what: 'the first capture' });
    await target.record(events[1]);
    let queuedThird = false;
    let third = target.record(events[2]).then(() => (queuedThird = true));
    await sleep(50);
    assert.false(queuedThird, 'the third event waits for room in the queue');

    release();
    await third;
    target.tick(T0 + 200 + quietPeriodMs);
    await target.settled();
    let [revision] = await history();
    assert.deepEqual(revision.trailers.journalSeq, [
      `${events[0].seq}-${events[2].seq}`,
    ]);
    assert.deepEqual(revision.trailers.writeCount, ['3']);
  });

  test('stopping a recorder mid-commit lets the commit finish', async (assert) => {
    let stopping: Promise<void> | undefined;
    let target: Recorder = recorder({
      before: async (step) => {
        if (step === 'cursor' && !stopping) {
          stopping = target.stop();
        }
      },
    });
    let edit = await event({
      author: ALICE,
      changes: [await put('a.json', '{"a":1}', 'A')],
      occurredAt: at(0),
    });
    await target.record(edit);
    target.tick(T0 + quietPeriodMs);
    await waitUntil(() => stopping !== undefined, { what: 'the stop' });
    await stopping;

    assert.strictEqual(target.state, 'stopped');
    let [revision] = await history();
    assert.deepEqual(await state(), { cursorSeq: edit.seq, head: revision.id });
    assert.deepEqual(fatals, []);
  });
});

module('recording through the historian', (hooks) => {
  let database = setupTestDatabase(hooks);
  let root: string;
  let historian: Historian | undefined;

  hooks.beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'realm-historian-recording-'));
  });

  hooks.afterEach(async (assert) => {
    await historian?.stop();
    historian = undefined;
    for (let repo of await readdir(join(root, 'history')).catch(
      () => [] as string[],
    )) {
      assert.strictEqual(await fsck(join(root, 'history', repo)), '');
    }
    await rm(root, { recursive: true, force: true });
  });

  test('realms are recorded concurrently from their events', async (assert) => {
    let realmsRoot = join(root, 'realms');
    let historyRoot = join(root, 'history');
    let realms = await Promise.all(
      ['one', 'two'].map((name) =>
        insertRealm(database.db, {
          url: `http://localhost:4201/test-user/${name}/`,
          diskId: `test-user/${name}`,
        }),
      ),
    );
    let failures: unknown[] = [];
    historian = new Historian({
      db: database.another(),
      historyRoot,
      realmsRoot,
      heartbeat: new Heartbeat(),
      pollMs: 50,
      lease: {
        shardCount: 1,
        taskCount: 1,
        renewMs: 50,
        expiryMs: 1000,
        holder: 'recording-test-task',
      },
      recording: {
        limits: { ...DEFAULT_GROUPING_LIMITS, quietPeriodMs: 100 },
        clockGraceMs: 0,
      },
    });
    historian.run().catch((error) => failures.push(error));
    for (let [index, target] of realms.entries()) {
      let directory = join(
        realmsRoot,
        'test-user',
        index === 0 ? 'one' : 'two',
      );
      await mkdir(directory, { recursive: true });
      let content = `{"realm":${index}}`;
      await writeFile(join(directory, 'card.json'), content);
      await appendEvent(database.db, target, {
        author: ALICE,
        changes: [
          {
            path: 'card.json',
            status: 'A',
            contentHash: computeContentHash(content),
            size: content.length,
          },
        ],
      });
    }
    let heads = async () =>
      (
        await database.db.execute(
          `SELECT head FROM realm_history_state WHERE head IS NOT NULL`,
        )
      ).length;
    await waitUntil(async () => (await heads()) === 2, {
      timeoutMs: 10_000,
      what: 'both realms to record a revision',
    });
    for (let [index, target] of realms.entries()) {
      let content = (
        await runGit(repoPath(historyRoot, target.id), [
          'show',
          `${MAIN_REF}:card.json`,
        ])
      ).toString();
      assert.strictEqual(content, `{"realm":${index}}`);
    }
    assert.deepEqual(failures, []);
  });

  test('a recorder dropped after idling is replaced by one that loads the realm afresh', async (assert) => {
    let realmsRoot = join(root, 'realms');
    let historyRoot = join(root, 'history');
    let target = await insertRealm(database.db, {
      url: 'http://localhost:4201/test-user/idle/',
      diskId: 'test-user/idle',
    });
    let directory = join(realmsRoot, 'test-user', 'idle');
    await mkdir(directory, { recursive: true });
    let db = database.another();
    let failures: unknown[] = [];
    let created: Recorder[] = [];
    historian = new Historian({
      db,
      historyRoot,
      realmsRoot,
      heartbeat: new Heartbeat(),
      pollMs: 50,
      lease: {
        shardCount: 1,
        taskCount: 1,
        renewMs: 50,
        expiryMs: 1000,
        holder: 'idle-test-task',
      },
      recording: { clockGraceMs: 0, idleAfterMs: 0 },
      recorderFor: (realm, beat) => {
        let recorder = new Recorder({
          db,
          realm,
          historyRoot,
          holder: 'idle-test-task',
          io: new Semaphore(1),
          onFatal: (error) => failures.push(error),
          beat,
          limits: { ...DEFAULT_GROUPING_LIMITS, quietPeriodMs: 100 },
        });
        created.push(recorder);
        return recorder;
      },
    });
    historian.run().catch((error) => failures.push(error));
    let write = async (content: string, status: ChangeStatus) => {
      await writeFile(join(directory, 'card.json'), content);
      await appendEvent(database.db, target, {
        author: ALICE,
        changes: [
          {
            path: 'card.json',
            status,
            contentHash: computeContentHash(content),
            size: content.length,
          },
        ],
      });
    };
    let gitDir = repoPath(historyRoot, target.id);
    // The repo doesn't exist until the realm's first event is handled.
    let revisions = async () => {
      let [row] = await database.db.execute(
        `SELECT head FROM realm_history_state WHERE realm_id = $1`,
        { bind: [target.id] },
      );
      return row.head
        ? (await readRevisions(gitDir, [row.head as string])).length
        : 0;
    };

    await write('{"v":1}', 'A');
    await waitUntil(async () => (await revisions()) === 1, {
      timeoutMs: 10_000,
      what: 'the first revision',
    });
    await waitUntil(() => created[0].state === 'stopped', {
      what: 'the idle recorder to be dropped',
    });
    await write('{"v":2}', 'M');
    await waitUntil(async () => (await revisions()) === 2, {
      timeoutMs: 10_000,
      what: 'the second revision',
    });

    assert.strictEqual(created.length, 2, 'a new recorder took over');
    assert.strictEqual(
      (await runGit(gitDir, ['show', `${MAIN_REF}:card.json`])).toString(),
      '{"v":2}',
    );
    assert.deepEqual(failures, []);
  });
});
