import QUnit from 'qunit';
const { module, test } = QUnit;
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  canonicalJson,
  changedMembers,
  checkpoint,
  checkpointHash,
  repository,
  repositoryHash,
  repositoryManifest,
  type JsonValue,
} from '../src/repository.ts';
import {
  RefConflictError,
  branchHeadPath,
  readBranchHead,
  readCheckpoint,
  readRepository,
  readRepositoryLock,
  realmDeckPath,
  storeCheckpoint,
  storeRepository,
  storeRepositoryLock,
  updateBranchHead,
  updateConditionalBranchHead,
  type ConditionalObjectStore,
} from '../src/repository-store.ts';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);

module('RRI-native collaboration objects', function (hooks) {
  let realmDir: string;

  hooks.beforeEach(async function () {
    realmDir = await mkdtemp(join(tmpdir(), 'deck-repository-'));
  });

  hooks.afterEach(async function () {
    await rm(realmDir, { recursive: true, force: true });
  });

  test('Repository identity is canonical across RRI input ordering', function (assert) {
    let first = repository({
      roots: ['@app/dashboard/'],
      members: { '@acme/theme/': B, '@app/dashboard/': A },
      lockHash: C,
    });
    let second = repository({
      roots: ['@app/dashboard/'],
      members: { '@app/dashboard/': A, '@acme/theme/': B },
      lockHash: C,
    });
    assert.strictEqual(repositoryHash(first), repositoryHash(second));
    assert.deepEqual(Object.keys(first.members), ['@acme/theme/', '@app/dashboard/']);
  });

  test('the manifest keeps RRI identity separate from authoring paths', function (assert) {
    assert.deepEqual(
      repositoryManifest({
        roots: ['@app/dashboard/'],
        members: {
          '@app/dashboard/': 'app/dashboard',
          '@acme/theme/': 'packages/theme',
          '@acme/editor/': 'packages/editor',
        },
      }),
      {
        schema: 'deck-repository-manifest-v2',
        roots: ['@app/dashboard/'],
        members: {
          '@acme/editor/': 'packages/editor',
          '@acme/theme/': 'packages/theme',
          '@app/dashboard/': 'app/dashboard',
        },
      },
    );
    assert.throws(
      () => repositoryManifest({ roots: ['@app/dashboard/'], members: { 'app/dashboard': 'app/dashboard' } }),
      /invalid Deck RRI/,
    );
    assert.throws(
      () => repositoryManifest({ roots: ['https://example.test/app/'], members: { '@app/dashboard/': 'app/dashboard' } }),
      /URL-form identity/,
    );
  });

  test('a Checkpoint binds Repository, History, index, and ordered parents', function (assert) {
    let value = checkpoint({
      repositoryHash: A,
      parents: [B, C],
      historyHead: 'qvnrkqpmsxt',
      indexGenerationHash: C,
      author: { id: '@chris:example.test', name: 'Chris' },
      message: 'Merge editor and theme changes',
      createdAt: '2026-08-20T00:00:00.000Z',
    });
    assert.deepEqual(value.parents, [B, C]);
    assert.notStrictEqual(checkpointHash(value), checkpointHash({ ...value, parents: [C, B] }));
  });

  test('lock, Repository, and Checkpoint round-trip below one realm .deck', async function (assert) {
    let lock: JsonValue = {
      imports: { editor: '@catalog/editor@1.0.0/index.js' },
      scopes: {},
    };
    let lockHash = await storeRepositoryLock(realmDir, lock);
    let value = repository({
      roots: ['@app/dashboard/'],
      members: { '@app/dashboard/': A, '@acme/editor/': B },
      lockHash,
    });
    let repositoryHash = await storeRepository(realmDir, value);
    let point = checkpoint({
      repositoryHash,
      historyHead: 'history-change-1',
      indexGenerationHash: C,
      author: { id: '@agent:example.test' },
      message: 'Initial Repository',
      createdAt: '2026-08-20T00:00:00.000Z',
    });
    let pointHash = await storeCheckpoint(realmDir, point);

    assert.deepEqual(await readRepositoryLock(realmDir, lockHash), lock);
    assert.deepEqual(await readRepository(realmDir, repositoryHash), value);
    assert.deepEqual(await readCheckpoint(realmDir, pointHash), point);
    let path = realmDeckPath(
      realmDir,
      'store',
      '_repositories',
      repositoryHash.slice(0, 2),
      `${repositoryHash}.json`,
    );
    assert.strictEqual(
      await readFile(path, 'utf8'),
      canonicalJson(value as unknown as JsonValue).toString('utf8'),
    );
    assert.true(path.startsWith(join(realmDir, '.deck')));
  });

  test('one Repository atomically changes several independently addressed members', function (assert) {
    let before = repository({
      roots: ['@app/dashboard/'],
      members: { '@app/dashboard/': A, '@acme/editor/': A, '@acme/theme/': A },
      lockHash: C,
    });
    let after = repository({
      roots: ['@app/dashboard/'],
      members: { '@app/dashboard/': B, '@acme/editor/': C, '@acme/theme/': A },
      lockHash: C,
    });
    assert.deepEqual(changedMembers(before, after), ['@acme/editor/', '@app/dashboard/']);
  });

  test('a normal Step advances branch state without creating a new Checkpoint', async function (assert) {
    let created = await updateBranchHead({
      realmDir,
      branch: 'main',
      expectedGeneration: null,
      next: {
        repositoryHash: A,
        historyHead: 'history-1',
        indexGenerationHash: B,
        latestCheckpointHash: C,
      },
    });
    assert.strictEqual(created.generation, 1);
    let advanced = await updateBranchHead({
      realmDir,
      branch: 'main',
      expectedGeneration: 1,
      next: {
        repositoryHash: B,
        historyHead: 'history-2',
        indexGenerationHash: A,
        latestCheckpointHash: C,
      },
    });
    assert.strictEqual(advanced.latestCheckpointHash, C, 'the daily save did not invent a Checkpoint');
    assert.strictEqual(advanced.generation, 2);
    assert.strictEqual((await readBranchHead(realmDir, 'main'))?.repositoryHash, B);
    assert.strictEqual(branchHeadPath(realmDir, 'main'), join(realmDir, '.deck', 'refs', 'heads', 'main.json'));
    await assert.rejects(
      updateBranchHead({
        realmDir,
        branch: 'main',
        expectedGeneration: 1,
        next: { ...advanced, repositoryHash: A },
      }),
      RefConflictError,
    );
  });

  test('S3-style branch updates use the observed ETag', async function (assert) {
    let object: { bytes: Buffer; etag: string } | undefined;
    let condition: { ifMatch?: string; ifNoneMatch?: '*' } | undefined;
    let objects: ConditionalObjectStore = {
      async get() {
        return object;
      },
      async put(_key, bytes, nextCondition) {
        condition = nextCondition;
        object = { bytes, etag: 'etag-2' };
        return { etag: object.etag };
      },
    };
    let state = {
      repositoryHash: A,
      historyHead: 'history-1',
      indexGenerationHash: B,
      latestCheckpointHash: C,
    };
    await updateConditionalBranchHead({ objects, key: '.deck/refs/heads/main.json', expectedGeneration: null, next: state });
    assert.deepEqual(condition, { ifNoneMatch: '*' });
    object!.etag = 'etag-1';
    await updateConditionalBranchHead({ objects, key: '.deck/refs/heads/main.json', expectedGeneration: 1, next: { ...state, repositoryHash: B } });
    assert.deepEqual(condition, { ifMatch: 'etag-1' });
  });
});
