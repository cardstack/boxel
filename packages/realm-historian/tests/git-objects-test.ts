import QUnit from 'qunit';
const { module, test } = QUnit;
import { execFile, execFileSync } from 'node:child_process';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  BLOB_MODE,
  ObjectStore,
  TREE_MODE,
  TreeBuilder,
  hashObject,
  blobBody,
  treeBody,
  type TreeEntry,
} from '../src/git-objects.ts';
import { initRepo } from '../src/repo-format.ts';
import { sleep } from './helpers.ts';

const execFileAsync = promisify(execFile);

export async function git(gitDir: string, ...args: string[]): Promise<string> {
  let { stdout } = await execFileAsync('git', [`--git-dir=${gitDir}`, ...args]);
  return stdout;
}

export async function fsck(gitDir: string): Promise<string> {
  let { stdout, stderr } = await execFileAsync('git', [
    `--git-dir=${gitDir}`,
    'fsck',
    '--strict',
    '--no-dangling',
  ]);
  // A repo with no ref yet draws a notice, which is not a finding.
  return `${stdout}${stderr}`
    .split('\n')
    .filter((line) => line && !line.startsWith('notice:'))
    .join('\n');
}

module('git objects', (hooks) => {
  let gitDir: string;
  let store: ObjectStore;

  hooks.beforeEach(async () => {
    gitDir = join(await mkdtemp(join(tmpdir(), 'realm-history-')), 'realm.git');
    await initRepo(gitDir);
    store = new ObjectStore(gitDir);
  });

  hooks.afterEach(async () => {
    await rm(join(gitDir, '..'), { recursive: true, force: true });
  });

  test('a blob is hashed and read back as git does', async (assert) => {
    let { id, written } = await store.writeBlob('hello\n');
    assert.true(written);
    assert.strictEqual(
      id,
      'ce013625030ba8dba906f756967f9e9ca394464a',
      "git's own id for 'hello\\n'",
    );
    assert.strictEqual(hashObject('blob', blobBody('hello\n')), id);
    assert.strictEqual(await git(gitDir, 'cat-file', '-t', id), 'blob\n');
    assert.strictEqual(await git(gitDir, 'cat-file', '-p', id), 'hello\n');
    assert.strictEqual(await fsck(gitDir), '');
  });

  test('binary content survives the round trip', async (assert) => {
    let bytes = new Uint8Array(4096);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = (i * 31) % 256;
    }
    let { id } = await store.writeBlob(bytes);
    let { stdout } = await execFileAsync(
      'git',
      [`--git-dir=${gitDir}`, 'cat-file', '-p', id],
      { encoding: 'buffer' },
    );
    assert.deepEqual(new Uint8Array(stdout), bytes);
    assert.strictEqual(await fsck(gitDir), '');
  });

  test('a tree lists its entries in git order, subtrees as if named with a slash', async (assert) => {
    let { id: blob } = await store.writeBlob('x');
    let { id: sub } = await store.writeTree([
      { mode: BLOB_MODE, name: 'inner.json', id: blob },
    ]);
    // The last two names sort by their UTF-8 bytes: `（` (U+FF08, three
    // bytes starting 0xEF) comes before `😀` (U+1F600, four bytes starting
    // 0xF0), though as UTF-16 the emoji's surrogate pair sorts first.
    let entries: TreeEntry[] = [
      { mode: BLOB_MODE, name: 'b.json', id: blob },
      { mode: TREE_MODE, name: 'a', id: sub },
      { mode: BLOB_MODE, name: 'a.json', id: blob },
      { mode: BLOB_MODE, name: 'a-1', id: blob },
      { mode: BLOB_MODE, name: '😀.json', id: blob },
      { mode: BLOB_MODE, name: '（memo）.json', id: blob },
    ];
    let { id: tree } = await store.writeTree(entries);
    assert.strictEqual(
      await git(gitDir, '-c', 'core.quotePath=false', 'ls-tree', tree),
      [
        `100644 blob ${blob}\ta-1`,
        `100644 blob ${blob}\ta.json`,
        `040000 tree ${sub}\ta`,
        `100644 blob ${blob}\tb.json`,
        `100644 blob ${blob}\t（memo）.json`,
        `100644 blob ${blob}\t😀.json`,
        '',
      ].join('\n'),
    );
    assert.strictEqual(await fsck(gitDir), '');
    let fromGit = execFileSync('git', [`--git-dir=${gitDir}`, 'mktree'], {
      encoding: 'utf8',
      input: entries
        .map(
          (entry) =>
            `${entry.mode.padStart(6, '0')} ${entry.mode === TREE_MODE ? 'tree' : 'blob'} ${entry.id}\t${entry.name}\n`,
        )
        .join(''),
    });
    assert.strictEqual(fromGit.trim(), tree, "the id is git's own");
  });

  test('a commit is read back with its tree, parents, identities and message', async (assert) => {
    let { id: blob } = await store.writeBlob('{}');
    let { id: tree } = await store.writeTree([
      { mode: BLOB_MODE, name: 'card.json', id: blob },
    ]);
    let { id: first } = await store.writeCommit({
      tree,
      parents: [],
      author: {
        name: '@user:localhost',
        email: '@user:localhost',
        timestamp: 1_700_000_000,
      },
      committer: {
        name: 'realm-historian',
        email: 'realm-historian',
        timestamp: 1_700_000_010,
      },
      message: 'Add card.json\n\nBoxel-Channel: api\n',
    });
    let { id: second } = await store.writeCommit({
      tree,
      parents: [first],
      author: {
        name: '@user:localhost',
        email: '@user:localhost',
        timestamp: 1_700_000_020,
      },
      committer: {
        name: 'realm-historian',
        email: 'realm-historian',
        timestamp: 1_700_000_030,
      },
      message: 'Update card.json',
    });
    assert.strictEqual(
      await git(gitDir, 'cat-file', '-p', second),
      [
        `tree ${tree}`,
        `parent ${first}`,
        'author @user:localhost <@user:localhost> 1700000020 +0000',
        'committer realm-historian <realm-historian> 1700000030 +0000',
        '',
        'Update card.json',
        '',
      ].join('\n'),
    );
    await git(gitDir, 'update-ref', 'refs/heads/main', second);
    assert.strictEqual(
      await git(
        gitDir,
        'log',
        '--format=%H %an <%ae> %at %cn %ct %s',
        'refs/heads/main',
      ),
      [
        `${second} @user:localhost <@user:localhost> 1700000020 realm-historian 1700000030 Update card.json`,
        `${first} @user:localhost <@user:localhost> 1700000000 realm-historian 1700000010 Add card.json`,
        '',
      ].join('\n'),
    );
    assert.strictEqual(await fsck(gitDir), '');
  });

  test('an object that exists is not written again, and its time is refreshed', async (assert) => {
    let { id, written } = await store.writeBlob('same bytes');
    assert.true(written);
    let before = await stat(store.pathOf(id));
    await sleep(20);
    let again = await store.writeBlob('same bytes');
    assert.strictEqual(again.id, id);
    assert.false(again.written);
    let after = await stat(store.pathOf(id));
    assert.strictEqual(after.ino, before.ino, 'the file is not replaced');
    assert.true(
      after.mtimeMs > before.mtimeMs,
      "its modification time is refreshed, which git prune's expiry reads",
    );
    assert.strictEqual(after.mode & 0o777, 0o444, 'objects are read-only');
  });

  test('names git refuses are refused', async (assert) => {
    let { id: blob } = await store.writeBlob('x');
    let { id: sub } = await store.writeTree([]);
    for (let name of ['', '.', '..', '.git', '.GIT', 'a/b', 'a\0b']) {
      assert.throws(
        () => treeBody([{ mode: BLOB_MODE, name, id: blob }]),
        /invalid tree entry name/,
        JSON.stringify(name),
      );
    }
    assert.throws(
      () =>
        treeBody([
          { mode: BLOB_MODE, name: 'Author', id: blob },
          { mode: TREE_MODE, name: 'Author', id: sub },
        ]),
      /invalid tree entry name "Author"/,
      'a file and a directory of one name',
    );
    let builder = new TreeBuilder();
    builder.set('Author/jane.json', { mode: BLOB_MODE, id: blob });
    assert.throws(
      () => builder.set('Author', { mode: BLOB_MODE, id: blob }),
      /collides with the entry at "Author\/jane.json"/,
    );
    assert.throws(
      () => builder.set('Author/jane.json/x', { mode: BLOB_MODE, id: blob }),
      /collides with the entry at "Author\/jane.json"/,
    );
  });

  test('a tree builder writes nested trees from flat paths', async (assert) => {
    let { id: blob } = await store.writeBlob('content');
    let builder = new TreeBuilder();
    builder.set('Author/jane.json', { mode: BLOB_MODE, id: blob });
    builder.set('Author/joe.json', { mode: BLOB_MODE, id: blob });
    builder.set('index.json', { mode: BLOB_MODE, id: blob });
    builder.set('deep/er/file.txt', { mode: BLOB_MODE, id: blob });
    builder.delete('deep/er/file.txt');
    let root = await builder.write(store);
    assert.strictEqual(
      await git(gitDir, 'ls-tree', '-r', '--name-only', root),
      'Author/jane.json\nAuthor/joe.json\nindex.json\n',
    );
    assert.strictEqual(await fsck(gitDir), '');
  });
});
