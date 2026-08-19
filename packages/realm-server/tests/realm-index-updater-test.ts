import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import {
  Deferred,
  Job,
  RealmIndexUpdater,
  identityResultMapper,
  makeQueueWaiter,
  type DBAdapter,
  type PgPrimitive,
  type QueuePublisher,
  type Realm,
} from '@cardstack/runtime-common';

const realmURL = 'http://127.0.0.1:4444/test/';

// The serialized shape a worker-side ENOENT lands in the jobs table with —
// a plain object, not an Error instance.
const serializedWorkerError: PgPrimitive = {
  code: 'ENOENT',
  syscall: 'open',
  path: '/tmp/realm/doomed.txt',
  errno: -2,
};

function makeStubRealm(): Realm {
  return {
    url: realmURL,
    getRealmOwnerUsername: async () => 'test_user',
  } as unknown as Realm;
}

// Mirrors the pg-queue publish path closely enough to exercise the waiter
// plumbing: the job's deferred is settled through makeQueueWaiter with the
// caller-provided mapResult, exactly as a real queue does when a worker
// resolves or rejects the job.
function makeStubQueue() {
  let waiters: ReturnType<typeof makeQueueWaiter>[] = [];
  let queue: QueuePublisher = {
    publish: async <TResult>(args: {
      mapResult?: (result: PgPrimitive) => TResult;
    }) => {
      let deferred = new Deferred<TResult>();
      waiters.push(
        makeQueueWaiter(
          deferred,
          args.mapResult ??
            (identityResultMapper as (result: PgPrimitive) => TResult),
        ),
      );
      return new Job(1, deferred);
    },
    destroy: async () => {},
  };
  return { queue, waiters };
}

async function settleMicrotasksAndUnhandledRejections() {
  // unhandledRejection fires on a macrotask boundary after the rejection is
  // left without a handler, so a timer tick is needed before asserting none
  // fired.
  await new Promise((resolve) => setTimeout(resolve, 10));
}

module(basename(import.meta.filename), function (hooks) {
  let unhandledRejections: unknown[] = [];
  let captureUnhandledRejection = (reason: unknown) => {
    unhandledRejections.push(reason);
  };

  hooks.beforeEach(function () {
    unhandledRejections = [];
    process.on('unhandledRejection', captureUnhandledRejection);
  });

  hooks.afterEach(function () {
    process.off('unhandledRejection', captureUnhandledRejection);
  });

  test('a failing job rejects settled with a real Error carrying the serialized detail', async function (assert) {
    let { queue, waiters } = makeStubQueue();
    let updater = new RealmIndexUpdater({
      realm: makeStubRealm(),
      dbAdapter: {} as DBAdapter,
      queue,
    });

    let { settled } = await updater.enqueueUpdate([
      new URL(`${realmURL}doomed.txt`),
    ]);
    waiters[0].rejectFromResult(serializedWorkerError);

    let settledError: unknown;
    try {
      await settled;
    } catch (e) {
      settledError = e;
    }
    assert.true(
      settledError instanceof Error,
      'settled rejects with an Error instance, not a plain object',
    );
    assert.true(
      (settledError as Error).message.includes('ENOENT'),
      `the Error message carries the serialized worker error detail: ${
        (settledError as Error).message
      }`,
    );
  });

  test('a failing job left fire-and-forget does not produce an unhandled rejection', async function (assert) {
    let { queue, waiters } = makeStubQueue();
    let updater = new RealmIndexUpdater({
      realm: makeStubRealm(),
      dbAdapter: {} as DBAdapter,
      queue,
    });

    // The deferred-indexing path attaches a catch to `settled` but nothing
    // ever awaits the quiescence gate. The gate must not reject: a rejecting
    // gate with no listener is an unhandled rejection, which aborts native
    // Node and fails any vitest/qunit run that polices unhandled errors.
    let { settled } = await updater.enqueueUpdate([
      new URL(`${realmURL}doomed.txt`),
    ]);
    settled.catch(() => {});

    waiters[0].rejectFromResult(serializedWorkerError);
    await settleMicrotasksAndUnhandledRejections();

    assert.deepEqual(
      unhandledRejections,
      [],
      'no unhandled rejection escapes the fire-and-forget path',
    );
    assert.strictEqual(
      updater.incrementalIndexing(),
      undefined,
      'the gate is drained after the job fails',
    );
  });

  test('the quiescence gate resolves even when the job fails', async function (assert) {
    let { queue, waiters } = makeStubQueue();
    let updater = new RealmIndexUpdater({
      realm: makeStubRealm(),
      dbAdapter: {} as DBAdapter,
      queue,
    });

    let { settled } = await updater.enqueueUpdate([
      new URL(`${realmURL}doomed.txt`),
    ]);
    settled.catch(() => {});
    let gate = updater.incrementalIndexing();
    assert.notStrictEqual(gate, undefined, 'gate reflects the in-flight job');

    waiters[0].rejectFromResult(serializedWorkerError);

    // Resolves rather than rejects: the gate reports quiescence, not success.
    await gate;
    assert.strictEqual(
      updater.incrementalIndexing(),
      undefined,
      'gate is drained once the failed job settles',
    );
  });

  test('a pre-enqueue publish failure rejects enqueueUpdate and cleans up the gate', async function (assert) {
    let queue: QueuePublisher = {
      publish: async () => {
        throw new Error('durable enqueue failed');
      },
      destroy: async () => {},
    };
    let updater = new RealmIndexUpdater({
      realm: makeStubRealm(),
      dbAdapter: {} as DBAdapter,
      queue,
    });

    await assert.rejects(
      updater.enqueueUpdate([new URL(`${realmURL}doomed.txt`)]),
      /durable enqueue failed/,
      'the caller hears about a failed enqueue via the method throw',
    );
    await settleMicrotasksAndUnhandledRejections();

    assert.deepEqual(
      unhandledRejections,
      [],
      'no unhandled rejection escapes the pre-enqueue failure path',
    );
    assert.strictEqual(
      updater.incrementalIndexing(),
      undefined,
      'the gate is cleaned up after a failed enqueue',
    );
  });

  test('a failing copy job throws from copy() and resolves the gate', async function (assert) {
    let { queue, waiters } = makeStubQueue();
    let updater = new RealmIndexUpdater({
      realm: makeStubRealm(),
      dbAdapter: {} as DBAdapter,
      queue,
    });

    let copyPromise = updater.copy(new URL('http://127.0.0.1:4444/source/'));
    copyPromise.catch(() => {});
    while (waiters.length === 0) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    let gate = updater.incrementalIndexing();
    assert.notStrictEqual(gate, undefined, 'gate reflects the in-flight copy');

    waiters[0].rejectFromResult(serializedWorkerError);

    let copyError: unknown;
    try {
      await copyPromise;
    } catch (e) {
      copyError = e;
    }
    assert.deepEqual(
      copyError,
      serializedWorkerError,
      'copy() rejects with the job failure',
    );
    await gate;
    await settleMicrotasksAndUnhandledRejections();

    assert.deepEqual(
      unhandledRejections,
      [],
      'no unhandled rejection escapes the copy failure path',
    );
    assert.strictEqual(
      updater.incrementalIndexing(),
      undefined,
      'gate is drained once the failed copy settles',
    );
  });
});
