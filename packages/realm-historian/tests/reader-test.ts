import QUnit from 'qunit';
const { module, test } = QUnit;
import {
  appendFile,
  chmod,
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
  unavailableHistoryReader,
  type ChangeEventChange,
  type ChangeStatus,
  type ReadHistoryParams,
  type ReadHistoryResult,
} from '@cardstack/runtime-common';
import { Recorder } from '../src/recorder.ts';
import { Semaphore } from '../src/semaphore.ts';
import { DEFAULT_GROUPING_LIMITS } from '../src/grouper.ts';
import { GitCommandError, GitTimeoutError } from '../src/git-process.ts';
import { ObjectStore } from '../src/git-objects.ts';
import {
  GitRealmHistoryReader,
  HistoryRequestError,
  type GitRealmHistoryReaderOptions,
} from '../src/reader.ts';
import {
  authorIdentity,
  buildMessage,
  committerIdentity,
  initRepo,
  readMain,
  repoPath,
  updateMain,
} from '../src/repo-format.ts';
import {
  appendEvent,
  insertRealm,
  setupTestDatabase,
  sleep,
  waitUntil,
  type EventFields,
  type TestRealm,
} from './helpers.ts';
import { fsck, git } from './git-objects-test.ts';

const HOLDER = 'reader-test-task';
const ALICE = '@alice:localhost';
const BOB = '@bob:localhost';
const AGENT = 'anthropic/claude-sonnet';
const ROOM = '!room:localhost';
const T0 = Date.parse('2026-11-11T10:00:00.000Z');
const SIZE_ONLY_THRESHOLD = 1000;
const { quietPeriodMs } = DEFAULT_GROUPING_LIMITS;

type History = Extract<ReadHistoryResult, { kind: 'history' }>;

function ids(result: History): string[] {
  return result.revisions.map(({ id }) => id);
}

