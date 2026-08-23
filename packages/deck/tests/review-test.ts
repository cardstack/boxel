import QUnit from 'qunit';
const { module, test } = QUnit;
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkpoint, repository } from '../src/repository.ts';
import { review, reviewEvent, reviewHash } from '../src/review.ts';
import {
  allocateConditionalReviewNumber,
  appendReviewEvent,
  createBranchReview,
  createConditionalReview,
  createReview,
  mergeReview,
  readReview,
  reviewRefPath,
} from '../src/review-store.ts';
import {
  ConditionalWriteConflictError,
  readBranchHead,
  readCheckpoint,
  storeCheckpoint,
  storeRepository,
  storeRepositoryLock,
  updateBranchHead,
  type ConditionalObjectStore,
} from '../src/repository-store.ts';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);

module('Repository Reviews', function (hooks) {
  let realmDir: string;

  hooks.beforeEach(async function () {
    realmDir = await mkdtemp(join(tmpdir(), 'deck-review-'));
  });

  hooks.afterEach(async function () {
    await rm(realmDir, { recursive: true, force: true });
  });

  test('Review binds exact base, target, and source Checkpoints', function (assert) {
    let value = review({
      base: {
        repository: '@acme/dashboard/',
        branch: 'main',
        checkpointHash: A,
      },
      target: {
        repository: '@acme/dashboard/',
        branch: 'main',
        checkpointHash: B,
      },
      source: {
        repository: '@acme/dashboard/',
        branch: 'compact-editor',
        checkpointHash: C,
      },
      title: 'Compact editor density',
      body: 'Changes editor and theme together.',
      author: { id: '@ana:example.test' },
      createdAt: '2026-08-20T00:00:00.000Z',
    });
    assert.strictEqual(value.schema, 'deck-review-v2');
    assert.ok(reviewHash(value));
    assert.throws(
      () =>
        review({
          ...value,
          source: { ...value.source, repository: 'https://example.test/fork/' },
        }),
      /URL-form identity/,
    );
  });

  test('Review and event chain round-trip below the realm .deck', async function (assert) {
    let opened = await createReview({
      realmDir,
      base: {
        repository: '@acme/dashboard/',
        branch: 'main',
        checkpointHash: A,
      },
      target: {
        repository: '@acme/dashboard/',
        branch: 'main',
        checkpointHash: B,
      },
      source: {
        repository: '@acme/dashboard/',
        branch: 'compact-editor',
        checkpointHash: C,
      },
      title: 'Compact editor density',
      author: { id: '@ana:example.test' },
      createdAt: '2026-08-20T00:00:00.000Z',
    });
    await appendReviewEvent({
      realmDir,
      number: opened.ref.number,
      type: 'reviewed',
      actor: { id: '@kim:example.test' },
      createdAt: '2026-08-20T00:01:00.000Z',
      checkpointHash: C,
      verdict: 'approved',
    });
    let stored = await readReview(realmDir, opened.ref.number);
    assert.strictEqual(stored?.review.title, 'Compact editor density');
    assert.strictEqual(stored?.events[0].verdict, 'approved');
    assert.strictEqual(
      reviewRefPath(realmDir, opened.ref.number),
      join(realmDir, '.deck', 'reviews', 'numbers', '1.json'),
    );
  });

  test('event validation speaks only Review and Checkpoint', function (assert) {
    assert.throws(
      () =>
        reviewEvent({
          reviewHash: A,
          type: 'reviewed',
          actor: { id: '@kim:example.test' },
          createdAt: '2026-08-20T00:01:00.000Z',
        }),
      /Checkpoint hash/,
    );
  });

  test('a branch Review derives its base from Checkpoint ancestry', async function (assert) {
    let lockHash = await storeRepositoryLock(realmDir, { imports: {} });
    let repositoryHash = await storeRepository(
      realmDir,
      repository({
        roots: ['@acme/dashboard/'],
        members: { '@acme/dashboard/': A },
        lockHash,
      }),
    );
    let point = (label: string, parents: string[] = []) =>
      storeCheckpoint(
        realmDir,
        checkpoint({
          repositoryHash,
          parents,
          historyHead: `history-${label}`,
          indexGenerationHash: B,
          author: { id: '@test:deck.test' },
          message: label,
          createdAt: '2026-08-20T00:00:00.000Z',
        }),
      );
    let forkBase = await point('fork-base');
    let target = await point('target-moved', [forkBase]);
    let sourceFork = await point('source-fork', [forkBase]);
    let source = await point('source-work', [sourceFork]);
    await updateBranchHead({
      realmDir,
      branch: 'main',
      expectedGeneration: null,
      next: {
        repositoryHash,
        historyHead: 'history-target-moved',
        indexGenerationHash: B,
        latestCheckpointHash: target,
      },
    });
    await updateBranchHead({
      realmDir,
      branch: 'mina/focus-ring',
      expectedGeneration: null,
      next: {
        repositoryHash,
        historyHead: 'history-source-work',
        indexGenerationHash: B,
        latestCheckpointHash: source,
      },
    });

    let opened = await createBranchReview({
      realmDir,
      repository: '@acme/dashboard/',
      sourceBranch: 'mina/focus-ring',
      targetBranch: 'main',
      title: 'Visible focus',
      author: { id: '@mina:deck.test' },
      createdAt: '2026-08-20T00:01:00.000Z',
    });

    assert.strictEqual(opened.review.base.checkpointHash, forkBase);
    assert.strictEqual(opened.review.target.checkpointHash, target);
    assert.strictEqual(opened.review.source.checkpointHash, source);
  });

  test('conditional Review creation uses immutable objects and conditional refs', async function (assert) {
    let values = new Map<string, { bytes: Buffer; etag: string }>();
    let writes: Array<{
      key: string;
      condition: { ifMatch?: string; ifNoneMatch?: '*' };
    }> = [];
    let counter = 0;
    let objects: ConditionalObjectStore = {
      async get(key) {
        return values.get(key);
      },
      async put(key, bytes, condition) {
        writes.push({ key, condition });
        if (condition.ifNoneMatch === '*' && values.has(key)) {
          throw new ConditionalWriteConflictError();
        }
        let value = { bytes, etag: `etag-${++counter}` };
        values.set(key, value);
        return { etag: value.etag };
      },
    };
    assert.strictEqual(
      await allocateConditionalReviewNumber({
        objects,
        key: '.deck/reviews/counter.json',
      }),
      1,
    );
    let created = await createConditionalReview({
      objects,
      prefix: '.deck',
      base: {
        repository: '@acme/dashboard/',
        branch: 'main',
        checkpointHash: A,
      },
      target: {
        repository: '@acme/dashboard/',
        branch: 'main',
        checkpointHash: B,
      },
      source: {
        repository: '@acme/dashboard/',
        branch: 'feature',
        checkpointHash: C,
      },
      title: 'Feature',
      author: { id: '@ana:example.test' },
      createdAt: '2026-08-20T00:00:00.000Z',
    });
    assert.strictEqual(created.ref.number, 2);
    assert.true(writes.some(({ key }) => key.includes('/reviews/objects/')));
    assert.true(
      writes.some(({ key }) => key.endsWith('/reviews/numbers/2.json')),
    );
  });

  test('a conflicted Review merge reports the conflict and writes no mutable state', async function (assert) {
    let [baseLock, targetLock, sourceLock] = await Promise.all([
      storeRepositoryLock(realmDir, { imports: {} }),
      storeRepositoryLock(realmDir, {
        imports: { theme: '@acme/theme@1.0.0/index.js' },
      }),
      storeRepositoryLock(realmDir, {
        imports: { theme: '@acme/theme@2.0.0/index.js' },
      }),
    ]);
    let storePoint = async (lockHash: string, label: string) => {
      let repositoryHash = await storeRepository(
        realmDir,
        repository({
          roots: ['@acme/dashboard/'],
          members: { '@acme/dashboard/': A },
          lockHash,
        }),
      );
      return storeCheckpoint(
        realmDir,
        checkpoint({
          repositoryHash,
          historyHead: `history-${label}`,
          indexGenerationHash: B,
          author: { id: '@test:deck.test' },
          message: label,
          createdAt: '2026-08-20T00:00:00.000Z',
        }),
      );
    };
    let base = await storePoint(baseLock, 'base');
    let target = await storePoint(targetLock, 'target');
    let source = await storePoint(sourceLock, 'source');
    let targetPoint = await readCheckpoint(realmDir, target);
    await updateBranchHead({
      realmDir,
      branch: 'main',
      expectedGeneration: null,
      next: {
        repositoryHash: targetPoint!.repositoryHash,
        historyHead: targetPoint!.historyHead,
        indexGenerationHash: targetPoint!.indexGenerationHash,
        latestCheckpointHash: target,
      },
    });
    await createReview({
      realmDir,
      base: {
        repository: '@acme/dashboard/',
        branch: 'main',
        checkpointHash: base,
      },
      target: {
        repository: '@acme/dashboard/',
        branch: 'main',
        checkpointHash: target,
      },
      source: {
        repository: '@acme/dashboard/',
        branch: 'feature',
        checkpointHash: source,
      },
      title: 'Conflicting lock update',
      author: { id: '@test:deck.test' },
      createdAt: '2026-08-20T00:01:00.000Z',
    });
    let beforeHead = await readBranchHead(realmDir, 'main');
    let beforeReview = await readReview(realmDir, 1);
    let result = await mergeReview({
      realmDir,
      number: 1,
      historyHead: 'history-merge',
      indexGenerationHash: C,
      actor: { id: '@merge:deck.test' },
      createdAt: '2026-08-20T00:02:00.000Z',
    });
    assert.strictEqual(result.state, 'conflicted');
    if (result.state === 'conflicted') {
      assert.deepEqual(result.conflicts, ['importmap.json']);
    }
    assert.deepEqual(await readBranchHead(realmDir, 'main'), beforeHead);
    assert.deepEqual(await readReview(realmDir, 1), beforeReview);
  });

  test('a pending Review merge rejects a stale target without moving it', async function (assert) {
    let lockHash = await storeRepositoryLock(realmDir, { imports: {} });
    let repositoryHash = await storeRepository(
      realmDir,
      repository({
        roots: ['@acme/dashboard/'],
        members: { '@acme/dashboard/': A },
        lockHash,
      }),
    );
    let point = async (label: string, parents: string[] = []) =>
      storeCheckpoint(
        realmDir,
        checkpoint({
          repositoryHash,
          parents,
          historyHead: `history-${label}`,
          indexGenerationHash: B,
          author: { id: '@test:deck.test' },
          message: label,
          createdAt: '2026-08-20T00:00:00.000Z',
        }),
      );
    let base = await point('base');
    let target = await point('target', [base]);
    let source = await point('source', [base]);
    let prepared = await point('prepared', [target, source]);
    let moved = await point('moved', [target]);
    await updateBranchHead({
      realmDir,
      branch: 'main',
      expectedGeneration: null,
      next: {
        repositoryHash,
        historyHead: 'history-target',
        indexGenerationHash: B,
        latestCheckpointHash: target,
      },
    });
    await createReview({
      realmDir,
      base: {
        repository: '@acme/dashboard/',
        branch: 'main',
        checkpointHash: base,
      },
      target: {
        repository: '@acme/dashboard/',
        branch: 'main',
        checkpointHash: target,
      },
      source: {
        repository: '@acme/dashboard/',
        branch: 'feature',
        checkpointHash: source,
      },
      title: 'Stale merge',
      author: { id: '@test:deck.test' },
      createdAt: '2026-08-20T00:01:00.000Z',
    });
    await appendReviewEvent({
      realmDir,
      number: 1,
      type: 'merge-started',
      actor: { id: '@merge:deck.test' },
      createdAt: '2026-08-20T00:02:00.000Z',
      checkpointHash: prepared,
    });
    let movedHead = await updateBranchHead({
      realmDir,
      branch: 'main',
      expectedGeneration: 1,
      next: {
        repositoryHash,
        historyHead: 'history-moved',
        indexGenerationHash: C,
        latestCheckpointHash: moved,
      },
    });
    await assert.rejects(
      mergeReview({
        realmDir,
        number: 1,
        historyHead: 'history-merge',
        indexGenerationHash: C,
        actor: { id: '@merge:deck.test' },
        createdAt: '2026-08-20T00:03:00.000Z',
      }),
      /target branch moved during a pending Review merge/,
    );
    assert.deepEqual(await readBranchHead(realmDir, 'main'), movedHead);
    assert.strictEqual((await readReview(realmDir, 1))?.ref.state, 'open');
  });
});
