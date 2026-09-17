import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import {
  PgAdapter,
  hashFilePathForAdvisoryLock,
  hashRealmUrlForAdvisoryLock,
  hashUserIdForCostLock,
} from '@cardstack/postgres';
import { setupDB } from './helpers/index.ts';

// Records each event with a relative timestamp so a failed ordering assertion
// can tell us *when* each entry happened, not just the final order. The
// timeline string is appended to the assertion message — handy when a flake
// recurs and we need to know whether caller-1 entered its critical section
// after caller-2 (real lock-ordering bug) or whether something else (e.g.
// pool starvation) delayed an event by an unexpected amount.
function timeline(events: string[], startedAt: number, eventTimes: number[]) {
  return events
    .map((e, i) => `${e}@${(eventTimes[i] - startedAt).toFixed(0)}ms`)
    .join(',');
}

module(basename(import.meta.filename), function () {
  module('hashRealmUrlForAdvisoryLock', function () {
    test('is deterministic', function (assert) {
      const url = 'http://localhost:4201/luke/my-realm/';
      assert.strictEqual(
        hashRealmUrlForAdvisoryLock(url),
        hashRealmUrlForAdvisoryLock(url),
      );
    });

    test('yields different keys for different URLs', function (assert) {
      assert.notStrictEqual(
        hashRealmUrlForAdvisoryLock('http://localhost:4201/a/'),
        hashRealmUrlForAdvisoryLock('http://localhost:4201/b/'),
      );
    });

    test('returns a string parseable as a signed 64-bit integer', function (assert) {
      const key = hashRealmUrlForAdvisoryLock(
        'http://localhost:4201/luke/my-realm/',
      );
      // Should be a decimal integer string, possibly negative.
      assert.ok(
        /^-?\d+$/.test(key),
        `key is a decimal integer string (got ${key})`,
      );
      const asBigInt = BigInt(key);
      // Within signed int64 range: [-(2^63), 2^63 - 1]
      const MAX = 2n ** 63n - 1n;
      const MIN = -(2n ** 63n);
      assert.ok(asBigInt <= MAX, 'within int64 upper bound');
      assert.ok(asBigInt >= MIN, 'within int64 lower bound');
    });
  });

  module('PgAdapter.withWriteLock', function (hooks) {
    let dbAdapter: PgAdapter;
    setupDB(hooks, {
      beforeEach: async (adapter) => {
        dbAdapter = adapter;
      },
    });

    test('runs the callback and returns its value', async function (assert) {
      const result = await dbAdapter.withWriteLock(
        'http://localhost:4201/x/',
        async () => 42,
      );
      assert.strictEqual(result, 42);
    });

    test('serializes two concurrent callers for the same URL', async function (assert) {
      const url = 'http://localhost:4201/serialize/';
      const events: string[] = [];
      const eventTimes: number[] = [];
      const startedAt = Date.now();
      const push = (e: string) => {
        events.push(e);
        eventTimes.push(Date.now());
      };

      // First caller grabs the lock and holds it for a bit. Second caller
      // tries to acquire concurrently and should only run after the first
      // releases. We verify by appending to a shared array in a specific
      // order and checking the final ordering.
      //
      // Synchronization: we cannot rely on a fixed-millisecond head start to
      // ensure caller-1 acquires the advisory lock before caller-2 even
      // tries — on a slow CI runner the postgres roundtrip can exceed the
      // sleep, letting caller-2 win the race. Instead caller-1 resolves
      // `p1Entered` from inside its callback (after the lock is held), and
      // caller-2 is not constructed until that signal fires.
      //
      // We race the entry signal against `p1` itself so that a rejection
      // during lock acquisition (transient pool/DB failure before the
      // callback runs) surfaces immediately instead of leaving us awaiting
      // a signal that will never fire — which would otherwise hang until
      // the qunit test timeout and obscure the real error.
      let signalP1Entered!: () => void;
      const p1Entered = new Promise<void>((r) => {
        signalP1Entered = r;
      });
      const p1 = dbAdapter.withWriteLock(url, async () => {
        push('1-start');
        signalP1Entered();
        await new Promise((r) => setTimeout(r, 150));
        push('1-end');
      });
      await Promise.race([p1Entered, p1]);
      const p2 = dbAdapter.withWriteLock(url, async () => {
        push('2-start');
        push('2-end');
      });

      await Promise.all([p1, p2]);

      assert.deepEqual(
        events,
        ['1-start', '1-end', '2-start', '2-end'],
        `second caller runs only after first releases the lock; timeline: ${timeline(events, startedAt, eventTimes)}`,
      );
    });

    test('runs concurrent callers for different URLs in parallel', async function (assert) {
      const events: string[] = [];

      const p1 = dbAdapter.withWriteLock(
        'http://localhost:4201/a/',
        async () => {
          events.push('a-start');
          await new Promise((r) => setTimeout(r, 150));
          events.push('a-end');
        },
      );
      const p2 = dbAdapter.withWriteLock(
        'http://localhost:4201/b/',
        async () => {
          events.push('b-start');
          await new Promise((r) => setTimeout(r, 20));
          events.push('b-end');
        },
      );

      await Promise.all([p1, p2]);

      // B should complete before A-end because they run in parallel and
      // B's critical section is much shorter. If they had serialized on
      // the same lock, B would only start after A finished.
      const aEndIdx = events.indexOf('a-end');
      const bEndIdx = events.indexOf('b-end');
      assert.ok(
        bEndIdx < aEndIdx,
        `b-end (${bEndIdx}) should come before a-end (${aEndIdx}) under parallel execution; events: ${events.join(',')}`,
      );
    });

    test('releases the lock when the callback throws', async function (assert) {
      const url = 'http://localhost:4201/throw/';
      await assert.rejects(
        dbAdapter.withWriteLock(url, async () => {
          throw new Error('deliberate failure');
        }),
        /deliberate failure/,
      );
      // A second acquisition should succeed immediately — if the lock leaked,
      // this would block forever (test timeout would fire).
      const result = await dbAdapter.withWriteLock(url, async () => 'ok');
      assert.strictEqual(result, 'ok', 'lock released after prior failure');
    });
  });

  module('hashFilePathForAdvisoryLock', function () {
    test('is deterministic', function (assert) {
      const realm = 'http://localhost:4201/luke/my-realm/';
      assert.strictEqual(
        hashFilePathForAdvisoryLock(realm, 'Widget/one.json'),
        hashFilePathForAdvisoryLock(realm, 'Widget/one.json'),
      );
    });

    test('yields different keys for different paths in one realm', function (assert) {
      const realm = 'http://localhost:4201/luke/my-realm/';
      assert.notStrictEqual(
        hashFilePathForAdvisoryLock(realm, 'Widget/one.json'),
        hashFilePathForAdvisoryLock(realm, 'Widget/two.json'),
      );
    });

    test('yields different keys for one path in different realms', function (assert) {
      assert.notStrictEqual(
        hashFilePathForAdvisoryLock('http://localhost:4201/a/', 'Card/1.json'),
        hashFilePathForAdvisoryLock('http://localhost:4201/b/', 'Card/1.json'),
      );
    });

    test('cannot be collided by moving the boundary between realm and path', function (assert) {
      // The realm and the path are joined through a separator, so a realm
      // whose text ends where another's path begins must not hash to the same
      // key. Without a separator both of these would digest one identical
      // byte sequence and two unrelated files would share a lock.
      assert.notStrictEqual(
        hashFilePathForAdvisoryLock('http://localhost:4201/a/b/', 'c.json'),
        hashFilePathForAdvisoryLock('http://localhost:4201/a/', 'b/c.json'),
      );
    });

    test('is disjoint from the realm-write key space', function (assert) {
      const realm = 'http://localhost:4201/luke/my-realm/';
      assert.notStrictEqual(
        hashFilePathForAdvisoryLock(realm, ''),
        hashRealmUrlForAdvisoryLock(realm),
      );
    });

    test('returns a string parseable as a signed 64-bit integer', function (assert) {
      const key = hashFilePathForAdvisoryLock(
        'http://localhost:4201/luke/my-realm/',
        'Widget/one.json',
      );
      assert.ok(
        /^-?\d+$/.test(key),
        `key is a decimal integer string (got ${key})`,
      );
      const asBigInt = BigInt(key);
      const MAX = 2n ** 63n - 1n;
      const MIN = -(2n ** 63n);
      assert.ok(asBigInt <= MAX, 'within int64 upper bound');
      assert.ok(asBigInt >= MIN, 'within int64 lower bound');
    });
  });

  module('PgAdapter.withFileWriteLocks', function (hooks) {
    let dbAdapter: PgAdapter;
    setupDB(hooks, {
      beforeEach: async (adapter) => {
        dbAdapter = adapter;
      },
    });

    const REALM = 'http://localhost:4201/files/';

    // Hold `outer` open until `inner` has run to completion, and report what
    // happened if it never does. Every concurrency claim below is shaped this
    // way rather than as a race between two sleeps: the outer caller does not
    // release until the inner one is finished, so an inner call that completes
    // proves it was never excluded, and one that is excluded blocks and trips
    // the guard with a timeline instead of hanging until the suite times out.
    // A fixed-duration window would instead be asserting that postgres
    // answered fast enough, which is a different claim and a flaky one.
    async function runInsideWindow(
      assert: Assert,
      opts: {
        openOuter: (
          onEntered: () => void,
          released: Promise<void>,
        ) => Promise<unknown>;
        runInner: () => Promise<unknown>;
        what: string;
      },
    ): Promise<void> {
      const startedAt = Date.now();
      const events: string[] = [];
      const eventTimes: number[] = [];
      const push = (e: string) => {
        events.push(e);
        eventTimes.push(Date.now());
      };
      let signalEntered!: () => void;
      const entered = new Promise<void>((r) => {
        signalEntered = r;
      });
      let release!: () => void;
      const released = new Promise<void>((r) => {
        release = r;
      });
      const outer = opts.openOuter(() => {
        push('outer-held');
        signalEntered();
      }, released);
      // Race the entry signal against the outer promise, so a rejection
      // during acquisition surfaces here instead of leaving us awaiting a
      // signal that will never fire.
      await Promise.race([entered, outer]);
      let guardTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        const inner = opts.runInner().then((value) => {
          push('inner-done');
          return value;
        });
        const guard = new Promise<never>((_resolve, reject) => {
          guardTimer = setTimeout(
            () =>
              reject(
                new Error(
                  `${opts.what}: the inner caller did not finish while the outer lock was held, so the two excluded each other; timeline: ${timeline(events, startedAt, eventTimes)}`,
                ),
              ),
            5000,
          );
        });
        await Promise.race([inner, guard]);
        assert.ok(
          events.includes('inner-done'),
          `${opts.what}; timeline: ${timeline(events, startedAt, eventTimes)}`,
        );
      } finally {
        if (guardTimer) {
          clearTimeout(guardTimer);
        }
        release();
        await outer;
      }
    }

    test('runs the callback and returns its value', async function (assert) {
      const result = await dbAdapter.withFileWriteLocks(
        REALM,
        ['Widget/one.json'],
        async () => 42,
      );
      assert.strictEqual(result, 42);
    });

    test('serializes two concurrent writers of one file', async function (assert) {
      const events: string[] = [];
      const eventTimes: number[] = [];
      const startedAt = Date.now();
      const push = (e: string) => {
        events.push(e);
        eventTimes.push(Date.now());
      };

      let signalFirstEntered!: () => void;
      const firstEntered = new Promise<void>((r) => {
        signalFirstEntered = r;
      });
      const first = dbAdapter.withFileWriteLocks(
        REALM,
        ['Widget/one.json'],
        async () => {
          push('1-start');
          signalFirstEntered();
          await new Promise((r) => setTimeout(r, 150));
          push('1-end');
        },
      );
      await Promise.race([firstEntered, first]);
      const second = dbAdapter.withFileWriteLocks(
        REALM,
        ['Widget/one.json'],
        async () => {
          push('2-start');
          push('2-end');
        },
      );

      await Promise.all([first, second]);

      assert.deepEqual(
        events,
        ['1-start', '1-end', '2-start', '2-end'],
        `the second writer of one card runs only after the first releases; timeline: ${timeline(events, startedAt, eventTimes)}`,
      );
    });

    test('runs writers of different files in the same realm in parallel', async function (assert) {
      // The property the per-file scope exists for: one card's write, however
      // long it holds, does not stall the writer of another card in the same
      // realm.
      await runInsideWindow(assert, {
        what: 'a writer of one card runs while another card is held',
        openOuter: (onEntered, released) =>
          dbAdapter.withFileWriteLocks(REALM, ['Widget/one.json'], async () => {
            onEntered();
            await released;
          }),
        runInner: () =>
          dbAdapter.withFileWriteLocks(
            REALM,
            ['Gadget/one.json'],
            async () => 'ok',
          ),
      });
    });

    test('serializes writers whose file sets overlap in one file', async function (assert) {
      const events: string[] = [];
      const eventTimes: number[] = [];
      const startedAt = Date.now();
      const push = (e: string) => {
        events.push(e);
        eventTimes.push(Date.now());
      };

      let signalFirstEntered!: () => void;
      const firstEntered = new Promise<void>((r) => {
        signalFirstEntered = r;
      });
      // Two batches that share exactly one file. Sharing one is enough to
      // order them, which is what stops a batch reading a file another batch
      // is part-way through rewriting.
      const first = dbAdapter.withFileWriteLocks(
        REALM,
        ['Widget/one.json', 'Gadget/one.json'],
        async () => {
          push('1-start');
          signalFirstEntered();
          await new Promise((r) => setTimeout(r, 150));
          push('1-end');
        },
      );
      await Promise.race([firstEntered, first]);
      const second = dbAdapter.withFileWriteLocks(
        REALM,
        ['Gadget/one.json', 'Gadget/two.json'],
        async () => {
          push('2-start');
          push('2-end');
        },
      );

      await Promise.all([first, second]);

      assert.deepEqual(
        events,
        ['1-start', '1-end', '2-start', '2-end'],
        `a batch waits for another holding a file it also needs; timeline: ${timeline(events, startedAt, eventTimes)}`,
      );
    });

    test('takes the shared files in one order whichever order the sets name them', async function (assert) {
      // Two callers naming the same two files in opposite orders, each on its
      // own adapter. The second adapter is what makes this observable: both
      // callers reduce to the same sorted key list, so on one adapter they
      // share a `#fileWriteQueue` entry and chain in memory — the second never
      // reaches postgres while the first holds anything, and the assertion
      // below would hold however the keys were ordered. Separate adapters have
      // separate queues and one lock space, which is also the shape this rule
      // exists for: two replicas, no shared memory between them.
      //
      // Taken sorted, the two acquire in the same sequence and one simply
      // waits. Taken in the order each was given, one would hold this file
      // while waiting for that one and the other the reverse, which postgres
      // can only resolve by killing one of them as a deadlock. The guard turns
      // that into a named failure rather than a suite that hangs here.
      const second = new PgAdapter();
      let guardTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        const both = Promise.all([
          dbAdapter.withFileWriteLocks(
            REALM,
            ['Widget/one.json', 'Gadget/one.json'],
            async () => {
              // Held across the other caller's own acquisition, so the two
              // windows overlap rather than running one after the other.
              await new Promise((r) => setTimeout(r, 150));
              return 'first';
            },
          ),
          second.withFileWriteLocks(
            REALM,
            ['Gadget/one.json', 'Widget/one.json'],
            async () => {
              await new Promise((r) => setTimeout(r, 150));
              return 'second';
            },
          ),
        ]);
        const guard = new Promise<never>((_resolve, reject) => {
          guardTimer = setTimeout(
            () =>
              reject(
                new Error(
                  'neither caller finished: two writers of one pair of files ' +
                    'each held what the other needed',
                ),
              ),
            8000,
          );
        });
        assert.deepEqual(
          await Promise.race([both, guard]),
          ['first', 'second'],
          'both callers complete rather than each holding what the other needs',
        );
      } finally {
        if (guardTimer) {
          clearTimeout(guardTimer);
        }
        await second.close();
      }
    });

    test('waits for a realm-lifecycle caller holding the realm lock', async function (assert) {
      // A file writer holds the realm's own key in shared mode, so a caller
      // that takes it exclusively — destroying, publishing or unpublishing the
      // realm — still excludes every writer in it. Without that, the two key
      // spaces would be disjoint and a realm could be torn down under a live
      // write.
      const events: string[] = [];
      const eventTimes: number[] = [];
      const startedAt = Date.now();
      const push = (e: string) => {
        events.push(e);
        eventTimes.push(Date.now());
      };

      let signalRealmEntered!: () => void;
      const realmEntered = new Promise<void>((r) => {
        signalRealmEntered = r;
      });
      const realm = dbAdapter.withWriteLock(REALM, async () => {
        push('realm-start');
        signalRealmEntered();
        await new Promise((r) => setTimeout(r, 150));
        push('realm-end');
      });
      await Promise.race([realmEntered, realm]);
      const file = dbAdapter.withFileWriteLocks(
        REALM,
        ['Widget/one.json'],
        async () => {
          push('file-start');
          push('file-end');
        },
      );

      await Promise.all([realm, file]);

      assert.deepEqual(
        events,
        ['realm-start', 'realm-end', 'file-start', 'file-end'],
        `a file write waits for the realm lock to be released; timeline: ${timeline(events, startedAt, eventTimes)}`,
      );
    });

    test('takes the realm exclusively rather than a key per file past the ceiling', async function (assert) {
      // A caller naming more files than the ceiling — a realm-wide `deleteAll`
      // is the one that reaches it — would otherwise hold one advisory lock
      // per file and exhaust the cluster's lock table. It takes the realm
      // instead, which excludes strictly more writers, so an unrelated card's
      // writer waits where it would not have for a smaller batch.
      const events: string[] = [];
      const eventTimes: number[] = [];
      const startedAt = Date.now();
      const push = (e: string) => {
        events.push(e);
        eventTimes.push(Date.now());
      };

      const many = Array.from(
        { length: 300 },
        (_unused, i) => `Widget/bulk-${i}.json`,
      );
      let signalBulkEntered!: () => void;
      const bulkEntered = new Promise<void>((r) => {
        signalBulkEntered = r;
      });
      const bulk = dbAdapter.withFileWriteLocks(REALM, many, async () => {
        push('bulk-start');
        signalBulkEntered();
        await new Promise((r) => setTimeout(r, 150));
        push('bulk-end');
      });
      await Promise.race([bulkEntered, bulk]);
      // A file the bulk caller never named. Under per-file keys this would run
      // straight through; under the realm key it waits, which is what says the
      // fallback actually happened.
      const other = dbAdapter.withFileWriteLocks(
        REALM,
        ['Gadget/one.json'],
        async () => {
          push('other-start');
          push('other-end');
        },
      );

      await Promise.all([bulk, other]);

      assert.deepEqual(
        events,
        ['bulk-start', 'bulk-end', 'other-start', 'other-end'],
        `past the ceiling the realm is held, so a writer of an unnamed file waits; timeline: ${timeline(events, startedAt, eventTimes)}`,
      );
    });

    test('does not serialize two writers that each name no file', async function (assert) {
      // A write naming no file has no read-merge-write to protect, so two of
      // them hold only the realm guard — shared, and shared holders do not
      // conflict.
      await runInsideWindow(assert, {
        what: 'a write naming no file runs while another one is held',
        openOuter: (onEntered, released) =>
          dbAdapter.withFileWriteLocks(REALM, [], async () => {
            onEntered();
            await released;
          }),
        runInner: () =>
          dbAdapter.withFileWriteLocks(REALM, [], async () => 'ok'),
      });
    });

    test('still takes the realm guard when it names no file', async function (assert) {
      // The case a create the client did not name produces: its path is minted
      // while staging, so there is no file to lock — but it does write, and a
      // realm being destroyed, published or unpublished under it must still
      // exclude it. Dropping the guard along with the file keys is what would
      // let that happen, and nothing in the write's own response would show it.
      const events: string[] = [];
      const eventTimes: number[] = [];
      const startedAt = Date.now();
      const push = (e: string) => {
        events.push(e);
        eventTimes.push(Date.now());
      };

      let signalRealmEntered!: () => void;
      const realmEntered = new Promise<void>((r) => {
        signalRealmEntered = r;
      });
      const realm = dbAdapter.withWriteLock(REALM, async () => {
        push('realm-start');
        signalRealmEntered();
        await new Promise((r) => setTimeout(r, 150));
        push('realm-end');
      });
      await Promise.race([realmEntered, realm]);
      const write = dbAdapter.withFileWriteLocks(REALM, [], async () => {
        push('write-start');
        push('write-end');
      });

      await Promise.all([realm, write]);

      assert.deepEqual(
        events,
        ['realm-start', 'realm-end', 'write-start', 'write-end'],
        `a write naming no file waits for the realm lock; timeline: ${timeline(events, startedAt, eventTimes)}`,
      );
    });

    test('releases the locks when the callback throws', async function (assert) {
      const paths = ['Widget/one.json', 'Gadget/one.json'];
      await assert.rejects(
        dbAdapter.withFileWriteLocks(REALM, paths, async () => {
          throw new Error('deliberate failure');
        }),
        /deliberate failure/,
      );
      // Every key the failed caller took has to be free, not just the first —
      // a later key left held would block only a batch that reaches it.
      const result = await dbAdapter.withFileWriteLocks(
        REALM,
        paths,
        async () => 'ok',
      );
      assert.strictEqual(result, 'ok', 'locks released after prior failure');
    });
  });

  module('hashUserIdForCostLock', function () {
    test('is deterministic', function (assert) {
      const userId = '@alice:localhost';
      assert.strictEqual(
        hashUserIdForCostLock(userId),
        hashUserIdForCostLock(userId),
      );
    });

    test('yields different keys for different user ids', function (assert) {
      assert.notStrictEqual(
        hashUserIdForCostLock('@alice:localhost'),
        hashUserIdForCostLock('@bob:localhost'),
      );
    });

    test('is namespaced away from the realm-write lock space', function (assert) {
      // A user id and a realm URL string that happened to be equal would
      // still derive different lock keys, so user-cost contention can never
      // serialize on a realm-write lock and vice versa.
      const shared = '@alice:localhost';
      assert.notStrictEqual(
        hashUserIdForCostLock(shared),
        hashRealmUrlForAdvisoryLock(shared),
      );
    });

    test('returns a string parseable as a signed 64-bit integer', function (assert) {
      const key = hashUserIdForCostLock('@alice:localhost');
      assert.ok(
        /^-?\d+$/.test(key),
        `key is a decimal integer string (got ${key})`,
      );
      const asBigInt = BigInt(key);
      const MAX = 2n ** 63n - 1n;
      const MIN = -(2n ** 63n);
      assert.ok(asBigInt <= MAX, 'within int64 upper bound');
      assert.ok(asBigInt >= MIN, 'within int64 lower bound');
    });
  });

  module('PgAdapter.withUserCostLock', function (hooks) {
    let dbAdapter: PgAdapter;
    setupDB(hooks, {
      beforeEach: async (adapter) => {
        dbAdapter = adapter;
      },
    });

    test('runs the callback and returns its value', async function (assert) {
      const result = await dbAdapter.withUserCostLock(
        '@alice:localhost',
        async () => 42,
      );
      assert.strictEqual(result, 42);
    });

    test('serializes two concurrent callers for the same user id', async function (assert) {
      const userId = '@alice:localhost';
      const events: string[] = [];
      const eventTimes: number[] = [];
      const startedAt = Date.now();
      const push = (e: string) => {
        events.push(e);
        eventTimes.push(Date.now());
      };

      // In-process queue inside withUserCostLock chains same-user callers
      // synchronously, so ordering is guaranteed regardless of timing — but
      // we still wait for caller-1 to enter its critical section before
      // constructing caller-2, to match the rest of the file and to remain
      // robust if the in-process queue is ever refactored away.
      //
      // Race the entry signal against `p1` itself so a pre-entry rejection
      // (transient pool/DB failure during advisory-lock acquisition)
      // surfaces immediately instead of hanging on a signal that won't
      // fire.
      let signalP1Entered!: () => void;
      const p1Entered = new Promise<void>((r) => {
        signalP1Entered = r;
      });
      const p1 = dbAdapter.withUserCostLock(userId, async () => {
        push('1-start');
        signalP1Entered();
        await new Promise((r) => setTimeout(r, 150));
        push('1-end');
      });
      await Promise.race([p1Entered, p1]);
      const p2 = dbAdapter.withUserCostLock(userId, async () => {
        push('2-start');
        push('2-end');
      });

      await Promise.all([p1, p2]);

      assert.deepEqual(
        events,
        ['1-start', '1-end', '2-start', '2-end'],
        `second caller runs only after first releases the lock; timeline: ${timeline(events, startedAt, eventTimes)}`,
      );
    });

    test('runs concurrent callers for different user ids in parallel', async function (assert) {
      const events: string[] = [];

      const p1 = dbAdapter.withUserCostLock('@alice:localhost', async () => {
        events.push('a-start');
        await new Promise((r) => setTimeout(r, 150));
        events.push('a-end');
      });
      const p2 = dbAdapter.withUserCostLock('@bob:localhost', async () => {
        events.push('b-start');
        await new Promise((r) => setTimeout(r, 20));
        events.push('b-end');
      });

      await Promise.all([p1, p2]);

      // B should complete before A-end because they run in parallel and
      // B's critical section is much shorter.
      const aEndIdx = events.indexOf('a-end');
      const bEndIdx = events.indexOf('b-end');
      assert.ok(
        bEndIdx < aEndIdx,
        `b-end (${bEndIdx}) should come before a-end (${aEndIdx}) under parallel execution; events: ${events.join(',')}`,
      );
    });

    test('releases the lock when the callback throws', async function (assert) {
      const userId = '@alice:localhost';
      await assert.rejects(
        dbAdapter.withUserCostLock(userId, async () => {
          throw new Error('deliberate failure');
        }),
        /deliberate failure/,
      );
      const result = await dbAdapter.withUserCostLock(userId, async () => 'ok');
      assert.strictEqual(result, 'ok', 'lock released after prior failure');
    });

    test('many concurrent same-user callers serialize without overlapping critical sections', async function (assert) {
      // The pool-footprint argument behind the in-process coalescer: N
      // concurrent same-user callers in one process should only ever have
      // ONE of them inside the advisory-lock-held critical section at a
      // time. We assert this by pushing per-caller start/end events: if
      // serialized, the sequence is [a,a,b,b,c,c,...]; if N requests
      // were piling up against the lock (each pinning its own pool
      // client), starts would interleave across callers.
      const userId = '@coalesce:localhost';
      const N = 8;
      const order: number[] = [];
      const work = (i: number) =>
        dbAdapter.withUserCostLock(userId, async () => {
          order.push(i);
          await new Promise((r) => setTimeout(r, 25));
          order.push(i);
          return i;
        });
      const results = await Promise.all(
        Array.from({ length: N }, (_, i) => work(i)),
      );
      assert.deepEqual(
        results,
        Array.from({ length: N }, (_, i) => i),
        'each caller observes its own result',
      );
      for (let i = 0; i < order.length; i += 2) {
        assert.strictEqual(
          order[i],
          order[i + 1],
          `start/end events for one caller are adjacent at ${i}/${i + 1}; full order: ${order.join(',')}`,
        );
      }
    });

    test('a prior caller failing does not poison the in-process chain', async function (assert) {
      // The chain marches on after a failure — the next same-user caller
      // takes its turn instead of inheriting the rejection.
      const userId = '@chain-resilience:localhost';
      await assert.rejects(
        dbAdapter.withUserCostLock(userId, async () => {
          throw new Error('first caller exploded');
        }),
        /first caller exploded/,
      );
      const result = await dbAdapter.withUserCostLock(userId, async () => 'ok');
      assert.strictEqual(result, 'ok');
    });

    test('does not serialize against the realm-write lock', async function (assert) {
      // Even if a user id string equals a realm URL string (it never does
      // in practice, but the namespacing guarantees it), the two lock
      // spaces are disjoint. We prove it by holding a withWriteLock open and
      // running a withUserCostLock on the same string to completion *inside*
      // that window — the cost lock must acquire and finish without waiting
      // for the write lock to release.
      const shared = 'http://localhost:4201/shared/';
      const events: string[] = [];
      const eventTimes: number[] = [];
      const startedAt = Date.now();
      const push = (e: string) => {
        events.push(e);
        eventTimes.push(Date.now());
      };

      // Hold the write lock open until the cost lock has run to completion,
      // rather than holding it for a fixed duration and hoping the cost
      // lock's postgres roundtrip slots inside that window. On slow runners
      // the roundtrip can outlast a fixed window, pushing cost-start past
      // write-end — a scheduling artifact, not a real lock-ordering bug.
      // Gating write-end on the cost lock finishing makes the order depend
      // only on the lock spaces being disjoint, not on postgres latency. If
      // they ever DID serialize, the cost lock would block on the held write
      // lock and the guard below fires with a timeline instead of hanging.
      let signalWriteEntered!: () => void;
      const writeEntered = new Promise<void>((r) => {
        signalWriteEntered = r;
      });
      let releaseWrite!: () => void;
      const writeReleased = new Promise<void>((r) => {
        releaseWrite = r;
      });
      const writePromise = dbAdapter.withWriteLock(shared, async () => {
        push('write-start');
        signalWriteEntered();
        await writeReleased;
        push('write-end');
      });
      // Race the entry signal against the write promise so a pre-entry
      // rejection surfaces immediately instead of hanging the test.
      await Promise.race([writeEntered, writePromise]);

      let guardTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        const costPromise = dbAdapter.withUserCostLock(shared, async () => {
          push('cost-start');
          push('cost-end');
        });
        const guard = new Promise<never>((_resolve, reject) => {
          guardTimer = setTimeout(
            () =>
              reject(
                new Error(
                  `user-cost lock did not acquire while the realm-write lock was held — the lock spaces appear to be serializing; timeline: ${timeline(
                    events,
                    startedAt,
                    eventTimes,
                  )}`,
                ),
              ),
            10_000,
          );
        });
        await Promise.race([costPromise, guard]);
      } finally {
        clearTimeout(guardTimer);
        releaseWrite();
        await writePromise;
      }

      // cost-* slots in between write-start and write-end because the locks
      // are in different namespaces.
      assert.deepEqual(
        events,
        ['write-start', 'cost-start', 'cost-end', 'write-end'],
        `realm-write and user-cost lock spaces are disjoint; timeline: ${timeline(events, startedAt, eventTimes)}`,
      );
    });
  });
});
