import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import {
  ensureRepositoryMain,
  hashBytes,
  repositoryManifest,
  readTreeFromDir,
  writeRepositoryConfig,
} from '@cardstack/deck/node';
import { readTree } from '@cardstack/deck/object-store';
import type {
  HistoryActor,
  HistoryBackend,
  HistoryEntry,
  RestorePlan,
} from '@cardstack/deck-history/backend';
import QUnit from 'qunit';

import {
  DECK_BRANCH_UPDATE_SPEC,
  DeckBranchContentConflictError,
  DeckBranchPathConflictError,
  commitHostSaves,
  updateDeckBranchContent,
  type DeckBranchUpdateOperation,
  type DeckBranchUpdateRequest,
} from '../lib/deck-branch-content-update.ts';
import { openDeckRepositoryProtocol } from '../lib/deck-repository-protocol.ts';

const { module, test } = QUnit;
const realmRRI = '@cardstack/pretui/';
const policy = { enabled: true, realmRRIs: new Set([realmRRI]) };

class RecordingHistory implements HistoryBackend {
  readonly kind = 'deckd' as const;
  entries: Array<{ id: string; files: Map<string, Buffer>; message: string }> =
    [];
  pending = new Set<string>();

  noteMutation(_dir: string, path: string): void {
    this.pending.add(path);
  }
  async flush(dir: string): Promise<string | undefined> {
    if (this.pending.size === 0) {
      return undefined;
    }
    let message = `save: ${[...this.pending].join(', ')}`;
    this.pending.clear();
    return this.seal(dir, message);
  }
  async seal(
    dir: string,
    message: string,
    _actor?: HistoryActor,
  ): Promise<string | undefined> {
    let files = await readTreeFromDir(dir);
    let prior = this.entries.at(-1)?.files;
    if (
      prior &&
      prior.size === files.size &&
      [...files].every(([path, bytes]) => prior.get(path)?.equals(bytes))
    ) {
      return undefined;
    }
    let id = `step${this.entries.length + 1}`;
    this.entries.push({ id, files, message });
    return id;
  }
  async head(): Promise<string | undefined> {
    return this.entries.at(-1)?.id;
  }
  async list(): Promise<HistoryEntry[]> {
    return [];
  }
  async fileAt(): Promise<Buffer | undefined> {
    return undefined;
  }
  async fileListAt(): Promise<string[]> {
    return [];
  }
  async restorePlan(): Promise<RestorePlan> {
    return { writes: [], deletes: [] };
  }
  close(): void {}
}

