import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  ensureRepositoryMain,
  hashBytes,
  repositoryManifest,
} from '@cardstack/deck/node';
import QUnit from 'qunit';

import {
  DECK_BRANCH_UPDATE_SPEC,
  DeckBranchContentConflictError,
  updateDeckBranchContent,
  type DeckBranchUpdateRequest,
} from '../lib/deck-branch-content-update.ts';
import { openDeckRepositoryProtocol } from '../lib/deck-repository-protocol.ts';

const { module, test } = QUnit;
const realmRRI = '@cardstack/pretui/';
const policy = { enabled: true, realmRRIs: new Set([realmRRI]) };

module('Deck branch content updates', function (hooks) {
  let realmDir: string;

  hooks.beforeEach(async function () {
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
    assert.strictEqual(after?.head.historyHead, 'jj:main');
    assert.strictEqual(after?.head.latestCheckpointHash, null);
    assert.strictEqual(
      await import('node:fs/promises').then(({ readFile }) =>
        readFile(join(realmDir, 'index.js'), 'utf8'),
      ),
      'export const version = 1;\n',
      'publishing a branch tree does not overwrite the live realm projection',
    );
  });

  test('a stale writer changes neither the ref nor the live tree', async function (assert) {
    let stale = await request('export const version = "stale";\n');
    await updateDeckBranchContent({
      realmDir,
      realmRRI,
      branch: 'main',
      policy,
      request: await request('export const version = 2;\n'),
    });
    await assert.rejects(
      updateDeckBranchContent({
        realmDir,
        realmRRI,
        branch: 'main',
        policy,
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
        request: writerA,
      }),
      updateDeckBranchContent({
        realmDir,
        realmRRI,
        branch: 'main',
        policy,
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
