import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { RealmEventContent } from '@cardstack/base/matrix-event';
import { MatrixRequestError } from '@cardstack/runtime-common/matrix-client';
import {
  RealmEventDispatcher,
  coalesce,
  isBackPressure,
  type RealmEventBroadcast,
} from '../realm-event-dispatcher.ts';

const REALM_A = 'http://127.0.0.1:4444/a/';
const REALM_B = 'http://127.0.0.1:4444/b/';

interface Sent {
  realmURL: string;
  roomId: string;
  event: RealmEventContent;
  txnId: string;
}

function deferred() {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  let promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function initiation(realmURL: string, updatedFile: string): RealmEventContent {
  return {
    eventName: 'index',
    indexType: 'incremental-index-initiation',
    updatedFile,
    realmURL,
  };
}

function incremental(realmURL: string, card: string): RealmEventContent {
  return {
    eventName: 'index',
    indexType: 'incremental',
    invalidations: [`${realmURL}${card}`],
    realmURL,
  };
}

// A harness whose sends are held open until the test releases them, so a test
// can look at what the dispatcher has started at any moment.
function harness(
  opts: ConstructorParameters<typeof RealmEventDispatcher>[0] = {},
) {
  let dispatcher = new RealmEventDispatcher({
    sendsPerSecond: 1000,
    ...opts,
  });
  let started: (Sent & { done: ReturnType<typeof deferred> })[] = [];
  let failures: { roomId: string; error: unknown }[] = [];
  let txn = 0;
  let autoRelease = false;

  function broadcast(
    realmURL: string,
    event: RealmEventContent,
    rooms: string[] = ['!room-1'],
    send?: (sent: Sent) => Promise<void>,
  ) {
    let request: RealmEventBroadcast = {
      realmURL,
      event,
      newTxnId: () => `txn-${txn++}`,
      prepare: async (content) =>
        rooms.map((roomId) => ({
          roomId,
          send: async (txnId: string) => {
            let sent = { realmURL, roomId, event: content, txnId };
            if (send) {
              return await send(sent);
            }
            let done = deferred();
            started.push({ ...sent, done });
            if (autoRelease) {
              done.resolve();
            }
            await done.promise;
          },
          onFailure: async (error: unknown) => {
            failures.push({ roomId, error });
          },
        })),
    };
    return dispatcher.broadcast(request);
  }

  async function settle() {
    for (let i = 0; i < 10; i++) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  function releaseAll() {
    autoRelease = true;
    for (let s of started) {
      s.done.resolve();
    }
  }

  return { dispatcher, broadcast, started, failures, settle, releaseAll };
}

module(basename(import.meta.filename), function () {
  test('holds no more than maxInFlight sends outstanding at once', async function (assert) {
    let h = harness({ maxInFlight: 2 });
    let delivered = h.broadcast(REALM_A, incremental(REALM_A, 'card'), [
      '!r1',
      '!r2',
      '!r3',
      '!r4',
    ]);
    await h.settle();
    assert.strictEqual(h.started.length, 2, 'two sends start');
    assert.strictEqual(h.dispatcher.takeStats().sendsInFlight, 2);

    h.started[0].done.resolve();
    await h.settle();
    assert.strictEqual(h.started.length, 3, 'a finished send frees a slot');

    h.releaseAll();
    await delivered;
    assert.deepEqual(
      h.started.map((s) => s.roomId),
      ['!r1', '!r2', '!r3', '!r4'],
      'every room gets the event',
    );
  });

  test("starts a realm's next event only once every room has the one before it", async function (assert) {
    let h = harness({ maxInFlight: 8 });
    void h.broadcast(REALM_A, initiation(REALM_A, `${REALM_A}card`), [
      '!r1',
      '!r2',
    ]);
    let second = h.broadcast(REALM_A, incremental(REALM_A, 'card'), [
      '!r1',
      '!r2',
    ]);
    await h.settle();
    assert.deepEqual(
      h.started.map((s) => (s.event as { indexType: string }).indexType),
      ['incremental-index-initiation', 'incremental-index-initiation'],
      'only the first event is sending',
    );

    h.started[0].done.resolve();
    await h.settle();
    assert.strictEqual(
      h.started.length,
      2,
      'the second event waits while a room still lacks the first',
    );

    h.releaseAll();
    await second;
    assert.deepEqual(
      h.started.map((s) => (s.event as { indexType: string }).indexType),
      [
        'incremental-index-initiation',
        'incremental-index-initiation',
        'incremental',
        'incremental',
      ],
    );
  });

  test('gives each realm with a send ready a turn, so a backlog does not hold up another realm', async function (assert) {
    let h = harness({ maxInFlight: 1 });
    void h.broadcast(REALM_A, incremental(REALM_A, 'one'), [
      '!a1',
      '!a2',
      '!a3',
    ]);
    void h.broadcast(REALM_A, incremental(REALM_A, 'two'), ['!a1']);
    let quiet = h.broadcast(REALM_B, incremental(REALM_B, 'card'), ['!b1']);
    await h.settle();

    for (let i = 0; i < 2; i++) {
      h.started[h.started.length - 1].done.resolve();
      await h.settle();
    }
    await quiet;
    assert.deepEqual(
      h.started.map((s) => s.roomId),
      ['!a1', '!b1', '!a2'],
      "realm B's send goes out after one send of realm A's, not after all of them",
    );
    h.releaseAll();
    await h.dispatcher.idle();
  });

  test('merges queued initiations and updates, but never past an event of another kind', async function (assert) {
    let h = harness({ maxInFlight: 1 });
    void h.broadcast(REALM_A, incremental(REALM_A, 'sending'));
    await h.settle();

    let waits = [
      h.broadcast(REALM_A, initiation(REALM_A, `${REALM_A}one`)),
      h.broadcast(REALM_A, initiation(REALM_A, `${REALM_A}two`)),
      h.broadcast(REALM_A, incremental(REALM_A, 'two')),
      h.broadcast(REALM_A, initiation(REALM_A, `${REALM_A}three`)),
      h.broadcast(REALM_A, {
        eventName: 'update',
        added: ['three.json'],
        realmURL: REALM_A,
      }),
      h.broadcast(REALM_A, {
        eventName: 'update',
        added: ['four.json'],
        removed: ['three.json'],
        realmURL: REALM_A,
      }),
    ];
    assert.strictEqual(
      h.dispatcher.takeStats().coalesced,
      2,
      'the second initiation and the second update merge',
    );

    h.releaseAll();
    await Promise.all(waits);
    assert.deepEqual(
      h.started.map((s) => s.event),
      [
        incremental(REALM_A, 'sending'),
        initiation(REALM_A, `${REALM_A}two`),
        incremental(REALM_A, 'two'),
        initiation(REALM_A, `${REALM_A}three`),
        {
          eventName: 'update',
          added: ['three.json', 'four.json'],
          removed: ['three.json'],
          realmURL: REALM_A,
        },
      ],
      'the event already sending and the completion between the initiations are left alone',
    );
  });

  test('pauses and retries a send synapse answers as overloaded, with the same transaction id', async function (assert) {
    let attempts: string[] = [];
    let h = harness({ initialBackoffMs: 20 });
    let startedAt = Date.now();
    await h.broadcast(
      REALM_A,
      incremental(REALM_A, 'card'),
      ['!r1'],
      async ({ txnId }) => {
        attempts.push(txnId);
        if (attempts.length < 3) {
          throw new MatrixRequestError('status 504 - non-JSON body', 504);
        }
      },
    );
    assert.deepEqual(attempts, ['txn-0', 'txn-0', 'txn-0']);
    assert.true(
      Date.now() - startedAt >= 55,
      'each retry waits out a pause that doubles',
    );
    assert.deepEqual(h.failures, [], 'a retried send is not a failure');
    let stats = h.dispatcher.takeStats();
    assert.strictEqual(stats.backPressure, 2);
    assert.strictEqual(stats.failedSends, 0);
  });

  test('reports a send that fails for another reason once, without retrying it', async function (assert) {
    let attempts = 0;
    let h = harness();
    let error = new MatrixRequestError(
      'status 500 - {"errcode":"M_UNKNOWN"}',
      500,
    );
    await h.broadcast(
      REALM_A,
      incremental(REALM_A, 'card'),
      ['!r1'],
      async () => {
        attempts++;
        throw error;
      },
    );
    assert.strictEqual(attempts, 1);
    assert.deepEqual(h.failures, [{ roomId: '!r1', error }]);
  });

  test('gives up on a send that is still overloaded after maxAttempts', async function (assert) {
    let attempts = 0;
    let h = harness({ maxAttempts: 3, initialBackoffMs: 1 });
    await h.broadcast(
      REALM_A,
      incremental(REALM_A, 'card'),
      ['!r1'],
      async () => {
        attempts++;
        throw new MatrixRequestError('status 503 - non-JSON body', 503);
      },
    );
    assert.strictEqual(attempts, 3);
    assert.strictEqual(h.failures.length, 1, 'the last attempt is reported');
  });

  test('past the byte bound, drops the oldest event of the realm with the longest backlog', async function (assert) {
    let eventBytes = Buffer.byteLength(
      JSON.stringify(incremental(REALM_A, 'card-0')),
    );
    let h = harness({ maxInFlight: 1, maxQueuedBytes: eventBytes * 3 });
    void h.broadcast(REALM_A, incremental(REALM_A, 'sending'));
    await h.settle();

    let dropped = false;
    void h
      .broadcast(REALM_A, incremental(REALM_A, 'card-0'))
      .then(() => (dropped = true));
    void h.broadcast(REALM_A, incremental(REALM_A, 'card-1'));
    void h.broadcast(REALM_B, incremental(REALM_B, 'card-0'));
    assert.false(dropped, 'within the bound nothing is dropped');

    void h.broadcast(REALM_B, incremental(REALM_B, 'card-1'));
    await h.settle();
    assert.true(dropped, "the dropped event's broadcast resolves");
    let stats = h.dispatcher.takeStats();
    assert.strictEqual(stats.dropped, 1);
    assert.strictEqual(stats.queuedEvents, 3);

    h.releaseAll();
    await h.dispatcher.idle();
    assert.deepEqual(
      h.started
        .map((s) => (s.event as { invalidations: string[] }).invalidations[0])
        .sort(),
      [
        `${REALM_A}card-1`,
        `${REALM_A}sending`,
        `${REALM_B}card-0`,
        `${REALM_B}card-1`,
      ],
      "realm B's backlog is delivered whole",
    );
  });

  test('starts sends no faster than sendsPerSecond', async function (assert) {
    let h = harness({ sendsPerSecond: 10, maxInFlight: 100 });
    h.releaseAll();
    let startedAt = Date.now();
    await h.broadcast(
      REALM_A,
      incremental(REALM_A, 'card'),
      Array.from({ length: 13 }, (_, i) => `!r${i}`),
    );
    // The bucket starts with a second's worth of sends; the three past it
    // wait 100ms apiece.
    assert.true(
      Date.now() - startedAt >= 250,
      `13 sends at 10/s took ${Date.now() - startedAt}ms`,
    );
    assert.strictEqual(h.started.length, 13);
  });

  test('a realm whose rooms cannot be resolved is skipped without stalling the line', async function (assert) {
    let h = harness();
    h.releaseAll();
    await h.dispatcher.broadcast({
      realmURL: REALM_A,
      event: incremental(REALM_A, 'card'),
      newTxnId: () => 'txn',
      prepare: async () => {
        throw new Error('database is unreachable');
      },
    });
    await h.broadcast(REALM_A, incremental(REALM_A, 'next'));
    assert.strictEqual(h.started.length, 1);
    assert.strictEqual(h.dispatcher.takeStats().queuedEvents, 0);
  });

  module('isBackPressure', function () {
    test('treats overload and unreachable answers as back-pressure, and nothing else', function (assert) {
      for (let status of [429, 502, 503, 504]) {
        assert.true(isBackPressure(new MatrixRequestError('x', status)));
      }
      for (let status of [400, 403, 404, 500]) {
        assert.false(isBackPressure(new MatrixRequestError('x', status)));
      }
      assert.true(isBackPressure(new TypeError('fetch failed')));
      assert.false(isBackPressure(new Error('boom')));
    });
  });

  module('coalesce', function () {
    test('leaves completion events alone', function (assert) {
      assert.strictEqual(
        coalesce(incremental(REALM_A, 'a'), incremental(REALM_A, 'b')),
        undefined,
      );
      assert.strictEqual(
        coalesce(
          { eventName: 'index', indexType: 'full', realmURL: REALM_A },
          { eventName: 'index', indexType: 'full', realmURL: REALM_A },
        ),
        undefined,
      );
      assert.strictEqual(
        coalesce(initiation(REALM_A, `${REALM_A}a`), incremental(REALM_A, 'a')),
        undefined,
      );
    });
  });
});
