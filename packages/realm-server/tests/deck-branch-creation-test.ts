import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  ensureRepositoryMain,
  hashBytes,
  readBranchHead,
  readCheckpoint,
  readTreeFromDir,
  repositoryManifest,
  writeTreeToDir,
} from '@cardstack/deck/node';
import type {
  HistoryActor,
  HistoryBackend,
  HistoryEntry,
  RestorePlan,
} from '@cardstack/deck-history/backend';
import QUnit from 'qunit';

import {
  createDeckBranch,
  DECK_BRANCH_CREATE_SPEC,
  listDeckBranches,
} from '../lib/deck-branch-creation.ts';
import { readDeckIndexGeneration } from '../lib/deck-branch-index.ts';
import { deckBranchWorkspaceDir } from '../lib/deck-branch-workspace.ts';

const { module, test } = QUnit;
const realmRRI = '@cardstack/pretui/';
const policy = { enabled: true, realmRRIs: new Set([realmRRI]) };

class BranchHistory implements HistoryBackend {
  readonly kind = 'deckd' as const;
  discarded: string[] = [];

  async fork(sourceDir: string, targetDir: string): Promise<void> {
    await writeTreeToDir(targetDir, await readTreeFromDir(sourceDir));
  }
  async discard(dir: string): Promise<void> {
    this.discarded.push(dir);
    await rm(dir, { recursive: true, force: true });
  }
  noteMutation(): void {}
  async flush(): Promise<string | undefined> {
    return undefined;
  }
  async seal(
    _dir: string,
    _message: string,
    _actor?: HistoryActor,
  ): Promise<string | undefined> {
    return undefined;
  }
  async merge(): Promise<string> {
    return 'merge-step';
  }
  async head(): Promise<string | undefined> {
    return 'step1';
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

module('Deck branch creation', function (hooks) {
  let realmDir: string;
  let history: BranchHistory;

  hooks.beforeEach(async function () {
    realmDir = await mkdtemp(join(tmpdir(), 'deck-branch-create-'));
    history = new BranchHistory();
    await writeFile(
      join(realmDir, 'package.json'),
      JSON.stringify({ name: '@cardstack/pretui', version: '0.4.0' }),
    );
    await writeFile(
      join(realmDir, 'importmap.json'),
      JSON.stringify({ imports: {} }),
    );
    await writeFile(
      join(realmDir, 'button.gts'),
      "export const tone = 'blue';\n",
    );
    await ensureRepositoryMain({
      realmDir,
      config: repositoryManifest({
        roots: [realmRRI],
        members: { [realmRRI]: '.' },
      }),
      author: { id: '@mina:boxel.test', name: 'Mina' },
      historyHead: 'step1',
      indexGenerationHash: hashBytes('index:main'),
    });
  });

  hooks.afterEach(async function () {
    await rm(realmDir, { recursive: true, force: true });
  });

  test('publishes a branch only after its workspace and exact view are ready', async function (assert) {
    let branchName = 'ana/button-tone';
    let branchDir = deckBranchWorkspaceDir(realmDir, branchName);
    let preparedHash: string | undefined;
    let result = await createDeckBranch({
      realmDir,
      realmRRI,
      policy,
      history,
      actor: { id: '@ana:boxel.test', name: 'Ana' },
      request: {
        schema: DECK_BRANCH_CREATE_SPEC,
        branchName,
        fromBranch: 'main',
      },
      prepareView: async ({ indexGenerationHash }) => {
        preparedHash = indexGenerationHash;
        assert.strictEqual(
          await readBranchHead(realmDir, branchName),
          undefined,
          'the ref is still hidden during view preparation',
        );
        assert.strictEqual(
          await readFile(join(branchDir, 'button.gts'), 'utf8'),
          "export const tone = 'blue';\n",
          'the exact source tree is already materialized',
        );
        assert.ok(
          await readDeckIndexGeneration(realmDir, indexGenerationHash),
          'the branch-qualified immutable index exists first',
        );
      },
    });

    assert.strictEqual(result.branch.head.generation, 1);
    assert.strictEqual(
      result.branch.head.repositoryHash,
      result.source.head.repositoryHash,
      'the immutable Repository is reused by hash',
    );
    assert.strictEqual(result.branch.head.historyHead, 'step1');
    assert.strictEqual(result.branch.head.indexGenerationHash, preparedHash);
    let branchCheckpoint = await readCheckpoint(
      realmDir,
      result.branch.head.latestCheckpointHash!,
    );
    assert.deepEqual(
      branchCheckpoint?.parents,
      [result.source.head.latestCheckpointHash],
      'the branch Checkpoint preserves the exact fork base',
    );
    assert.strictEqual(
      branchCheckpoint?.indexGenerationHash,
      result.branch.head.indexGenerationHash,
    );
    assert.notStrictEqual(
      result.branch.head.indexGenerationHash,
      result.source.head.indexGenerationHash,
      'branch identity produces a distinct Realm view generation',
    );
    assert.deepEqual(
      (await listDeckBranches({ realmDir, realmRRI, policy })).map(
        ({ branchName: name }) => name,
      ),
      ['ana/button-tone', 'main'],
    );
  });

  test('failed view preparation removes the hidden workspace and publishes no ref', async function (assert) {
    let branchName = 'kim/date-field';
    let branchDir = deckBranchWorkspaceDir(realmDir, branchName);
    await assert.rejects(
      createDeckBranch({
        realmDir,
        realmRRI,
        policy,
        history,
        actor: { id: '@kim:boxel.test', name: 'Kim' },
        request: {
          schema: DECK_BRANCH_CREATE_SPEC,
          branchName,
          fromBranch: 'main',
        },
        prepareView: async () => {
          throw new Error('preview failed');
        },
      }),
      /preview failed/,
    );
    assert.strictEqual(await readBranchHead(realmDir, branchName), undefined);
    assert.deepEqual(history.discarded, [branchDir]);
    await assert.rejects(readFile(join(branchDir, 'button.gts')), /ENOENT/);
  });
});