module(basename(import.meta.filename), function (hooks) {
  let realmDir: string;
  let history: RecordingHistory;

  hooks.beforeEach(async function () {
    history = new RecordingHistory();
    realmDir = await mkdtemp(join(tmpdir(), 'deck-branch-content-'));
    await writeFile(
      join(realmDir, 'package.json'),
      JSON.stringify({ name: '@cardstack/pretui', version: '1.0.0' }),
    );
    await writeFile(
      join(realmDir, 'importmap.json'),
      JSON.stringify({ imports: {} }),
    );
    await writeFile(join(realmDir, 'index.js'), 'export const version = 1;\n');
    await ensureRepositoryMain({
      realmDir,
      config: repositoryManifest({
        roots: [realmRRI],
        members: { [realmRRI]: '.' },
      }),
      author: { id: '@mina:boxel.test', name: 'Mina' },
      historyHead: 'jj:main',
      indexGenerationHash: hashBytes('index:main'),
    });
  });

  hooks.afterEach(async function () {
    await rm(realmDir, { recursive: true, force: true });
  });

  async function request(content: string): Promise<DeckBranchUpdateRequest> {
    let branch = await openDeckRepositoryProtocol({
      realmDir,
      realmRRI,
      policy,
    }).readBranch('main');
    if (!branch) throw new Error('missing main');
    let treeHash = branch.repository.members[realmRRI];
    return {
      schema: DECK_BRANCH_UPDATE_SPEC,
      message: 'save: index.js',
      expected: {
        repositoryHash: branch.head.repositoryHash,
        treeHash,
        lockHash: branch.repository.lockHash,
        refGeneration: branch.head.generation,
      },
      operations: [
        {
          path: 'index.js',
          sha256: hashBytes(content),
          contentBase64: Buffer.from(content).toString('base64'),
        },
      ],
    };
  }

  test('publishes a new immutable tree with one conditional ref advance', async function (assert) {
    let before = await openDeckRepositoryProtocol({
      realmDir,
      realmRRI,
      policy,
    }).readBranch('main');
    let result = await updateDeckBranchContent({
      realmDir,
      realmRRI,
      branch: 'main',
      policy,
      history,
      request: await request('export const version = 2;\n'),
    });
    let after = await openDeckRepositoryProtocol({
      realmDir,
      realmRRI,
      policy,
    }).readBranch('main');

    assert.strictEqual(result.head.generation, 2);
    assert.notStrictEqual(
      result.treeHash,
      before?.repository.members[realmRRI],
    );
    assert.strictEqual(after?.repository.members[realmRRI], result.treeHash);
    assert.strictEqual(after?.head.historyHead, 'step2');
    assert.strictEqual(after?.head.latestCheckpointHash, null);
    assert.strictEqual(
      await import('node:fs/promises').then(({ readFile }) =>
        readFile(join(realmDir, 'index.js'), 'utf8'),
      ),
      'export const version = 2;\n',
      'main materializes the exact accepted tree before its History Step',
    );
    assert.strictEqual(history.entries.length, 2);
    assert.strictEqual(
      history.entries[0].files.get('index.js')?.toString(),
      'export const version = 1;\n',
      'the first write adopts the state being left as a History baseline',
    );
  });

  test('host saves waiting out the debounce are committed before a branch update', async function (assert) {
    await writeFile(join(realmDir, 'notes.md'), 'from the host\n');
    await push(
      [
        perFile(
          'index.js',
          'export const version = 2;\n',
          hashBytes('export const version = 1;\n'),
        ),
      ],
      () => 'save: notes.md',
    );
    assert.deepEqual(
      history.entries.map((entry) => entry.message),
      ['save: notes.md', 'sync'],
      'the host save is its own Step, ahead of the branch update',
    );
    assert.strictEqual(
      await readFile(join(realmDir, 'notes.md'), 'utf8'),
      'from the host\n',
      'the branch update applies on top of the host save, never over it',
    );
    let main = await openDeckRepositoryProtocol({
      realmDir,
      realmRRI,
      policy,
    }).readBranch('main');
    let tree = await readTree(
      join(realmDir, '.deck', 'store'),
      main!.repository.members[realmRRI],
    );
    assert.true(
      tree!.entries.some((entry) => entry.path === 'notes.md'),
      'main holds the host save',
    );
  });

  test('a debounced host commit moves main to the live files', async function (assert) {
    await writeFile(join(realmDir, 'notes.md'), 'from the host\n');
    await commitHostSaves({
      realmDir,
      realmRRI,
      policy,
      history,
      message: 'save: notes.md',
    });
    let main = await openDeckRepositoryProtocol({
      realmDir,
      realmRRI,
      policy,
    }).readBranch('main');
    assert.strictEqual(main!.head.generation, 2);
    assert.strictEqual(main!.head.historyHead, 'step1');
    let tree = await readTree(
      join(realmDir, '.deck', 'store'),
      main!.repository.members[realmRRI],
    );
    assert.true(tree!.entries.some((entry) => entry.path === 'notes.md'));
  });

  function perFile(
    path: string,
    content: string | null,
    base: string | null,
  ): DeckBranchUpdateOperation {
    return content === null
      ? { path, sha256: null, base }
      : {
          path,
          sha256: hashBytes(content),
          contentBase64: Buffer.from(content).toString('base64'),
          base,
        };
  }

  async function push(
    operations: DeckBranchUpdateOperation[],
    takePendingHostSaves?: () => string,
  ) {
    return updateDeckBranchContent({
      realmDir,
      realmRRI,
      branch: 'main',
      policy,
      history,
      takePendingHostSaves,
      request: {
        schema: DECK_BRANCH_UPDATE_SPEC,
        message: 'sync',
        // Per-file updates do not depend on the whole branch being unmoved.
        expected: {
          repositoryHash: '',
          treeHash: '',
          lockHash: '',
          refGeneration: 0,
        },
        operations,
      },
    });
  }

  test("per-file sync keeps another writer's change to a different file", async function (assert) {
    let v1 = hashBytes('export const version = 1;\n');
    await push([perFile('index.js', 'export const version = 2;\n', v1)]);
    // A second writer, still based on the first sync, adds a different file.
    await push([perFile('other.js', 'export const other = 1;\n', null)]);
    assert.strictEqual(
      await readFile(join(realmDir, 'index.js'), 'utf8'),
      'export const version = 2;\n',
    );
    assert.strictEqual(
      await readFile(join(realmDir, 'other.js'), 'utf8'),
      'export const other = 1;\n',
    );
  });

  test('per-file sync reports only the files changed on both sides', async function (assert) {
    let v1 = hashBytes('export const version = 1;\n');
    await push([perFile('index.js', 'export const version = 2;\n', v1)]);
    try {
      await push([
        perFile('index.js', 'export const version = 3;\n', v1),
        perFile('other.js', 'export const other = 1;\n', null),
      ]);
      assert.ok(false, 'expected a conflict');
    } catch (error) {
      assert.true(error instanceof DeckBranchPathConflictError);
      assert.deepEqual((error as DeckBranchPathConflictError).paths, [
        'index.js',
      ]);
    }
    assert.strictEqual(
      await readFile(join(realmDir, 'index.js'), 'utf8'),
      'export const version = 2;\n',
      'nothing is written when any file conflicts',
    );
    assert.false(
      await readFile(join(realmDir, 'other.js'), 'utf8').then(
        () => true,
        () => false,
      ),
    );
  });

  test('per-file sync onto a host save of a different file keeps both', async function (assert) {
    await writeFile(join(realmDir, 'notes.md'), 'from the host\n');
    let v1 = hashBytes('export const version = 1;\n');
    await push([perFile('index.js', 'export const version = 2;\n', v1)]);
    assert.strictEqual(
      await readFile(join(realmDir, 'notes.md'), 'utf8'),
      'from the host\n',
    );
  });

  test('a whole-branch writer that read before a host save must read again', async function (assert) {
    let stale = await request('export const version = 2;\n');
    await writeFile(join(realmDir, 'notes.md'), 'from the host\n');
    await assert.rejects(
      updateDeckBranchContent({
        realmDir,
        realmRRI,
        branch: 'main',
        policy,
        history,
        request: stale,
      }),
      DeckBranchContentConflictError,
    );
  });

  test('advances every package the realm hosts with the branch', async function (assert) {
    let buttonRRI = '@cardstack/pretui-button/';
    let buttonPackage = JSON.stringify({
      name: '@cardstack/pretui-button',
      version: '1.0.0',
    });
    await mkdir(join(realmDir, 'button'));
    await writeFile(join(realmDir, 'button', 'package.json'), buttonPackage);
    await writeRepositoryConfig(
      realmDir,
      repositoryManifest({
        roots: [realmRRI],
        members: { [realmRRI]: '.', [buttonRRI]: 'button' },
      }),
    );
    // The package's files written into the realm are a host save; the sync
    // that follows names its bases per file.
    await push([
      perFile(
        'index.js',
        'export const version = 2;\n',
        hashBytes('export const version = 1;\n'),
      ),
      perFile('button/package.json', buttonPackage, null),
      perFile('button/index.js', 'export const size = 2;\n', null),
    ]);
    let after = await openDeckRepositoryProtocol({
      realmDir,
      realmRRI,
      policy,
    }).readBranch('main');
    let buttonTree = await readTree(
      join(realmDir, '.deck', 'store'),
      after!.repository.members[buttonRRI],
    );
    assert.deepEqual(
      buttonTree?.entries.map(({ path }) => path).sort(),
      ['index.js', 'package.json'],
      "the hosted package's tree is the subtree at its authoring path",
    );
    assert.notStrictEqual(
      after!.repository.members[realmRRI],
      after!.repository.members[buttonRRI],
    );
  });

  test('a stale writer changes neither the ref nor the live tree', async function (assert) {
    let stale = await request('export const version = "stale";\n');
    await updateDeckBranchContent({
      realmDir,
      realmRRI,
      branch: 'main',
      policy,
      history,
      request: await request('export const version = 2;\n'),
    });
    await assert.rejects(
      updateDeckBranchContent({
        realmDir,
        realmRRI,
        branch: 'main',
        policy,
        history,
        request: stale,
      }),
      DeckBranchContentConflictError,
    );
    let after = await openDeckRepositoryProtocol({
      realmDir,
      realmRRI,
      policy,
    }).readBranch('main');
    assert.strictEqual(after?.head.generation, 2);
  });

  test('only one concurrent writer advances the branch', async function (assert) {
    let [writerA, writerB] = await Promise.all([
      request('export const author = "mina";\n'),
      request('export const author = "kim";\n'),
    ]);
    let results = await Promise.allSettled([
      updateDeckBranchContent({
        realmDir,
        realmRRI,
        branch: 'main',
        policy,
        history,
        request: writerA,
      }),
      updateDeckBranchContent({
        realmDir,
        realmRRI,
        branch: 'main',
        policy,
        history,
        request: writerB,
      }),
    ]);

    assert.strictEqual(
      results.filter(({ status }) => status === 'fulfilled').length,
      1,
    );
    assert.strictEqual(
      results.filter(({ status }) => status === 'rejected').length,
      1,
    );
    let after = await openDeckRepositoryProtocol({
      realmDir,
      realmRRI,
      policy,
    }).readBranch('main');
    assert.strictEqual(after?.head.generation, 2);
  });
});
