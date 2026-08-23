import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  ensureRepositoryMain,
  hashBytes,
  repositoryManifest,
  readTreeFromDir,
} from '@cardstack/deck/node';
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
  updateDeckBranchContent,
  type DeckBranchUpdateRequest,
} from '../lib/deck-branch-content-update.ts';
import { openDeckRepositoryProtocol } from '../lib/deck-repository-protocol.ts';
import { readDeckBranchIndex } from '../lib/deck-branch-index.ts';

const { module, test } = QUnit;
const realmRRI = '@cardstack/pretui/';
const policy = { enabled: true, realmRRIs: new Set([realmRRI]) };

class RecordingHistory implements HistoryBackend {
  readonly kind = 'deckd' as const;
  entries: Array<{ id: string; files: Map<string, Buffer> }> = [];

  noteMutation(): void {}
  async fork(): Promise<void> {}
  async flush(): Promise<string | undefined> {
    return undefined;
  }
  async seal(
    dir: string,
    _message: string,
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
    this.entries.push({ id, files });
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

module('Deck branch content updates', function (hooks) {
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
    let preparedView:
      | {
          indexGenerationHash: string;
          repositoryHash: string;
          treeHash: string;
          historyHead: string;
        }
      | undefined;
    let result = await updateDeckBranchContent({
      realmDir,
      realmRRI,
      branch: 'main',
      policy,
      history,
      request: await request('export const version = 2;\n'),
      prepareView: async (view) => {
        preparedView = view;
        let duringPreparation = await openDeckRepositoryProtocol({
          realmDir,
          realmRRI,
          policy,
        }).readBranch('main');
        assert.strictEqual(
          duringPreparation?.head.generation,
          1,
          'the old branch stays visible while its next exact view is prepared',
        );
        assert.strictEqual(
          await import('node:fs/promises').then(({ readFile }) =>
            readFile(join(realmDir, 'index.js'), 'utf8'),
          ),
          'export const version = 1;\n',
          'ordinary live readers retain the old bytes during preparation',
        );
      },
    });
    let after = await openDeckRepositoryProtocol({
      realmDir,
      realmRRI,
      policy,
    }).readBranch('main');

    assert.strictEqual(result.head.generation, 2);
    assert.deepEqual(
      preparedView,
      {
        indexGenerationHash: result.indexGenerationHash,
        repositoryHash: result.repositoryHash,
        treeHash: result.treeHash,
        historyHead: 'step2',
      },
      'the exact immutable identity is available before the ref advances',
    );
    assert.notStrictEqual(
      result.treeHash,
      before?.repository.members[realmRRI],
    );
    assert.strictEqual(after?.repository.members[realmRRI], result.treeHash);
    assert.strictEqual(after?.head.historyHead, 'step2');
    assert.strictEqual(after?.head.latestCheckpointHash, null);
    let index = await readDeckBranchIndex({
      realmDir,
      realmRRI,
      branch: 'main',
      policy,
    });
    assert.strictEqual(
      index.indexGenerationHash,
      after?.head.indexGenerationHash,
      'the ref exposes only the completed immutable index generation',
    );
    assert.strictEqual(index.view.historyHead, 'step2');
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

  test('a failed exact-view preparation leaves the branch ref and live tree unchanged', async function (assert) {
    let before = await openDeckRepositoryProtocol({
      realmDir,
      realmRRI,
      policy,
    }).readBranch('main');

    await assert.rejects(
      updateDeckBranchContent({
        realmDir,
        realmRRI,
        branch: 'main',
        policy,
        history,
        request: await request('export const version = 2;\n'),
        prepareView: async () => {
          throw new Error('exact view could not be prepared');
        },
      }),
      /exact view could not be prepared/,
    );

    let after = await openDeckRepositoryProtocol({
      realmDir,
      realmRRI,
      policy,
    }).readBranch('main');
    assert.strictEqual(after?.head.generation, before?.head.generation);
    assert.strictEqual(after?.head.repositoryHash, before?.head.repositoryHash);
    assert.strictEqual(
      await import('node:fs/promises').then(({ readFile }) =>
        readFile(join(realmDir, 'index.js'), 'utf8'),
      ),
      'export const version = 1;\n',
      'the materialized realm is restored when preparation fails',
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
