import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  captureRepositoryCheckpoint,
  createRepositoryBranch,
  ensureRepositoryMain,
  repositoryManifest,
  updateBranchHead,
} from '@cardstack/deck/node';
import QUnit from 'qunit';

import {
  buildDeckBranchIndex,
  queryDeckBranchIndex,
  readDeckBranchIndex,
} from '../lib/deck-branch-index.ts';
import { openDeckRepositoryProtocol } from '../lib/deck-repository-protocol.ts';

const { module, test } = QUnit;
const realmRRI = '@cardstack/pretui/';
const policy = { enabled: true, realmRRIs: new Set([realmRRI]) };
const config = repositoryManifest({
  roots: [realmRRI],
  members: { [realmRRI]: '.' },
});

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function card(title: string): string {
  return JSON.stringify({
    data: {
      type: 'card',
      attributes: { title },
    },
  });
}

module('Deck branch index generations', function (hooks) {
  let realmDir: string;

  hooks.beforeEach(async function () {
    realmDir = await mkdtemp(join(tmpdir(), 'deck-branch-index-'));
    await writeFile(
      join(realmDir, 'package.json'),
      JSON.stringify({ name: '@cardstack/pretui', version: '0.5.0' }),
    );
    await writeFile(
      join(realmDir, 'importmap.json'),
      JSON.stringify({ imports: {} }),
    );
    await writeFile(join(realmDir, 'status.json'), card('Comfortable Status'));
    await ensureRepositoryMain({
      realmDir,
      config,
      author: { id: '@mina:boxel.test', name: 'Mina' },
      historyHead: 'step-main',
      indexGenerationHash: hash('pending-main'),
    });
  });

  hooks.afterEach(async function () {
    await rm(realmDir, { recursive: true, force: true });
  });

  async function completeIndex(branchName: string): Promise<string> {
    let protocol = openDeckRepositoryProtocol({
      realmDir,
      realmRRI,
      policy,
    });
    let branch = await protocol.readBranch(branchName);
    if (!branch) throw new Error(`missing ${branchName}`);
    let generation = await buildDeckBranchIndex({
      realmDir,
      branch,
      historyHead: branch.head.historyHead,
      repositoryHash: branch.head.repositoryHash,
      treeHash: branch.repository.members[realmRRI],
      lockHash: branch.repository.lockHash,
    });
    await updateBranchHead({
      realmDir,
      branch: branchName,
      expectedGeneration: branch.head.generation,
      next: {
        repositoryHash: branch.head.repositoryHash,
        historyHead: branch.head.historyHead,
        indexGenerationHash: generation.indexGenerationHash,
        latestCheckpointHash: null,
      },
    });
    return generation.indexGenerationHash;
  }

  test('the same realm RRI answers from two exact hidden views', async function (assert) {
    let mainIndex = await completeIndex('main');
    await createRepositoryBranch({
      realmDir,
      branch: 'ana/compact-status',
    });
    await writeFile(join(realmDir, 'status.json'), card('Compact Status'));
    await captureRepositoryCheckpoint({
      realmDir,
      config,
      branch: 'ana/compact-status',
      author: { id: '@ana:boxel.test', name: 'Ana' },
      message: 'Make Status compact',
      historyHead: 'step-ana',
      indexGenerationHash: hash('pending-ana'),
    });
    let compactIndex = await completeIndex('ana/compact-status');

    let main = await readDeckBranchIndex({
      realmDir,
      realmRRI,
      branch: 'main',
      policy,
    });
    let compact = await readDeckBranchIndex({
      realmDir,
      realmRRI,
      branch: 'ana/compact-status',
      policy,
    });

    assert.notStrictEqual(mainIndex, compactIndex);
    assert.strictEqual(main.view.realmRRI, compact.view.realmRRI);
    assert.strictEqual(main.view.branch, 'main');
    assert.strictEqual(compact.view.branch, 'ana/compact-status');
    assert.strictEqual(
      queryDeckBranchIndex(main, 'comfortable')[0]?.rri,
      '@cardstack/pretui/status',
    );
    assert.strictEqual(queryDeckBranchIndex(main, 'compact').length, 0);
    assert.strictEqual(
      queryDeckBranchIndex(compact, 'compact')[0]?.rri,
      '@cardstack/pretui/status',
    );
    assert.strictEqual(queryDeckBranchIndex(compact, 'comfortable').length, 0);
  });
});
