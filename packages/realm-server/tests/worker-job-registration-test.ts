import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import {
  Worker,
  INDEX_JOB_TYPES,
  type QueueRunner,
} from '@cardstack/runtime-common';

// The queue's claim query only dequeues job types a worker has registered
// handlers for, so a worker's registration set IS its claim policy. These
// tests pin the registration sets for the two worker flavors:
//
//   1. A default worker registers every job type.
//   2. An `indexJobsOnly` worker registers exactly INDEX_JOB_TYPES — that
//      restriction is what makes the worker-manager's user-index pool a
//      dedicated indexing lane that a prerender_html sweep (or any other
//      job type) can never occupy, independent of priority tiers. Indexing
//      gates realm provisioning (createRealm blocks on the from-scratch
//      index) and read-your-writes endpoints (card GET / _publishability
//      drain in-flight incremental indexing), so an index job must never
//      sit queued behind long render sweeps.

function makeStubQueue(registered: string[]): QueueRunner {
  return {
    register: (jobType: string) => {
      registered.push(jobType);
    },
    start: async () => {},
    destroy: async () => {},
  } as QueueRunner;
}

function makeWorker(
  queue: QueueRunner,
  indexJobsOnly?: boolean,
  extra: Pick<
    ConstructorParameters<typeof Worker>[0],
    'codeLinker' | 'latticeJobsOnly'
  > = {},
) {
  // Worker.run() only touches these dependencies at registration time via
  // closures inside the task factories, so shallow stubs are sufficient —
  // no task actually executes in these tests.
  return new Worker({
    indexWriter: {} as any,
    queue,
    dbAdapter: {} as any,
    queuePublisher: {} as any,
    virtualNetwork: { fetch: (() => {}) as any } as any,
    matrixURL: new URL('http://localhost:8008'),
    realmServerMatrixUsername: 'realm_server',
    secretSeed: 'test-seed',
    prerenderer: {} as any,
    createPrerenderAuth: () => 'test-auth',
    ...(indexJobsOnly !== undefined ? { indexJobsOnly } : {}),
    ...extra,
  });
}

module(basename(import.meta.filename), function () {
  test('a default worker registers every job type', async function (assert) {
    let registered: string[] = [];
    await makeWorker(makeStubQueue(registered)).run();

    assert.deepEqual(
      registered.sort(),
      [
        'copy-index',
        'daily-credit-grant',
        'from-scratch-index',
        'full-reindex',
        'incremental-index',
        'lattice-clock-sweep',
        'lattice-materialize',
        'lint-source',
        'media-cache-gc',
        'prerender-html-reconcile',
        'prerender_html',
        'run-command',
        'scoped-css-gc',
        'screenshot-card',
      ],
      'all job types are registered',
    );
  });

  test('an indexJobsOnly worker registers exactly the indexing job types', async function (assert) {
    let registered: string[] = [];
    await makeWorker(makeStubQueue(registered), true).run();

    assert.deepEqual(
      registered.sort(),
      [...INDEX_JOB_TYPES].sort(),
      'only indexing job types are registered',
    );
    assert.notOk(
      registered.includes('prerender_html'),
      'the index lane cannot claim prerender_html jobs',
    );
  });

  test('code linking needs its Node capability and does not occupy source or materialization lanes', async function (assert) {
    const codeLinker = async () => ({ published: 0, superseded: 0 });
    for (const kind of ['background', 'source', 'materialization'] as const) {
      const registered: string[] = [];
      await makeWorker(makeStubQueue(registered), kind === 'source', {
        codeLinker,
        latticeJobsOnly: kind === 'materialization',
      }).run();
      assert.strictEqual(
        registered.includes('lattice-link-code'),
        kind === 'background',
        kind,
      );
      if (kind === 'materialization') {
        assert.deepEqual(
          registered,
          ['lattice-materialize'],
          'background HTML cannot occupy the dedicated materialization worker',
        );
      }
    }
  });
});
