import QUnit from 'qunit';
const { module, test } = QUnit;
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BLOB_MODE, ObjectStore, TREE_MODE } from '../src/git-objects.ts';
import {
  authorIdentity,
  buildMessage,
  commonDirectory,
  committerIdentity,
  formatTrailers,
  initRepo,
  parseSizeOnlyMarker,
  parseTrailers,
  readMain,
  repoPath,
  revisionMessage,
  sizeOnlyMarker,
  updateMain,
  writeSizeOnlyEntry,
  SIZE_ONLY_MARKER_NAME,
} from '../src/repo-format.ts';
import { fsck, git } from './git-objects-test.ts';

module('repo format', (hooks) => {
  let historyRoot: string;
  let gitDir: string;
  let store: ObjectStore;

  hooks.beforeEach(async () => {
    historyRoot = await mkdtemp(join(tmpdir(), 'realm-history-'));
    gitDir = repoPath(historyRoot, '0b7c3a1e-6d2f-4a5b-9c8d-1e2f3a4b5c6d');
    await initRepo(gitDir);
    store = new ObjectStore(gitDir);
  });

  hooks.afterEach(async () => {
    await rm(historyRoot, { recursive: true, force: true });
  });

  async function commit(message: string, parent?: string) {
    let { id: blob } = await store.writeBlob(message);
    let { id: tree } = await store.writeTree([
      { mode: BLOB_MODE, name: 'card.json', id: blob },
    ]);
    let { id } = await store.writeCommit({
      tree,
      parents: parent ? [parent] : [],
      author: authorIdentity('@user:localhost', '2026-11-04T10:00:00Z'),
      committer: committerIdentity(new Date('2026-11-04T10:00:05Z')),
      message,
    });
    return id;
  }

  test('a new repo is bare, with HEAD on main and no commit', async (assert) => {
    assert.strictEqual(
      gitDir,
      join(historyRoot, '0b7c3a1e-6d2f-4a5b-9c8d-1e2f3a4b5c6d.git'),
    );
    assert.strictEqual(
      (await git(gitDir, 'rev-parse', '--is-bare-repository')).trim(),
      'true',
    );
    assert.strictEqual(
      (await git(gitDir, 'symbolic-ref', 'HEAD')).trim(),
      'refs/heads/main',
    );
    assert.strictEqual(await readMain(gitDir), undefined);
    await initRepo(gitDir);
    assert.strictEqual(await fsck(gitDir), '', 'a second init changes nothing');
  });

  test('main moves only from the commit it is expected to be at', async (assert) => {
    let first = await commit('first');
    let second = await commit('second', first);
    await updateMain(gitDir, first, undefined);
    assert.strictEqual(await readMain(gitDir), first);
    await assert.rejects(
      updateMain(gitDir, second, undefined),
      /reference already exists/,
      'an expectation of no commit is refused once there is one',
    );
    assert.strictEqual(await readMain(gitDir), first);
    await updateMain(gitDir, second, first);
    assert.strictEqual(await readMain(gitDir), second);
    await assert.rejects(
      updateMain(gitDir, first, first),
      /is at [0-9a-f]{40} but expected [0-9a-f]{40}/,
      'an expectation of a commit main has moved past is refused',
    );
    assert.strictEqual(await readMain(gitDir), second);
    assert.strictEqual(
      await git(gitDir, 'log', '--format=%s', 'refs/heads/main'),
      'second\nfirst\n',
    );
    await git(gitDir, 'pack-refs', '--all');
    assert.strictEqual(
      await readMain(gitDir),
      second,
      'a packed ref is read too',
    );
    await updateMain(gitDir, first, second);
    assert.strictEqual(await readMain(gitDir), first);
    assert.strictEqual(await fsck(gitDir), '');
  });

  test('the author is the Matrix id or boxel-system, the committer realm-historian', (assert) => {
    let at = Math.floor(Date.parse('2026-11-04T10:00:00Z') / 1000);
    assert.deepEqual(
      authorIdentity('@user:localhost', '2026-11-04T10:00:00Z'),
      {
        name: '@user:localhost',
        email: '@user:localhost',
        timestamp: at,
      },
    );
    assert.deepEqual(authorIdentity(undefined, new Date(at * 1000 + 500)), {
      name: 'boxel-system',
      email: 'boxel-system',
      timestamp: at,
    });
    assert.deepEqual(committerIdentity(new Date('2026-11-04T10:00:05Z')), {
      name: 'realm-historian',
      email: 'realm-historian',
      timestamp: at + 5,
    });
    assert.throws(() => authorIdentity('@user:localhost', 'not a time'));
  });

  module('messages', () => {
    let changes = (
      ...entries: [string, 'A' | 'M' | 'D'][]
    ): {
      kind: 'changes';
      changes: { path: string; status: 'A' | 'M' | 'D' }[];
    } => ({
      kind: 'changes',
      changes: entries.map(([path, status]) => ({ path, status })),
    });

    test('one updated file', (assert) => {
      assert.strictEqual(
        revisionMessage({ subject: changes(['Author/jane.json', 'M']) }),
        'Update Author/jane.json',
      );
      assert.strictEqual(
        revisionMessage({ subject: changes(['Author/jane.json', 'A']) }),
        'Add Author/jane.json',
      );
      assert.strictEqual(
        revisionMessage({ subject: changes(['Author/jane.json', 'D']) }),
        'Delete Author/jane.json',
      );
    });

    test('several files with one status', (assert) => {
      assert.strictEqual(
        revisionMessage({
          subject: changes(
            ['Author/jane.json', 'M'],
            ['Author/joe.json', 'M'],
            ['Author/sub/jim.json', 'M'],
          ),
        }),
        'Update 3 files in Author/',
      );
      assert.strictEqual(
        revisionMessage({
          subject: changes(['Author/jane.json', 'A'], ['index.json', 'A']),
        }),
        'Add 2 files',
        'paths with no common directory name none',
      );
    });

    test('mixed statuses', (assert) => {
      assert.strictEqual(
        revisionMessage({
          subject: changes(
            ['Author/new.json', 'A'],
            ['Author/jane.json', 'M'],
            ['Author/joe.json', 'M'],
            ['Author/old.json', 'D'],
          ),
        }),
        'Add 1 file, update 2 and delete 1 in Author/',
      );
      assert.strictEqual(
        revisionMessage({
          subject: changes(['Author/jane.json', 'M'], ['Author/old.json', 'D']),
        }),
        'Update 1 file and delete 1 in Author/',
      );
    });

    test('revert, deploy, initial snapshot and unattributed changes', (assert) => {
      assert.strictEqual(
        revisionMessage({
          subject: {
            kind: 'revert',
            path: 'Author/',
            revision: '1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b',
          },
        }),
        'Revert Author/ to 1a2b3c4',
      );
      assert.strictEqual(
        revisionMessage({
          subject: {
            kind: 'deploy',
            source: 'cardstack/boxel',
            commit: 'abc1234',
          },
        }),
        'Deploy cardstack/boxel@abc1234',
      );
      assert.strictEqual(
        revisionMessage({ subject: { kind: 'initial-snapshot' } }),
        'Initial snapshot',
      );
      assert.strictEqual(
        revisionMessage({ subject: { kind: 'unattributed' } }),
        'Unattributed changes',
      );
      assert.strictEqual(
        revisionMessage({ subject: { kind: 'unattributed-external' } }),
        'Unattributed external changes',
      );
    });

    test('the write count and content-not-kept suffixes', (assert) => {
      assert.strictEqual(
        revisionMessage({
          subject: changes(['Author/jane.json', 'M']),
          writeCount: 4,
        }),
        'Update Author/jane.json (4 writes)',
      );
      assert.strictEqual(
        revisionMessage({
          subject: changes(['Author/jane.json', 'M']),
          contentNotKept: true,
        }),
        'Update Author/jane.json (content not kept)',
      );
      assert.strictEqual(
        revisionMessage({
          subject: changes(['Author/jane.json', 'M']),
          writeCount: 2,
          contentNotKept: true,
        }),
        'Update Author/jane.json (2 writes) (content not kept)',
      );
    });

    test('a subject needs a change', (assert) => {
      assert.throws(
        () => revisionMessage({ subject: changes() }),
        /at least one change/,
      );
    });

    test('the common directory', (assert) => {
      assert.strictEqual(commonDirectory(['a/b/c.json', 'a/b/d.json']), 'a/b/');
      assert.strictEqual(commonDirectory(['a/b/c.json', 'a/d.json']), 'a/');
      assert.strictEqual(commonDirectory(['a/b/c.json', 'ab/d.json']), '');
      assert.strictEqual(commonDirectory(['c.json', 'd.json']), '');
      assert.strictEqual(commonDirectory(['a/c.json']), 'a/');
    });
  });

  test('trailers round-trip through git, multi-valued ones included', async (assert) => {
    let trailers = {
      channel: ['ai-assistant'],
      correlationIds: ['call-1', 'call-2'],
      agent: ['@aibot:localhost'],
      room: ['!room:localhost'],
      writeCount: ['3'],
      firstWriteAt: ['2026-11-04T09:59:00.000Z'],
      superseded: ['Author/jane.json', 'Author/joe.json'],
      journalSeq: ['41-43'],
    };
    let message = buildMessage(
      'Update 2 files in Author/ (3 writes)',
      trailers,
    );
    assert.strictEqual(
      message,
      [
        'Update 2 files in Author/ (3 writes)',
        '',
        'Boxel-Channel: ai-assistant',
        'Boxel-Correlation-Ids: call-1',
        'Boxel-Correlation-Ids: call-2',
        'Boxel-Agent: @aibot:localhost',
        'Boxel-Room: !room:localhost',
        'Boxel-Write-Count: 3',
        'Boxel-First-Write-At: 2026-11-04T09:59:00.000Z',
        'Boxel-Superseded: Author/jane.json',
        'Boxel-Superseded: Author/joe.json',
        'Boxel-Journal-Seq: 41-43',
        '',
      ].join('\n'),
    );
    let id = await commit(message);
    await updateMain(gitDir, id, undefined);
    let fromGit = await git(
      gitDir,
      'log',
      '-1',
      '--format=%(trailers)',
      'refs/heads/main',
    );
    assert.strictEqual(fromGit.trim(), formatTrailers(trailers));
    assert.deepEqual(parseTrailers(message), trailers);
    assert.deepEqual(
      parseTrailers(
        await git(gitDir, 'log', '-1', '--format=%B', 'refs/heads/main'),
      ),
      trailers,
      "git's own rendering of the message parses the same",
    );
    assert.strictEqual(
      (
        await git(
          gitDir,
          'log',
          '-1',
          '--format=%(trailers:key=Boxel-Superseded,valueonly)',
          'refs/heads/main',
        )
      ).trim(),
      'Author/jane.json\nAuthor/joe.json',
    );
  });

  test('a trailer value may hold a line separator or a carriage return', (assert) => {
    let trailers = {
      channel: ['api'],
      superseded: ['Author/odd\u2028name.json', 'Author/odd\u2029name.json'],
      journalSeq: ['7\r8'],
    };
    assert.deepEqual(
      parseTrailers(buildMessage('Update 2 files in Author/', trailers)),
      trailers,
    );
  });

  test('a message without a trailer block has no trailers', (assert) => {
    assert.strictEqual(
      buildMessage('Initial snapshot', {}),
      'Initial snapshot\n',
    );
    assert.deepEqual(parseTrailers('Initial snapshot\n'), {});
    assert.deepEqual(
      parseTrailers(
        'Update x\n\nSome prose: not a trailer, this has words\nmore\n',
      ),
      {},
      'a last paragraph with a non-trailer line is prose',
    );
    assert.deepEqual(
      parseTrailers('Update x\n\nSigned-off-by: someone\nBoxel-Channel: api\n'),
      { channel: ['api'] },
      'unknown trailers are left out',
    );
  });

  test('a size-only entry is a tree holding the marker, which parses back', async (assert) => {
    let entry = { size: 7_340_032, fingerprint: 's1-7340032-abc-def' };
    let sizeOnly = await writeSizeOnlyEntry(store, entry);
    let { id: blob } = await store.writeBlob('{}');
    let { id: tree } = await store.writeTree([
      { mode: BLOB_MODE, name: 'card.json', id: blob },
      { mode: TREE_MODE, name: 'events.log', id: sizeOnly },
    ]);
    assert.strictEqual(
      await git(gitDir, 'ls-tree', tree),
      `100644 blob ${blob}\tcard.json\n040000 tree ${sizeOnly}\tevents.log\n`,
      'the entry appears as a tree under the file name',
    );
    let listing = await git(gitDir, 'ls-tree', sizeOnly);
    assert.true(listing.includes(`\t${SIZE_ONLY_MARKER_NAME}\n`));
    let markerId = listing.split(' ')[2].split('\t')[0];
    let marker = await git(gitDir, 'cat-file', '-p', markerId);
    assert.strictEqual(marker, sizeOnlyMarker(entry));
    assert.strictEqual(
      marker,
      'realm-history-size-only 1\nsize 7340032\nfingerprint s1-7340032-abc-def\n',
    );
    assert.deepEqual(parseSizeOnlyMarker(marker), entry);
    assert.strictEqual(parseSizeOnlyMarker('{}'), undefined);
    assert.strictEqual(
      parseSizeOnlyMarker('realm-history-size-only 2\nsize 1\nfingerprint x\n'),
      undefined,
      'another version is not this shape',
    );
    assert.strictEqual(await fsck(gitDir), '');
  });
});
