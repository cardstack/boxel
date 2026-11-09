import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import {
  PgAdapter,
  hashFilePathForAdvisoryLock,
  hashRealmUrlForAdvisoryLock,
  hashUserIdForCostLock,
} from '@cardstack/postgres';
import { isWriteLockTimeout } from '@cardstack/runtime-common/card-operations';
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

    test('lets the next writer of one file in as soon as the section releases', async function (assert) {
      // The section's own return is not what the next writer of these files is
      // waiting for — the release is. A write is durable well before it is
      // indexed, and the index wait that follows needs no exclusivity over the
      // files at all; held across it, the Nth concurrent writer of one card
      // waits N index passes rather than one.
      //
      // Both coordination layers have to honour it. The advisory lock is what
      // another replica blocks on, and the in-process queue is what a writer
      // on this one blocks on — a queue that still chained on the whole
      // section would put the same serialization back in memory, invisible to
      // postgres.
      await runInsideWindow(assert, {
        what: 'a second writer of one card runs while the first is still working',
        openOuter: (onEntered, released) =>
          dbAdapter.withFileWriteLocks(
            REALM,
            ['Widget/one.json'],
            async (releaseLocks) => {
              releaseLocks();
              onEntered();
              // Stands in for the index wait: work the section still has to
              // do, with nothing left for the files to protect.
              await released;
            },
          ),
        runInner: () =>
          dbAdapter.withFileWriteLocks(
            REALM,
            ['Widget/one.json'],
            async () => 'ok',
          ),
      });
    });

    test('a released section still reports its own outcome', async function (assert) {
      // Releasing hands the files to the next writer; it does not hand over
      // the section's result. A caller whose write is durable but whose
      // indexing then fails must still hear about the failure, and one that
      // succeeds must still get its value back rather than whatever the
      // transaction returned at release time.
      const value = await dbAdapter.withFileWriteLocks(
        REALM,
        ['Widget/one.json'],
        async (releaseLocks) => {
          releaseLocks();
          await new Promise((r) => setTimeout(r, 25));
          return 42;
        },
      );
      assert.strictEqual(value, 42, 'the value produced after the release');

      let caught: string | undefined;
      try {
        await dbAdapter.withFileWriteLocks(
          REALM,
          ['Widget/one.json'],
          async (releaseLocks) => {
            releaseLocks();
            await new Promise((r) => setTimeout(r, 25));
            throw new Error('indexing blew up');
          },
        );
      } catch (e: any) {
        caught = e?.message;
      }
      assert.strictEqual(
        caught,
        'indexing blew up',
        'and the failure it hit after releasing',
      );

      // The chain is what the next writer of these files waits on, so a
      // section that failed after releasing must have left it resolved rather
      // than holding the queue open behind a rejection nobody consumes.
      assert.strictEqual(
        await dbAdapter.withFileWriteLocks(
          REALM,
          ['Widget/one.json'],
          async () => 'after',
        ),
        'after',
        'and the next writer of the same file is not stranded behind it',
      );
    });

    test('a section that fails before releasing excludes the next writer until it unwinds', async function (assert) {
      // The release is the only thing that ends the section early. A failure
      // on the way to it — a refusal while staging, a write that cannot open
      // its file — unwinds through the same rollback it always did, and the
      // next writer of the file sees the realm as that section left it rather
      // than part-way through.
      const events: string[] = [];
      let signalEntered!: () => void;
      const entered = new Promise<void>((r) => {
        signalEntered = r;
      });
      const first = dbAdapter
        .withFileWriteLocks(REALM, ['Widget/one.json'], async () => {
          events.push('1-start');
          signalEntered();
          await new Promise((r) => setTimeout(r, 150));
          events.push('1-threw');
          throw new Error('staging refused');
        })
        .catch(() => undefined);
      await Promise.race([entered, first]);
      const second = dbAdapter.withFileWriteLocks(
        REALM,
        ['Widget/one.json'],
        async () => {
          events.push('2-start');
        },
      );

      await Promise.all([first, second]);

      assert.deepEqual(
        events,
        ['1-start', '1-threw', '2-start'],
        'the next writer waits for the whole of a section that never released',
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

  module('bounded write-lock wait', function (hooks) {
    let dbAdapter: PgAdapter;
    let extraAdapters: PgAdapter[] = [];
    setupDB(hooks, {
      beforeEach: async (adapter) => {
        dbAdapter = adapter;
      },
      afterEach: async () => {
        // Detached before closing, so a test that hangs and is torn down
        // twice does not close the same adapters again.
        let adapters = extraAdapters;
        extraAdapters = [];
        for (let adapter of adapters) {
          await adapter.close();
        }
      },
    });

    const REALM = 'http://localhost:4201/bounded/';
    const WAIT_MS = 300;

    // An adapter with a short write-lock budget, and optionally a small pool.
    // The pool size is read from the environment when the adapter is built,
    // which is the only knob it has.
    function boundedAdapter(opts: { poolMax?: number } = {}): PgAdapter {
      let previous = process.env.PG_POOL_MAX;
      if (opts.poolMax !== undefined) {
        process.env.PG_POOL_MAX = String(opts.poolMax);
      }
      try {
        let adapter = new PgAdapter({ writeLockWaitMs: WAIT_MS });
        extraAdapters.push(adapter);
        return adapter;
      } finally {
        if (previous === undefined) {
          delete process.env.PG_POOL_MAX;
        } else {
          process.env.PG_POOL_MAX = previous;
        }
      }
    }

    // Hold a lock section open on `adapter` until the returned `release` is
    // called. Resolves once the section is inside its locks.
    async function holdOpen(
      take: (fn: () => Promise<void>) => Promise<unknown>,
    ): Promise<{ release: () => void; done: Promise<unknown> }> {
      let release!: () => void;
      const released = new Promise<void>((r) => {
        release = r;
      });
      let signalEntered!: () => void;
      const entered = new Promise<void>((r) => {
        signalEntered = r;
      });
      const done = take(async () => {
        signalEntered();
        await released;
      });
      await Promise.race([entered, done]);
      return { release, done };
    }

    async function rejection(promise: Promise<unknown>): Promise<unknown> {
      try {
        await promise;
      } catch (err: unknown) {
        return err;
      }
      return undefined;
    }

    test('a file writer that waits out its budget is refused without running', async function (assert) {
      const holder = await holdOpen((fn) =>
        dbAdapter.withFileWriteLocks(REALM, ['Widget/one.json'], fn),
      );
      // A second adapter, as a second replica would be: it shares the lock
      // space and none of the first one's in-process queue, so its writer
      // waits in postgres.
      const waiter = boundedAdapter();
      let ran = false;
      const startedAt = Date.now();
      try {
        const err = await rejection(
          waiter.withFileWriteLocks(REALM, ['Widget/one.json'], async () => {
            ran = true;
          }),
        );
        const elapsed = Date.now() - startedAt;
        assert.true(
          isWriteLockTimeout(err),
          `refused as a write-lock timeout (got ${String(err)})`,
        );
        assert.false(ran, 'the section never ran');
        assert.true(
          elapsed >= WAIT_MS - 50,
          `waited out its budget before giving up (${elapsed} ms)`,
        );
        assert.true(
          elapsed < WAIT_MS + 2000,
          `gave up soon after its budget (${elapsed} ms)`,
        );
        assert.strictEqual(
          waiter.connectionStats.inUse,
          0,
          'the refused writer gave its pooled connection back',
        );
      } finally {
        holder.release();
        await holder.done;
      }
      const after = await waiter.withFileWriteLocks(
        REALM,
        ['Widget/one.json'],
        async () => 'written',
      );
      assert.strictEqual(after, 'written', 'the next writer gets the lock');
    });

    test('a realm-lifecycle caller that waits out its budget is refused without running', async function (assert) {
      const holder = await holdOpen((fn) =>
        dbAdapter.withFileWriteLocks(REALM, ['Widget/one.json'], fn),
      );
      const waiter = boundedAdapter();
      let ran = false;
      try {
        const err = await rejection(
          waiter.withWriteLock(REALM, async () => {
            ran = true;
          }),
        );
        assert.true(
          isWriteLockTimeout(err),
          `refused as a write-lock timeout (got ${String(err)})`,
        );
        assert.false(ran, 'the section never ran');
      } finally {
        holder.release();
        await holder.done;
      }
    });

    test('the budget lifts once the realm lock is held', async function (assert) {
      // The bound is on queueing for the lock. Statements the section runs on
      // its pinned querier afterwards wait on row locks as long as they need,
      // so a section is not cut short by a budget it already spent waiting.
      // The lock is contended, so the caller has to wait for it and sets the
      // timeout before it does.
      const holder = await holdOpen((fn) =>
        dbAdapter.withFileWriteLocks(REALM, ['Widget/one.json'], fn),
      );
      const adapter = boundedAdapter();
      const waited = adapter.withWriteLock(REALM, async (txQuerier) => {
        const rows = await txQuerier!(['SHOW lock_timeout']);
        return rows[0]?.lock_timeout;
      });
      await new Promise((r) => setTimeout(r, WAIT_MS / 3));
      holder.release();
      await holder.done;
      const timeout = await waited;
      const baseline = (await adapter.execute('SHOW lock_timeout'))[0]
        ?.lock_timeout;
      assert.strictEqual(
        timeout,
        baseline,
        'the section runs under the session default lock_timeout',
      );
    });

    test('a writer queued in memory behind a same-file writer is refused when its budget runs out', async function (assert) {
      // Both writers on one adapter chain in its in-process queue, so the
      // second never reaches postgres while the first holds the file. It is
      // refused when its budget runs out there — while the holder still holds,
      // not when the holder finishes — and never checks out a connection.
      const adapter = boundedAdapter();
      const holder = await holdOpen((fn) =>
        adapter.withFileWriteLocks(REALM, ['Widget/one.json'], fn),
      );
      let guardTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        const startedAt = Date.now();
        let ran = false;
        const queued = rejection(
          adapter.withFileWriteLocks(REALM, ['Widget/one.json'], async () => {
            ran = true;
          }),
        );
        const guard = new Promise<'still waiting'>((resolve) => {
          guardTimer = setTimeout(() => resolve('still waiting'), 5000);
        });
        const err = await Promise.race([queued, guard]);
        assert.true(
          isWriteLockTimeout(err),
          `refused as a write-lock timeout while the holder still held (got ${String(err)})`,
        );
        assert.true(
          Date.now() - startedAt < WAIT_MS + 2000,
          `refused at its budget (${Date.now() - startedAt} ms)`,
        );
        assert.false(ran, 'the section never ran');
        assert.strictEqual(
          adapter.connectionStats.inUse,
          1,
          'only the holder ever had a connection',
        );
      } finally {
        clearTimeout(guardTimer);
        holder.release();
        await holder.done;
      }
    });

    test('a writer behind one that gave up in the queue still waits in memory', async function (assert) {
      // The third writer of a file set chains on the second. If the second
      // gives up in the queue while the first still holds, the third must not
      // take that as the files coming free: it would go to postgres and wait
      // there behind the holder with a connection checked out. It stays in
      // memory until the holder is done, and then takes the lock.
      const adapter = boundedAdapter();
      const holder = await holdOpen((fn) =>
        adapter.withFileWriteLocks(REALM, ['Widget/one.json'], fn),
      );
      try {
        const second = rejection(
          adapter.withFileWriteLocks(
            REALM,
            ['Widget/one.json'],
            async () => {},
          ),
        );
        // Queued after the second has used part of its budget, so the second
        // gives up first and the third still has budget left when it does.
        await new Promise((r) => setTimeout(r, WAIT_MS / 2));
        const third = adapter.withFileWriteLocks(
          REALM,
          ['Widget/one.json'],
          async () => 'wrote',
        );
        assert.true(
          isWriteLockTimeout(await second),
          'the second writer gave up in the queue',
        );
        assert.strictEqual(
          adapter.connectionStats.inUse,
          1,
          'the third writer is still waiting in memory, not in postgres',
        );
        holder.release();
        await holder.done;
        const err = await rejection(third);
        const settledCleanly = err === undefined || isWriteLockTimeout(err);
        assert.true(
          settledCleanly,
          `the third writer either wrote or gave up at its own budget (got ${String(err)})`,
        );
      } finally {
        holder.release();
        await holder.done;
      }
    });

    test('lock waiters that fill the pool cannot wedge a holder that needs one more connection', async function (assert) {
      // The shape that hangs a replica: a realm-lifecycle caller holds the
      // realm exclusively, every file writer that arrives queues behind it in
      // postgres holding a pooled connection, and the holder then needs a
      // connection of its own to finish. With every connection held by a
      // waiter and no waiter able to proceed, nothing ever frees one. A
      // bounded wait frees them: each waiter gives up and returns its
      // connection, the holder gets one and commits, and the realm answers
      // again.
      const POOL_MAX = 4;
      const WRITERS = 8;
      const adapter = boundedAdapter({ poolMax: POOL_MAX });
      let signalHolding!: () => void;
      const holding = new Promise<void>((r) => {
        signalHolding = r;
      });
      const holder = adapter.withWriteLock(REALM, async () => {
        signalHolding();
        // Let the writers queue up behind the realm lock and take the pool.
        await new Promise((r) => setTimeout(r, 100));
        // The read the holder needs through the shared adapter.
        await adapter.execute('SELECT 1');
        return 'committed';
      });
      await Promise.race([holding, holder]);
      const writers = Array.from({ length: WRITERS }, (_, i) =>
        adapter
          .withFileWriteLocks(REALM, [`Widget/${i}.json`], async () => 'wrote')
          .catch((err: unknown) => (isWriteLockTimeout(err) ? 'refused' : err)),
      );

      let guardTimer: ReturnType<typeof setTimeout> | undefined;
      const guard = new Promise<'wedged'>((resolve) => {
        guardTimer = setTimeout(() => resolve('wedged'), 10_000);
      });
      try {
        const outcome = await Promise.race([
          Promise.all([holder, ...writers]),
          guard,
        ]);
        assert.notStrictEqual(
          outcome,
          'wedged',
          `the holder and every writer settled (pool: ${JSON.stringify(adapter.connectionStats)})`,
        );
        if (outcome !== 'wedged') {
          const [holderOutcome, ...writerOutcomes] = outcome;
          assert.strictEqual(holderOutcome, 'committed', 'the holder commits');
          for (const result of writerOutcomes) {
            assert.true(
              ['wrote', 'refused'].includes(result as string),
              `each writer either wrote or was refused (got ${String(result)})`,
            );
          }
          const later = await adapter.execute('SELECT 1 AS answered');
          assert.strictEqual(
            later[0]?.answered,
            1,
            'a later request still gets a connection',
          );
        }
      } finally {
        clearTimeout(guardTimer);
      }
    });
  });
});
