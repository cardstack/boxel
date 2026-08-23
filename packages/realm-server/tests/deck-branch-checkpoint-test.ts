import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  ensureRepositoryMain,
  hashBytes,
  readBranchHead,
  readCheckpoint,
  readRepository,
  repositoryManifest,
} from '@cardstack/deck/node';
import QUnit from 'qunit';

import {
  createDeckBranchCheckpoint,
  DECK_CHECKPOINT_CREATE_SPEC,
  DeckCheckpointConflictError,
} from '../lib/deck-branch-checkpoint.ts';

const { module, test } = QUnit;
const realmRRI = '@cardstack/pretui/';
const policy = { enabled: true, realmRRIs: new Set([realmRRI]) };

module('Deck branch Checkpoints', function (hooks) {
  let realmDir: string;

  hooks.beforeEach(async function () {
    realmDir = await mkdtemp(join(tmpdir(), 'deck-checkpoint-'));
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
      author: { id: '@fixture:boxel.test' },
      historyHead: 'jj:main',
      indexGenerationHash: hashBytes('index:main'),
    });
  });

  hooks.afterEach(async function () {
    await rm(realmDir, { recursive: true, force: true });
  });

  test('freezes an exact branch head and advances only its ref', async function (assert) {
    let before = (await readBranchHead(realmDir, 'main'))!;
    let repository = (await readRepository(realmDir, before.repositoryHash))!;
    let created = await createDeckBranchCheckpoint({
      realmDir,
      realmRRI,
      branch: 'main',
      policy,
      actor: { id: '@mina:boxel.test', name: 'Mina' },
      createdAt: '2026-08-23T14:00:00.000Z',
      request: {
        schema: DECK_CHECKPOINT_CREATE_SPEC,
        message: 'Focus ring candidate',
        expected: {
          repositoryHash: before.repositoryHash,
          treeHash: repository.members[realmRRI],
          lockHash: repository.lockHash,
          refGeneration: before.generation,
        },
      },
    });

    let after = (await readBranchHead(realmDir, 'main'))!;
    let checkpoint = await readCheckpoint(realmDir, created.checkpointHash);
    assert.strictEqual(after.generation, before.generation + 1);
    assert.strictEqual(after.repositoryHash, before.repositoryHash);
    assert.strictEqual(after.historyHead, before.historyHead);
    assert.strictEqual(after.indexGenerationHash, before.indexGenerationHash);
    assert.strictEqual(after.latestCheckpointHash, created.checkpointHash);
    assert.deepEqual(checkpoint?.parents, [before.latestCheckpointHash]);
    assert.strictEqual(checkpoint?.message, 'Focus ring candidate');
  });

  test('rejects a stale observed branch without moving it', async function (assert) {
    let before = (await readBranchHead(realmDir, 'main'))!;
    await assert.rejects(
      createDeckBranchCheckpoint({
        realmDir,
        realmRRI,
        branch: 'main',
        policy,
        actor: { id: '@mina:boxel.test' },
        request: {
          schema: DECK_CHECKPOINT_CREATE_SPEC,
          message: 'Stale candidate',
          expected: {
            repositoryHash: before.repositoryHash,
            treeHash: hashBytes('wrong tree'),
            lockHash: hashBytes('wrong lock'),
            refGeneration: before.generation,
          },
        },
      }),
      DeckCheckpointConflictError,
    );
    assert.deepEqual(await readBranchHead(realmDir, 'main'), before);
  });
});