module('reader', (hooks) => {
  let database = setupTestDatabase(hooks);
  let root: string;
  let realmDir: string;
  let historyRoot: string;
  let realm: TestRealm;
  let gitDir: string;
  let recorder: Recorder;
  let fatals: Error[];
  let clock: number;

  hooks.beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'realm-reader-'));
    realmDir = join(root, 'realm');
    historyRoot = join(root, 'history');
    await mkdir(realmDir, { recursive: true });
    realm = await insertRealm(database.db, {
      url: 'http://localhost:4201/test-user/realm/',
    });
    gitDir = repoPath(historyRoot, realm.id);
    await database.db.execute(
      `INSERT INTO realm_historian_leases (shard, holder, expires_at)
       VALUES ('0', $1, now() + interval '1 hour')`,
      { bind: [HOLDER] },
    );
    fatals = [];
    recorder = new Recorder({
      db: database.db,
      realm: { id: realm.id, url: realm.url, directory: realmDir, shard: 0 },
      historyRoot,
      holder: HOLDER,
      io: new Semaphore(4),
      onFatal: (error) => fatals.push(error),
      sizeOnlyThresholdBytes: SIZE_ONLY_THRESHOLD,
    });
    clock = T0;
  });

  hooks.afterEach(async (assert) => {
    await recorder.stop();
    assert.deepEqual(fatals, [], 'the recorder had no fatal error');
    for (let repo of await readdir(historyRoot).catch(() => [] as string[])) {
      assert.strictEqual(
        await fsck(join(historyRoot, repo)),
        '',
        `${repo} passes git fsck --strict`,
      );
    }
    await rm(root, { recursive: true, force: true });
  });

  function reader(
    options: Partial<GitRealmHistoryReaderOptions> = {},
  ): GitRealmHistoryReader {
    return new GitRealmHistoryReader({ historyRoot, ...options });
  }

  async function history(
    params: ReadHistoryParams = {},
    from: GitRealmHistoryReader = reader(),
  ): Promise<History> {
    let result = await from.readHistory(realm.id, params);
    if (result.kind !== 'history') {
      throw new Error(`expected a history, got ${result.kind}`);
    }
    return result;
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
    let { readFile } = await import('node:fs/promises');
    let bytes = await readFile(full);
    return {
      path,
      status,
      contentHash: computeContentHash(bytes),
      size: bytes.byteLength,
      appended: true,
    };
  }

  async function remove(path: string): Promise<ChangeEventChange> {
    await rm(join(realmDir, path));
    return { path, status: 'D' };
  }

  // Records the changes as one revision: one write, a minute after the
  // previous one, captured at once. Returns the revision.
  async function record(
    changes: ChangeEventChange[],
    fields: Partial<EventFields> = {},
  ): Promise<string> {
    clock += 60_000;
    let event = await appendEvent(database.db, realm, {
      author: ALICE,
      channel: 'host',
      ...fields,
      changes,
      occurredAt: new Date(clock),
    });
    await recorder.record(event);
    recorder.tick(clock + quietPeriodMs);
    await recorder.settled();
    return (await readMain(gitDir))!;
  }

  // Records writes that all land before any is captured, as when recording
  // lags behind: a write whose path a later write has changed again is
  // superseded. Returns the revisions they made, oldest first.
  async function recordLagging(
    writes: {
      changes: () => Promise<ChangeEventChange[]>;
      fields?: Partial<EventFields>;
    }[],
  ): Promise<string[]> {
    let before = await readMain(gitDir);
    let events = [];
    for (let write of writes) {
      clock += 1_000;
      events.push(
        await appendEvent(database.db, realm, {
          author: ALICE,
          channel: 'host',
          ...write.fields,
          changes: await write.changes(),
          occurredAt: new Date(clock),
        }),
      );
    }
    for (let event of events) {
      await recorder.record(event);
    }
    recorder.tick(clock + quietPeriodMs);
    await recorder.settled();
    let made = (
      await git(gitDir, 'rev-list', before ? `${before}..main` : 'main')
    )
      .trim()
      .split('\n');
    return made.reverse();
  }

  function aiWrite(toolCall: string): Partial<EventFields> {
    return {
      channel: 'ai-assistant',
      agent: AGENT,
      room: ROOM,
      correlationId: toolCall,
    };
  }

  async function blobAt(revision: string, path: string): Promise<string> {
    return (await git(gitDir, 'rev-parse', `${revision}:${path}`)).trim();
  }

  test('lists the whole realm, a directory and a file newest first, with only the changes under the filters', async (assert) => {
    let first = await record([
      await put('Author/jane.json', '{"v":1}', 'A'),
      await put('Author/bob.json', '{"v":1}', 'A'),
    ]);
    let second = await record([await put('Post/hello.json', '{"v":1}', 'A')], {
      author: BOB,
    });
    let third = await record([await put('Author/jane.json', '{"v":2}')]);
    let fourth = await record([await remove('Author/bob.json')]);

    let whole = await history({ includeDiffs: false });
    assert.deepEqual(ids(whole), [fourth, third, second, first]);
    assert.false(whole.hasMore);
    let [, update, , initial] = whole.revisions;
    assert.deepEqual(
      { ...update, trailers: undefined },
      {
        id: third,
        parent: second,
        author: ALICE,
        timestamp: new Date(T0 + 180_000).toISOString(),
        message: 'Update Author/jane.json',
        trailers: undefined,
        changes: [
          {
            path: 'Author/jane.json',
            status: 'M',
            beforeBlob: await blobAt(first, 'Author/jane.json'),
            afterBlob: await blobAt(third, 'Author/jane.json'),
            size: 7,
          },
        ],
      },
    );
    assert.deepEqual(update.trailers['Boxel-Channel'], ['host']);
    assert.deepEqual(update.trailers['Boxel-Write-Count'], ['1']);
    assert.strictEqual(
      initial.parent,
      undefined,
      'the first revision has no parent',
    );
    assert.strictEqual(whole.revisions[2].author, BOB);

    let directory = await history({ paths: ['Author/'], includeDiffs: false });
    assert.deepEqual(ids(directory), [fourth, third, first]);
    assert.deepEqual(
      directory.revisions[2].changes.map(({ path, status }) => [path, status]),
      [
        ['Author/bob.json', 'A'],
        ['Author/jane.json', 'A'],
      ],
    );

    let file = await history({
      paths: ['/Author/jane.json'],
      includeDiffs: false,
    });
    assert.deepEqual(ids(file), [third, first]);
    assert.deepEqual(
      file.revisions[1].changes.map(({ path }) => path),
      ['Author/jane.json'],
      'changes outside the filter are left out',
    );

    assert.deepEqual(
      ids(await history({ paths: ['Author'], includeDiffs: false })),
      [fourth, third, first],
      'a path with no trailing slash matches a directory of that name',
    );
    assert.deepEqual(
      ids(await history({ paths: ['Author/jane.json/'], includeDiffs: false })),
      [],
      'a trailing slash matches only a directory',
    );
    assert.deepEqual(
      ids(
        await history({
          paths: ['Post/', 'Author/jane.json'],
          includeDiffs: false,
        }),
      ),
      [third, second, first],
      'several filters list the revisions that change a path under any of them',
    );
    assert.deepEqual(
      ids(await history({ paths: [] })),
      [],
      'no filter matches nothing',
    );
  });

  test('pages with before, without gaps or duplicates', async (assert) => {
    let made: string[] = [];
    for (let index = 0; index < 5; index++) {
      made.push(
        await record([await put(`notes/${index}.md`, `${index}`, 'A')]),
      );
    }
    let newest = [...made].reverse();
    for (let paths of [undefined, ['notes/']]) {
      let seen: string[] = [];
      let before: string | undefined;
      let pages = 0;
      for (;;) {
        let page = await history({
          paths,
          limit: 2,
          before,
          includeDiffs: false,
        });
        pages++;
        seen.push(...ids(page));
        if (!page.hasMore) {
          break;
        }
        before = ids(page)[ids(page).length - 1];
      }
      assert.deepEqual(
        seen,
        newest,
        `every revision once, in order (${paths ?? 'whole realm'})`,
      );
      assert.strictEqual(pages, 3);
    }
    assert.deepEqual(
      ids(
        await history({
          limit: 2,
          before: made[3].slice(0, 7),
          includeDiffs: false,
        }),
      ),
      [made[2], made[1]],
      'an abbreviated revision id works as before',
    );
  });

  test('refuses a limit out of range, and answers revision-not-found for a before outside the history', async (assert) => {
    let only = await record([await put('card.json', '{}', 'A')]);
    for (let limit of [0, 501, 1.5]) {
      await assert.rejects(
        reader().readHistory(realm.id, { limit }),
        HistoryRequestError,
        `limit ${limit} is refused`,
      );
    }
    assert.strictEqual((await history({ limit: 500 })).revisions.length, 1);
    await assert.rejects(
      reader().readHistory(realm.id, { paths: ['notes/../card.json'] }),
      HistoryRequestError,
    );

    let store = new ObjectStore(gitDir);
    let tree = (await git(gitDir, 'rev-parse', `${only}^{tree}`)).trim();
    let { id: orphan } = await store.writeCommit({
      tree,
      parents: [only],
      author: authorIdentity(ALICE, new Date(T0)),
      committer: committerIdentity(new Date(T0)),
      message: 'Update card.json\n',
    });
    for (let before of ['f'.repeat(40), 'main', 'HEAD~1', orphan]) {
      assert.deepEqual(
        await reader().readHistory(realm.id, { before }),
        { kind: 'revision-not-found' },
        `${before} is not in the history`,
      );
    }
    assert.deepEqual(
      await reader().readAtRevision(realm.id, orphan, 'card.json'),
      { kind: 'revision-not-found' },
      'a commit that is not on main is not a revision',
    );

    let elsewhere = '00000000-0000-0000-0000-000000000000';
    assert.deepEqual(
      await reader().readHistory(elsewhere, {}),
      { kind: 'history', revisions: [], hasMore: false },
      'a realm with no repo has no history',
    );
    assert.deepEqual(
      await reader().readAtRevision(elsewhere, only, 'card.json'),
      { kind: 'revision-not-found' },
    );
  });

  test("status D lists the deletions under a directory, and a deleted file's history ends in its D revision", async (assert) => {
    let added = await record([
      await put('Author/jane.json', '{}', 'A'),
      await put('Author/bob.json', '{}', 'A'),
      await put('Post/hello.json', '{}', 'A'),
    ]);
    let bobDeleted = await record([await remove('Author/bob.json')]);
    await record([await remove('Post/hello.json')]);
    let janeUpdated = await record([await put('Author/jane.json', '{"v":2}')]);

    let deletions = await history({ paths: ['Author/'], status: 'D' });
    assert.deepEqual(ids(deletions), [bobDeleted]);
    assert.deepEqual(
      deletions.revisions[0].changes.map(({ path, status, size }) => ({
        path,
        status,
        size,
      })),
      [{ path: 'Author/bob.json', status: 'D', size: 2 }],
    );
    let bob = await history({ paths: ['Author/bob.json'] });
    assert.deepEqual(ids(bob), [bobDeleted, added]);
    assert.strictEqual(bob.revisions[0].changes[0].status, 'D');
    assert.deepEqual(ids(await history({ paths: ['Author/'], status: 'M' })), [
      janeUpdated,
    ]);
  });

  test('a file that becomes a size-only entry is one M change, never a deletion, and its content is not kept', async (assert) => {
    let small = await record([await put('logs/app.log', 'a'.repeat(100), 'A')]);
    let grown = await record([await grow('logs/app.log', 'b'.repeat(2000))]);
    let tree = await blobAt(grown, 'logs/app.log');
    assert.strictEqual(
      (await git(gitDir, 'cat-file', '-t', tree)).trim(),
      'tree',
      'the file is a size-only entry',
    );

    let listing = await history({ paths: ['logs/'] });
    assert.deepEqual(ids(listing), [grown, small]);
    assert.deepEqual(listing.revisions[0].changes, [
      {
        path: 'logs/app.log',
        status: 'M',
        beforeBlob: await blobAt(small, 'logs/app.log'),
        afterBlob: tree,
        size: 2100,
        diffOmitted: 'content-not-kept',
      },
    ]);
    assert.deepEqual(ids(await history({ paths: ['logs/'], status: 'D' })), []);
    assert.deepEqual(ids(await history({ status: 'A' })), [small]);

    assert.deepEqual(
      await reader().readAtRevision(realm.id, grown, 'logs/app.log'),
      { kind: 'content-not-kept', size: 2100 },
    );
    assert.deepEqual(
      await reader().readAtRevision(realm.id, small, 'logs/app.log'),
      { kind: 'file', content: 'a'.repeat(100), binary: false, size: 100 },
    );
    assert.deepEqual(
      await reader().readAtRevision(realm.id, grown, 'logs/'),
      { kind: 'directory', entries: [{ name: 'app.log', kind: 'file' }] },
      'a size-only entry is listed as a file',
    );
    assert.deepEqual(await reader().readTreeAtRevision(realm.id, grown), {
      kind: 'tree',
      files: [{ path: 'logs/app.log', id: tree, size: 2100, sizeOnly: true }],
    });
  });

  test('a superseded revision is listed after the revision whose diff contains it, and paging continues from it', async (assert) => {
    let initial = await record(
      [await put('Author/jane.json', '{"v":"initial"}', 'A')],
      { author: BOB },
    );
    let [userEdit, aiPatch] = await recordLagging([
      { changes: async () => [await put('Author/jane.json', '{"v":"alice"}')] },
      {
        changes: async () => [await put('Author/jane.json', '{"v":"ai"}')],
        fields: aiWrite('tool-call-1'),
      },
    ]);
    let later = await record([await put('Post/hello.json', '{}', 'A')]);

    for (let paths of [['Author/jane.json'], ['Author/']]) {
      let listing = await history({ paths });
      assert.deepEqual(ids(listing), [aiPatch, userEdit, initial], `${paths}`);
      let inserted = listing.revisions[1];
      assert.strictEqual(
        inserted.message,
        'Update Author/jane.json (content not kept)',
      );
      assert.deepEqual(inserted.changes, [], 'listed without changes or diff');
      assert.deepEqual(inserted.trailers['Boxel-Superseded'], [
        'Author/jane.json',
      ]);
    }
    assert.deepEqual(
      ids(await history({ includeDiffs: false })),
      [later, aiPatch, userEdit, initial],
      'the whole realm lists it in its place on its own',
    );

    let pages: string[][] = [];
    let before: string | undefined;
    for (;;) {
      let page = await history({
        paths: ['Author/jane.json'],
        limit: 1,
        before,
      });
      pages.push(ids(page));
      if (!page.hasMore) {
        break;
      }
      before = ids(page)[0];
    }
    assert.deepEqual(
      pages,
      [[aiPatch], [userEdit], [initial]],
      'a page ending on the revision that names it continues with it, and a page ending on it continues below',
    );
  });

  test('a revision superseded in two paths is listed once, after the oldest revision that names it', async (assert) => {
    let initial = await record([
      await put('Author/jane.json', '{"v":0}', 'A'),
      await put('Author/bob.json', '{"v":0}', 'A'),
    ]);
    let [userEdit, janePatch, bobPatch] = await recordLagging([
      {
        changes: async () => [
          await put('Author/jane.json', '{"v":"alice"}'),
          await put('Author/bob.json', '{"v":"alice"}'),
        ],
      },
      {
        changes: async () => [await put('Author/jane.json', '{"v":"ai"}')],
        fields: aiWrite('tool-call-1'),
      },
      {
        changes: async () => [await put('Author/bob.json', '{"v":"ai"}')],
        fields: aiWrite('tool-call-2'),
      },
    ]);
    let [userRevision] = (await history({ limit: 3 })).revisions.slice(2);
    assert.deepEqual(userRevision.trailers['Boxel-Superseded'], [
      'Author/bob.json',
      'Author/jane.json',
    ]);

    assert.deepEqual(ids(await history({ paths: ['Author/'] })), [
      bobPatch,
      janePatch,
      userEdit,
      initial,
    ]);
    assert.deepEqual(ids(await history({ paths: ['Author/bob.json'] })), [
      bobPatch,
      userEdit,
      initial,
    ]);
    assert.deepEqual(ids(await history({ paths: ['Author/jane.json'] })), [
      janePatch,
      userEdit,
      initial,
    ]);
    let first = await history({ paths: ['Author/'], limit: 2 });
    assert.deepEqual(ids(first), [bobPatch, janePatch]);
    assert.true(first.hasMore);
    assert.deepEqual(
      ids(await history({ paths: ['Author/'], limit: 1, before: janePatch })),
      [userEdit],
    );
    assert.deepEqual(
      ids(await history({ paths: ['Author/'], before: userEdit })),
      [initial],
    );
  });

  test('a superseded revision follows the revision that names it, even above a newer write to another path', async (assert) => {
    let initial = await record([
      await put('Author/jane.json', '{"v":0}', 'A'),
      await put('Author/other.json', '{"v":0}', 'A'),
    ]);
    let [userEdit, otherEdit, aiPatch] = await recordLagging([
      { changes: async () => [await put('Author/jane.json', '{"v":"alice"}')] },
      {
        changes: async () => [await put('Author/other.json', '{"v":"bob"}')],
        fields: { author: BOB },
      },
      {
        changes: async () => [await put('Author/jane.json', '{"v":"ai"}')],
        fields: aiWrite('tool-call-1'),
      },
    ]);
    assert.deepEqual(
      ids(await history({ includeDiffs: false })),
      [aiPatch, otherEdit, userEdit, initial],
      'the whole realm lists them in history order',
    );
    assert.deepEqual(
      ids(await history({ paths: ['Author/'], includeDiffs: false })),
      [aiPatch, userEdit, otherEdit, initial],
      'a directory lists the superseded revision right after the one that names it',
    );
  });

  test('the correlationId filter lists only the revisions whose trailer includes it', async (assert) => {
    await record([await put('a.json', '{}', 'A')]);
    let tool = await record(
      [await put('b.json', '{}', 'A')],
      aiWrite('tool-call-1'),
    );
    await record([await put('c.json', '{}', 'A')], aiWrite('tool-call-10'));
    await record([await put('d.json', '{}', 'A')], aiWrite('tool.call.1'));

    let listing = await history({ correlationId: 'tool-call-1' });
    assert.deepEqual(ids(listing), [tool]);
    assert.deepEqual(listing.revisions[0].trailers['Boxel-Correlation-Ids'], [
      'tool-call-1',
    ]);
    assert.deepEqual(
      ids(await history({ correlationId: 'tool-call-1', paths: ['b.json'] })),
      [tool],
    );
    assert.deepEqual(
      ids(await history({ correlationId: 'tool-call-1', paths: ['a.json'] })),
      [],
    );
  });

  test('a diff above the per-file cap is left out, and binary files carry none', async (assert) => {
    await record([
      await put('small.md', 'one\n', 'A'),
      await put('big.md', 'line\n'.repeat(10), 'A'),
      await put('image.bin', Uint8Array.from([0, 1, 2, 0, 255]), 'A'),
    ]);
    let edited = await record([
      await put('small.md', 'two\n'),
      await put('big.md', 'other\n'.repeat(100)),
      await put('image.bin', Uint8Array.from([0, 1, 2, 0, 254, 9])),
    ]);

    let [latest] = (
      await history({ limit: 1 }, reader({ maxDiffBytesPerFile: 300 }))
    ).revisions;
    assert.strictEqual(latest.id, edited);
    let byPath = Object.fromEntries(
      latest.changes.map((change) => [change.path, change]),
    );
    assert.strictEqual(byPath['big.md'].diffOmitted, 'too-large');
    assert.strictEqual(byPath['big.md'].diff, undefined);
    assert.strictEqual(byPath['image.bin'].diffOmitted, 'binary');
    assert.strictEqual(byPath['image.bin'].diff, undefined);
    assert.strictEqual(
      byPath['image.bin'].size,
      6,
      'a binary file has its size',
    );
    assert.ok(byPath['image.bin'].afterBlob);
    assert.strictEqual(
      byPath['small.md'].diff,
      [
        'diff --git a/small.md b/small.md',
        `index ${byPath['small.md'].beforeBlob}..${byPath['small.md'].afterBlob} 100644`,
        '--- a/small.md',
        '+++ b/small.md',
        '@@ -1 +1 @@',
        '-one',
        '+two',
        '',
      ].join('\n'),
    );

    let undiffed = await history({ includeDiffs: false });
    assert.true(
      undiffed.revisions.every(({ changes }) =>
        changes.every(
          (change) => !('diff' in change) && !('diffOmitted' in change),
        ),
      ),
    );

    assert.strictEqual(
      (await history()).diffsTruncated,
      undefined,
      'a listing within the budget is not truncated',
    );
  });

  test('diffs past the response budget are left out, and the listing says so', async (assert) => {
    await record([await put('a.md', 'v0\n', 'A')]);
    for (let version = 1; version <= 3; version++) {
      await record([await put('a.md', `v${version}\n`)]);
    }
    let edits = (await history({ limit: 3 })).revisions;
    let sizes = edits.map(({ changes: [change] }) =>
      Buffer.byteLength(change.diff!),
    );
    assert.strictEqual(
      new Set(sizes).size,
      1,
      'the edits have diffs of one size',
    );

    let budgeted = await history(
      { limit: 3 },
      reader({ diffBudgetBytes: sizes[0] * 2 + 1 }),
    );
    assert.true(budgeted.diffsTruncated);
    assert.deepEqual(
      budgeted.revisions.map(({ changes: [change] }) => ({
        diff: change.diff,
        diffOmitted: change.diffOmitted,
      })),
      [
        { diff: edits[0].changes[0].diff, diffOmitted: undefined },
        { diff: edits[1].changes[0].diff, diffOmitted: undefined },
        { diff: undefined, diffOmitted: 'budget' },
      ],
    );
  });

  test('a diff git prints as text but that is not UTF-8 text is a binary change', async (assert) => {
    // git calls a file binary only for a NUL in its first 8000 bytes, so it
    // prints these as text: a NUL further in, and Latin-1.
    let late = (tail: string) =>
      Buffer.concat([
        Buffer.from('a'.repeat(9000)),
        Buffer.from([0]),
        Buffer.from(tail),
      ]);
    await record([
      await put('late-nul.txt', late('one\n'), 'A'),
      await put('latin1.txt', Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]), 'A'),
    ]);
    let edited = await record([
      await put('late-nul.txt', late('two\n')),
      await put('latin1.txt', Buffer.from([0x63, 0x61, 0x66, 0xe8, 0x0a])),
    ]);
    await record([await put('after.md', 'after\n', 'A')]);

    let listing = await history();
    assert.deepEqual(
      ids(listing).slice(1, 2),
      [edited],
      'the listing reads past the revision',
    );
    for (let revision of listing.revisions.slice(1)) {
      for (let change of revision.changes) {
        assert.strictEqual(
          change.diff,
          undefined,
          `${change.path} has no diff`,
        );
        assert.strictEqual(change.diffOmitted, 'binary');
      }
    }
    assert.strictEqual(
      listing.revisions[0].changes[0].diffOmitted,
      undefined,
      'a later text diff is still read',
    );
  });

  test('a status listing walks on past revisions git counts but the listing drops, so a page is empty only at the end', async (assert) => {
    await record([await put('Author/jane.json', '{"v":1}', 'A')]);
    let updated = await record([await put('Author/jane.json', '{"v":2}')]);
    // Each adds a file to a directory that exists, which git lists under
    // `--diff-filter=M` for the directory's tree, and changes no file.
    for (let name of ['bob', 'carol', 'dave']) {
      await record([await put(`Author/${name}.json`, '{}', 'A')]);
    }
    for (let paths of [undefined, ['Author/']]) {
      let seen: string[] = [];
      let before: string | undefined;
      let ended = false;
      for (let pages = 0; pages < 5 && !ended; pages++) {
        let page = await history({ paths, status: 'M', limit: 1, before });
        seen.push(...ids(page));
        ended = !page.hasMore;
        if (!ended) {
          assert.strictEqual(
            page.revisions.length,
            1,
            'a page with more after it is full',
          );
          before = ids(page)[0];
        }
      }
      assert.true(ended, 'the listing ends');
      assert.deepEqual(seen, [updated], `${paths ?? 'whole realm'}`);
    }
  });

  test('readAtRevision answers every outcome', async (assert) => {
    let first = await record([
      await put('Author/jane.json', '{"v":1}', 'A'),
      await put('notes.md', 'abcdefghij', 'A'),
      await put('image.bin', Uint8Array.from([0, 1, 2, 0, 255]), 'A'),
    ]);
    let deleted = await record([await remove('Author/jane.json')]);
    let read = (
      revision: string,
      path: string,
      range?: { start: number; length: number },
    ) =>
      reader({ maxFileResponseBytes: 8 }).readAtRevision(
        realm.id,
        revision,
        path,
        range,
      );

    assert.deepEqual(await read(first, 'Author/jane.json'), {
      kind: 'file',
      content: '{"v":1}',
      binary: false,
      size: 7,
    });
    assert.deepEqual(await read(first, 'image.bin'), {
      kind: 'file',
      content: Buffer.from([0, 1, 2, 0, 255]).toString('base64'),
      binary: true,
      size: 5,
    });
    assert.deepEqual(await read(first, 'notes.md'), {
      kind: 'too-large',
      size: 10,
    });
    assert.deepEqual(await read(first, 'notes.md', { start: 2, length: 3 }), {
      kind: 'file',
      content: Buffer.from('cde').toString('base64'),
      binary: true,
      size: 10,
      range: { start: 2, length: 3 },
    });
    assert.deepEqual(await read(first, 'notes.md', { start: 8, length: 5 }), {
      kind: 'file',
      content: Buffer.from('ij').toString('base64'),
      binary: true,
      size: 10,
      range: { start: 8, length: 2 },
    });
    assert.deepEqual(
      await read(first, 'notes.md', { start: 0, length: 9 }),
      { kind: 'too-large', size: 10 },
      'a range longer than the response limit',
    );
    assert.deepEqual(
      await read(first, 'Author/jane.json', {
        start: 2,
        length: Number.MAX_SAFE_INTEGER,
      }),
      {
        kind: 'file',
        content: Buffer.from('v":1}').toString('base64'),
        binary: true,
        size: 7,
        range: { start: 2, length: 5 },
      },
      'a range past the end is judged by the bytes it covers',
    );
    assert.deepEqual(await read(first, '/'), {
      kind: 'directory',
      entries: [
        { name: 'Author', kind: 'directory' },
        { name: 'image.bin', kind: 'file' },
        { name: 'notes.md', kind: 'file' },
      ],
    });
    assert.deepEqual(await read(first, 'Author/'), {
      kind: 'directory',
      entries: [{ name: 'jane.json', kind: 'file' }],
    });
    assert.deepEqual(await read('f'.repeat(40), 'notes.md'), {
      kind: 'revision-not-found',
    });
    assert.deepEqual(await read('not-a-revision', 'notes.md'), {
      kind: 'revision-not-found',
    });
    assert.deepEqual(await read(first, 'nope.json'), {
      kind: 'path-not-found-at-revision',
    });
    assert.deepEqual(
      await read(first, 'notes.md/'),
      { kind: 'path-not-found-at-revision' },
      'a file asked for as a directory',
    );
    assert.deepEqual(await read(deleted, 'Author/jane.json'), {
      kind: 'path-deleted-at-revision',
    });
    assert.deepEqual(await read(deleted, 'Author/'), {
      kind: 'path-deleted-at-revision',
    });
    await assert.rejects(
      read(first, 'notes.md', { start: -1, length: 2 }),
      HistoryRequestError,
    );
  });

  test('readTreeAtRevision lists every file, with size-only entries flagged', async (assert) => {
    let first = await record([
      await put('Author/jane.json', '{"v":1}', 'A'),
      await put('notes.md', 'abc', 'A'),
      await grow('logs/big.log', 'x'.repeat(1500), 'A'),
    ]);
    let deleted = await record([await remove('notes.md')]);
    let logTree = await blobAt(first, 'logs/big.log');

    assert.deepEqual(await reader().readTreeAtRevision(realm.id, first), {
      kind: 'tree',
      files: [
        {
          path: 'Author/jane.json',
          id: await blobAt(first, 'Author/jane.json'),
          size: 7,
        },
        { path: 'logs/big.log', id: logTree, size: 1500, sizeOnly: true },
        { path: 'notes.md', id: await blobAt(first, 'notes.md'), size: 3 },
      ],
    });
    assert.deepEqual(
      await reader().readTreeAtRevision(realm.id, first, 'Author/'),
      {
        kind: 'tree',
        files: [
          {
            path: 'Author/jane.json',
            id: await blobAt(first, 'Author/jane.json'),
            size: 7,
          },
        ],
      },
    );
    assert.deepEqual(
      await reader().readTreeAtRevision(realm.id, first, 'logs/big.log'),
      {
        kind: 'tree',
        files: [
          { path: 'logs/big.log', id: logTree, size: 1500, sizeOnly: true },
        ],
      },
    );
    assert.deepEqual(
      await reader().readTreeAtRevision(realm.id, deleted, 'notes.md'),
      { kind: 'path-deleted-at-revision' },
    );
    assert.deepEqual(
      await reader().readTreeAtRevision(realm.id, deleted, 'Post/'),
      { kind: 'path-not-found-at-revision' },
    );
  });

  test('several path filters list the same revisions whether git uses Bloom filters with several paths or not', async (assert) => {
    await record([await put('Author/jane.json', '{"v":0}', 'A')]);
    for (let index = 0; index < 3; index++) {
      await record([await put(`Post/${index}.json`, `${index}`, 'A')]);
      await record([
        await put('notes.md', `${index}`, index === 0 ? 'A' : 'M'),
      ]);
      await record([
        await put('Author/jane.json', `{"v":${index + 1}}`),
        await put(`Post/${index}.json`, `${index}!`),
      ]);
    }
    await recordLagging([
      { changes: async () => [await put('Author/jane.json', '{"v":"alice"}')] },
      {
        changes: async () => [await put('Author/jane.json', '{"v":"ai"}')],
        fields: aiWrite('tool-call-1'),
      },
    ]);
    let paths = ['Author/', 'Post/1.json', 'Post/2.json'];
    let pagesOf = async (bloomWithSeveralPaths: boolean) => {
      let from = reader({ bloomWithSeveralPaths });
      let pages: History[] = [];
      let before: string | undefined;
      for (;;) {
        let page = await history({ paths, limit: 2, before }, from);
        pages.push(page);
        if (!page.hasMore) {
          break;
        }
        before = ids(page)[ids(page).length - 1];
      }
      return pages;
    };
    let together = await pagesOf(true);
    let apart = await pagesOf(false);
    assert.deepEqual(apart, together);
    // The first revision, the adds of Post/1 and Post/2, the three that
    // change Author/jane.json with a post, and the lagging pair.
    assert.strictEqual(
      together.flatMap(ids).length,
      8,
      'every revision under the filters, the superseded one included',
    );
  });

  test('a gap revision is marked as one', async (assert) => {
    let recorded = await record([await put('card.json', '{}', 'A')]);
    let store = new ObjectStore(gitDir);
    let { id: blob } = await store.writeBlob('{"v":"outside"}');
    let { id: tree } = await store.writeTree([
      { mode: '100644', name: 'card.json', id: blob },
    ]);
    let { id: gap } = await store.writeCommit({
      tree,
      parents: [recorded],
      author: authorIdentity(undefined, new Date(T0 + 120_000)),
      committer: committerIdentity(new Date(T0 + 120_000)),
      message: buildMessage('Unrecorded changes', {
        channel: ['system'],
        writeCount: ['0'],
        gap: ['true'],
      }),
    });
    await updateMain(gitDir, gap, recorded);

    let [latest, earlier] = (await history()).revisions;
    assert.strictEqual(latest.id, gap);
    assert.true(latest.gap);
    assert.strictEqual(latest.author, 'boxel-system');
    assert.deepEqual(latest.trailers['Boxel-Gap'], ['true']);
    assert.strictEqual(earlier.gap, undefined);
  });
});

