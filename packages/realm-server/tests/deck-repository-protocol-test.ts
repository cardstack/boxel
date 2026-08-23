import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  captureRepositoryCheckpoint,
  createBranchReview,
  createRepositoryBranch,
  ensureRepositoryMain,
  readBranchHead,
  repositoryManifest,
  writeRepositoryConfig,
} from '@cardstack/deck/node';
import QUnit from 'qunit';

import {
  DeckCollaborationUnavailableError,
  DeckProtocolIntegrityError,
  openDeckRepositoryProtocol,
} from '../lib/deck-repository-protocol.ts';

const { module, test } = QUnit;
const pretuiRRI = '@cardstack/pretui/';

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

module('Deck Repository protocol adapter', function (hooks) {
  let realmDir: string;
  let policy = {
    enabled: true,
    realmRRIs: new Set([pretuiRRI]),
  };

  hooks.beforeEach(async function () {
    realmDir = await mkdtemp(join(tmpdir(), 'deck-repository-protocol-'));
    await writeFile(
      join(realmDir, 'package.json'),
      JSON.stringify({ name: '@cardstack/pretui', version: '0.5.0' }),
    );
    await writeFile(
      join(realmDir, 'importmap.json'),
      JSON.stringify({
        imports: { '@cardstack/base': '@cardstack/base@1.0.0/' },
      }),
    );
    await writeFile(
      join(realmDir, 'index.js'),
      'export const density = "comfortable";\n',
    );
    let config = repositoryManifest({
      roots: [pretuiRRI],
      members: { [pretuiRRI]: '.' },
    });
    await writeRepositoryConfig(realmDir, config);
    await ensureRepositoryMain({
      realmDir,
      config,
      author: { id: '@mina:boxel.test', name: 'Mina' },
      historyHead: 'history:main',
      indexGenerationHash: hash('index:main'),
    });
    await createRepositoryBranch({
      realmDir,
      branch: 'ana/known-date-fields',
    });
    await writeFile(
      join(realmDir, 'index.js'),
      'export const density = "compact";\n',
    );
    await captureRepositoryCheckpoint({
      realmDir,
      config,
      branch: 'ana/known-date-fields',
      author: { id: '@ana:boxel.test', name: 'Ana' },
      message: 'Make Known Date compact',
      createdAt: '2026-08-24T10:00:00.000Z',
      historyHead: 'history:known-date',
      indexGenerationHash: hash('index:known-date'),
    });
    await createBranchReview({
      realmDir,
      repository: pretuiRRI,
      sourceBranch: 'ana/known-date-fields',
      targetBranch: 'main',
      title: 'Make Known Date compact',
      author: { id: '@ana:boxel.test', name: 'Ana' },
      createdAt: '2026-08-24T11:00:00.000Z',
    });
  });

  hooks.afterEach(async function () {
    await rm(realmDir, { recursive: true, force: true });
  });

  test('is inert unless both the operator flag and exact realm RRI allow it', function (assert) {
    assert.throws(
      () =>
        openDeckRepositoryProtocol({
          realmDir,
          realmRRI: pretuiRRI,
          policy: { enabled: false, realmRRIs: new Set([pretuiRRI]) },
        }),
      DeckCollaborationUnavailableError,
    );
    assert.throws(
      () =>
        openDeckRepositoryProtocol({
          realmDir,
          realmRRI: pretuiRRI,
          policy: {
            enabled: true,
            realmRRIs: new Set(['@cardstack/other/']),
          },
        }),
      DeckCollaborationUnavailableError,
    );
  });

  test('round-trips exact PretUI branches, Checkpoints, Reviews, and merge inputs', async function (assert) {
    let protocol = openDeckRepositoryProtocol({
      realmDir,
      realmRRI: pretuiRRI,
      policy,
    });
    let branch = await protocol.readBranch('ana/known-date-fields');
    let review = await protocol.readReview(1);
    let preview = await protocol.previewReview(1);
    if (!branch?.checkpoint)
      throw new Error('missing fixture branch Checkpoint');
    let recorded = await protocol.recordVersionOrigin({
      versionRRI: '@cardstack/pretui@0.5.0/',
      checkpointHash: branch.head.latestCheckpointHash!,
      treeHash: branch.repository.members[pretuiRRI],
      indexHash: branch.checkpoint.indexGenerationHash,
    });
    let origin = await protocol.readVersionOrigin('@cardstack/pretui@0.5.0/');

    assert.strictEqual(protocol.realmRRI, pretuiRRI);
    assert.strictEqual(branch?.repository.roots[0], pretuiRRI);
    assert.strictEqual(
      branch?.checkpoint?.repositoryHash,
      branch?.head.repositoryHash,
    );
    assert.strictEqual(
      review?.stored.review.source.branch,
      'ana/known-date-fields',
    );
    assert.strictEqual(review?.base.ref.repository, pretuiRRI);
    assert.strictEqual(review?.target.ref.repository, pretuiRRI);
    assert.strictEqual(review?.source.ref.repository, pretuiRRI);
    assert.strictEqual(preview.state, 'ready');
    assert.deepEqual(preview.state === 'ready' ? preview.changedMembers : [], [
      pretuiRRI,
    ]);
    assert.deepEqual(origin, recorded, 'the exact Version origin round-trips');
    assert.strictEqual(
      origin?.checkpointHash,
      branch.head.latestCheckpointHash,
      'the Version is pinned to its exact source Checkpoint',
    );
  });

  test('rejects a branch whose content-addressed Repository is missing', async function (assert) {
    let protocol = openDeckRepositoryProtocol({
      realmDir,
      realmRRI: pretuiRRI,
      policy,
    });
    let head = await readBranchHead(realmDir, 'main');
    if (!head) throw new Error('missing fixture main branch');
    await rm(
      join(
        realmDir,
        '.deck',
        'store',
        '_repositories',
        head.repositoryHash.slice(0, 2),
        `${head.repositoryHash}.json`,
      ),
    );

    await assert.rejects(
      protocol.readBranch('main'),
      DeckProtocolIntegrityError,
      'the adapter fails closed instead of returning a partial branch',
    );
  });
});
