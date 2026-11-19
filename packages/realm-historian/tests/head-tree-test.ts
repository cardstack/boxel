import QUnit from 'qunit';
const { module, test } = QUnit;
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BLOB_MODE,
  ObjectStore,
  TREE_MODE,
  TreeBuilder,
} from '../src/git-objects.ts';
import { EMPTY_TREE_ID, HeadTree, type FileEntry } from '../src/head-tree.ts';
import {
  authorIdentity,
  committerIdentity,
  initRepo,
  updateMain,
  writeSizeOnlyEntry,
} from '../src/repo-format.ts';
import { fsck } from './git-objects-test.ts';

module('head tree', (hooks) => {
  let root: string;
  let gitDir: string;
  let store: ObjectStore;
  let head: string | undefined;

  hooks.beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'realm-head-tree-'));
    gitDir = join(root, 'realm.git');
    await initRepo(gitDir);
    store = new ObjectStore(gitDir);
    head = undefined;
  });

  hooks.afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function blob(content: string): Promise<FileEntry> {
    return { mode: BLOB_MODE, id: (await store.writeBlob(content)).id };
  }

  // The root a full rewrite of `files` gives, to compare with an incremental
  // one.
  async function fullTree(files: Map<string, FileEntry>): Promise<string> {
    let builder = new TreeBuilder();
    for (let [path, entry] of files) {
      builder.set(path, entry);
    }
    return builder.size === 0
      ? (await store.writeTree([])).id
      : builder.write(store);
  }

  async function commitTree(tree: string): Promise<string> {
    let { id } = await store.writeCommit({
      tree,
      parents: head ? [head] : [],
      author: authorIdentity('@alice:localhost', new Date()),
      committer: committerIdentity(),
      message: 'Test\n',
    });
    await updateMain(gitDir, id, head);
    head = id;
    return id;
  }

  test('loads the files of a commit, with a size-only entry as a file', async (assert) => {
    let sizeOnly: FileEntry = {
      mode: TREE_MODE,
      id: await writeSizeOnlyEntry(store, {
        size: 9_000_000,
        fingerprint: 's1:x',
      }),
    };
    let files = new Map<string, FileEntry>([
      ['a/b/c.json', await blob('c')],
      ['a/d.json', await blob('d')],
      ['e.json', await blob('e')],
      ['logs/big.jsonl', sizeOnly],
    ]);
    let root = await fullTree(files);
    let tree = await HeadTree.load(gitDir, await commitTree(root));
    assert.strictEqual(tree.root, root);
    assert.deepEqual([...tree.files.keys()].sort(), [
      'a/b/c.json',
      'a/d.json',
      'e.json',
      'logs/big.jsonl',
    ]);
    assert.deepEqual(tree.entry('logs/big.jsonl'), sizeOnly);
    assert.strictEqual(typeof tree.marker('logs/big.jsonl'), 'string');
    assert.strictEqual(tree.marker('e.json'), undefined);
  });

  test('applying changes writes the same trees a full rewrite does, and leaves the snapshot as it was', async (assert) => {
    let files = new Map<string, FileEntry>([
      ['a/b/c.json', await blob('c')],
      ['a/d.json', await blob('d')],
      ['e.json', await blob('e')],
    ]);
    let before = await HeadTree.load(
      gitDir,
      await commitTree(await fullTree(files)),
    );
    let changes = new Map<string, FileEntry | null>([
      ['a/b/c.json', null],
      ['a/x/y.json', await blob('y')],
      ['e.json', await blob('e2')],
      ['missing.json', null],
    ]);
    let after = await before.apply(store, changes);
    let expected = new Map(files);
    expected.delete('a/b/c.json');
    expected.set('a/x/y.json', changes.get('a/x/y.json')!);
    expected.set('e.json', changes.get('e.json')!);
    assert.strictEqual(after.root, await fullTree(expected));
    assert.deepEqual(
      [...after.files.keys()].sort(),
      [...expected.keys()].sort(),
    );
    assert.strictEqual(
      before.root,
      await fullTree(files),
      'the snapshot is unchanged',
    );
    assert.true(before.files.has('a/b/c.json'));
    await commitTree(after.root);
    assert.strictEqual(await fsck(gitDir), '');
  });

  test('a directory emptied by the changes is removed, and a file may take its name', async (assert) => {
    let files = new Map<string, FileEntry>([
      ['a/b/c.json', await blob('c')],
      ['a/d.json', await blob('d')],
      ['keep.json', await blob('k')],
    ]);
    let before = await HeadTree.load(
      gitDir,
      await commitTree(await fullTree(files)),
    );
    let file = await blob('a file now');
    let after = await before.apply(
      store,
      new Map<string, FileEntry | null>([
        ['a/b/c.json', null],
        ['a/d.json', null],
        ['a', file],
      ]),
    );
    assert.strictEqual(
      after.root,
      await fullTree(
        new Map([
          ['keep.json', files.get('keep.json')!],
          ['a', file],
        ]),
      ),
    );
    let emptied = await after.apply(
      store,
      new Map<string, FileEntry | null>([
        ['a', null],
        ['keep.json', null],
      ]),
    );
    assert.strictEqual(emptied.root, EMPTY_TREE_ID);
    assert.strictEqual(emptied.files.size, 0);
  });

  test('a path under a file, or a file over a directory with files, is refused', async (assert) => {
    let tree = await HeadTree.empty().apply(
      store,
      new Map<string, FileEntry | null>([
        ['file.json', await blob('f')],
        ['dir/inner.json', await blob('i')],
      ]),
    );
    await assert.rejects(
      tree.apply(store, new Map([['file.json/under.json', await blob('u')]])),
      /lies under the file/,
    );
    await assert.rejects(
      tree.apply(store, new Map([['dir', await blob('d')]])),
      /is a directory/,
    );
  });
});