module('reader: git processes', (hooks) => {
  let root: string;
  let historyRoot: string;
  let control: string;
  let realmId: string;
  let first: string;
  let previousControl: string | undefined;

  hooks.beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'realm-reader-processes-'));
    historyRoot = join(root, 'history');
    control = join(root, 'control');
    await mkdir(control);
    realmId = '11111111-1111-1111-1111-111111111111';
    let gitDir = repoPath(historyRoot, realmId);
    await initRepo(gitDir);
    let store = new ObjectStore(gitDir);
    let { id: blob } = await store.writeBlob('{}');
    let { id: tree } = await store.writeTree([
      { mode: '100644', name: 'card.json', id: blob },
    ]);
    let { id: commit } = await store.writeCommit({
      tree,
      parents: [],
      author: authorIdentity(ALICE, new Date(T0)),
      committer: committerIdentity(new Date(T0)),
      message: 'Add card.json\n',
    });
    await updateMain(gitDir, commit, undefined);
    first = commit;
    previousControl = process.env.READER_TEST_CONTROL;
    process.env.READER_TEST_CONTROL = control;
  });

  hooks.afterEach(async () => {
    if (previousControl === undefined) {
      delete process.env.READER_TEST_CONTROL;
    } else {
      process.env.READER_TEST_CONTROL = previousControl;
    }
    await rm(root, { recursive: true, force: true });
  });

  // A stand-in for git: it notes that it started, then hangs when the
  // control directory says so, or waits to be released and runs git.
  async function fakeGit(): Promise<string> {
    let script = join(root, 'fake-git');
    await writeFile(
      script,
      [
        '#!/bin/sh',
        'touch "$READER_TEST_CONTROL/started.$$"',
        'if [ -f "$READER_TEST_CONTROL/hang" ]; then exec sleep 600; fi',
        'while [ ! -f "$READER_TEST_CONTROL/release" ]; do sleep 0.02; done',
        'exec git "$@"',
        '',
      ].join('\n'),
      { mode: 0o755 },
    );
    return script;
  }

  async function started(): Promise<number[]> {
    return (await readdir(control))
      .filter((name) => name.startsWith('started.'))
      .map((name) => Number(name.slice('started.'.length)));
  }

  test('a ninth concurrent read waits for one of the eight git processes to finish', async (assert) => {
    let reader = new GitRealmHistoryReader({
      historyRoot,
      gitBinary: await fakeGit(),
    });
    let reads = Array.from({ length: 9 }, () =>
      reader.readHistory(realmId, { includeDiffs: false }),
    );
    await waitUntil(async () => (await started()).length >= 8, {
      what: 'eight git processes',
    });
    await sleep(300);
    assert.strictEqual((await started()).length, 8, 'the ninth waits');
    await writeFile(join(control, 'release'), '');
    let results = await Promise.all(reads);
    assert.true(
      results.every(
        (result) => result.kind === 'history' && result.revisions.length === 1,
      ),
      'every read completes once released',
    );
  });

  test('a hung git process is killed at the timeout', async (assert) => {
    await writeFile(join(control, 'hang'), '');
    let reader = new GitRealmHistoryReader({
      historyRoot,
      gitBinary: await fakeGit(),
      processTimeoutMs: 300,
    });
    let began = Date.now();
    await assert.rejects(reader.readHistory(realmId, {}), GitTimeoutError);
    assert.ok(Date.now() - began < 5000, 'the read fails at the timeout');
    let [pid] = await started();
    assert.throws(
      () => process.kill(pid, 0),
      /ESRCH/,
      'the git process is gone',
    );
  });

  test('a git failure while resolving a revision is an error, not revision-not-found', async (assert) => {
    let gitDir = repoPath(historyRoot, realmId);
    let store = new ObjectStore(gitDir);
    let tree = (await git(gitDir, 'rev-parse', `${first}^{tree}`)).trim();
    let { id: second } = await store.writeCommit({
      tree,
      parents: [first],
      author: authorIdentity(ALICE, new Date(T0 + 1000)),
      committer: committerIdentity(new Date(T0 + 1000)),
      message: 'Update card.json\n',
    });
    await updateMain(gitDir, second, first);
    let object = store.pathOf(first);
    await chmod(object, 0o644);
    await writeFile(object, 'not a git object');

    let reader = new GitRealmHistoryReader({ historyRoot });
    await assert.rejects(
      reader.readAtRevision(realmId, first, 'card.json'),
      GitCommandError,
    );
    await assert.rejects(
      reader.readHistory(realmId, { before: first }),
      GitCommandError,
    );
  });
});

module('reader: a realm without history', () => {
  test('answers history-unavailable to every read', async (assert) => {
    assert.deepEqual(await unavailableHistoryReader.readHistory('realm', {}), {
      kind: 'history-unavailable',
    });
    assert.deepEqual(
      await unavailableHistoryReader.readAtRevision(
        'realm',
        'abc1234',
        'card.json',
      ),
      { kind: 'history-unavailable' },
    );
    assert.deepEqual(
      await unavailableHistoryReader.readTreeAtRevision('realm', 'abc1234'),
      { kind: 'history-unavailable' },
    );
  });
});
