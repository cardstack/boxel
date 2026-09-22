import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { PgAdapter } from '@cardstack/postgres';
import {
  claimHostShellGeneration,
  currentHostShellGeneration,
  dbAdapterQuerier,
  NO_HOST_SHELL_OBSERVED,
  param,
  reportableHostShellGeneration,
  type HostShellGeneration,
  type Querier,
} from '@cardstack/runtime-common';
import { setupDB } from './helpers/index.ts';

// The ordering that lets a row be asked whether it was rendered before or
// after the shell currently being served. A hash can only answer "same or
// different", which is why this exists; see `host-shell-generation.ts`.
module(basename(import.meta.filename), function (hooks) {
  let dbAdapter: PgAdapter;

  setupDB(hooks, {
    beforeEach: async (adapter) => {
      dbAdapter = adapter;
    },
  });

  test('a fresh database has observed no shell', async function (assert) {
    let current = await currentHostShellGeneration(dbAdapter);
    assert.deepEqual(
      current,
      { generation: NO_HOST_SHELL_OBSERVED, shellHash: '' },
      'the seeded row reads as "nothing observed" rather than as a shell',
    );
  });

  test('the first shell observed takes the first generation', async function (assert) {
    let claimed = await claimHostShellGeneration(dbAdapter, 'aaaaaaaa', 1000);
    assert.deepEqual(claimed, { generation: 1, shellHash: 'aaaaaaaa' });
    assert.deepEqual(
      await currentHostShellGeneration(dbAdapter),
      { generation: 1, shellHash: 'aaaaaaaa' },
      'and is what a reader sees as current',
    );
  });

  test('re-reporting the current shell does not advance it', async function (assert) {
    await claimHostShellGeneration(dbAdapter, 'aaaaaaaa', 1000);
    // Every realm server reports on boot and again from the post-deployment
    // hook, so repeat claims for one shell are the normal case, not a corner.
    for (let attempt of [1, 2, 3]) {
      let claimed = await claimHostShellGeneration(dbAdapter, 'aaaaaaaa', 2000);
      assert.strictEqual(
        claimed.generation,
        1,
        `report ${attempt} reads back the same generation`,
      );
    }
  });

  test('each new shell advances the generation', async function (assert) {
    assert.strictEqual(
      (await claimHostShellGeneration(dbAdapter, 'aaaaaaaa', 1000)).generation,
      1,
    );
    assert.strictEqual(
      (await claimHostShellGeneration(dbAdapter, 'bbbbbbbb', 2000)).generation,
      2,
    );
    assert.strictEqual(
      (await claimHostShellGeneration(dbAdapter, 'cccccccc', 3000)).generation,
      3,
    );
  });

  // The case that rules out deriving the ordering from the artifact itself: a
  // rollback deploys a bundle that ran before, so anything read off the
  // artifact would go backwards. A generation records *when* a render
  // happened, so returning to an earlier bundle is a later generation.
  test('rolling back to an earlier shell moves the generation forward', async function (assert) {
    await claimHostShellGeneration(dbAdapter, 'aaaaaaaa', 1000);
    await claimHostShellGeneration(dbAdapter, 'bbbbbbbb', 2000);

    let rolledBack = await claimHostShellGeneration(
      dbAdapter,
      'aaaaaaaa',
      3000,
    );
    assert.deepEqual(
      rolledBack,
      { generation: 3, shellHash: 'aaaaaaaa' },
      'the old bundle is a new generation, not the one it had before',
    );
    // What this buys: rows rendered during the bundle just rolled away from
    // are below the current generation, so a repair can find them. Had the
    // rollback reused generation 1, those rows would have been *above* the
    // current generation and invisible to it.
    assert.true(
      2 < rolledBack.generation,
      'rows from the rolled-back bundle are selectable as stale',
    );
  });

  // A rolling deploy has several realm-server tasks computing the same hash and
  // reporting it at once, so this is the ordinary case rather than a corner.
  // Note that it does not discriminate between this implementation and a
  // read-then-write — claimants of one shell all compute the same successor
  // either way. The test below it is the one that does.
  test('concurrent first claims of one shell agree on its generation', async function (assert) {
    let claims = await Promise.all(
      Array.from({ length: 8 }, () =>
        claimHostShellGeneration(dbAdapter, 'bbbbbbbb', 5000),
      ),
    );

    assert.deepEqual(
      [...new Set(claims.map((c) => c.generation))],
      [1],
      'every concurrent claimant reports the same generation',
    );
    assert.deepEqual(
      await currentHostShellGeneration(dbAdapter),
      { generation: 1, shellHash: 'bbbbbbbb' },
      'and the shell advanced exactly once',
    );
  });

  // The property that makes a single UPDATE the right shape, tested against a
  // real lock wait rather than a hopeful `Promise.all`. A claim for a
  // different shell has to arrive *while* another transition is uncommitted;
  // that is when a read-then-write reads a generation that is about to be
  // superseded, and writes its own shell over the transition it never saw.
  //
  // Deterministic because the commit waits for the second claim to actually be
  // blocked on the row — asked of `pg_stat_activity`, not of a clock.
  test('a claim arriving mid-transition counts the transition it missed', async function (assert) {
    let blocked: Promise<HostShellGeneration> | undefined;

    await dbAdapter.withConnection(async (query) => {
      await query(['BEGIN']);
      await query([
        `UPDATE host_shell_generation SET shell_hash = `,
        param('aaaaaaaa'),
        `, generation = generation + 1, observed_at = 1000
         WHERE id = 1 AND shell_hash <> `,
        param('aaaaaaaa'),
      ]);
      // Uncommitted, so the row is locked and a competing claim must wait.
      blocked = claimHostShellGeneration(dbAdapter, 'bbbbbbbb', 2000);
      await waitForLockWait();
      await query(['COMMIT']);
    });

    assert.deepEqual(
      await blocked!,
      { generation: 2, shellHash: 'bbbbbbbb' },
      'both transitions are counted, so the two shells keep distinct generations',
    );
  });

  // Wait until some backend on this database is blocked on a lock. Polls the
  // server's own view of who is waiting, so it reports the state the test
  // needs rather than guessing at how long to sleep for it.
  async function waitForLockWait(): Promise<void> {
    for (let attempt = 0; attempt < 200; attempt++) {
      let waiting = await dbAdapter.execute(
        `SELECT count(*)::int AS waiting FROM pg_stat_activity
         WHERE datname = current_database()
           AND wait_event_type = 'Lock'
           AND pid <> pg_backend_pid()`,
      );
      if (Number(waiting[0]?.waiting ?? 0) > 0) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(
      'no backend ever blocked on the row lock, so this test never created the overlap it asserts about',
    );
  }

  // The contract a caller depends on: the answer describes the shell that was
  // asked about. Anything else lets a render be stamped with another shell's
  // number, which is the ordering failing in the one situation it exists for.
  test('the answer always describes the shell that was claimed', async function (assert) {
    for (let hash of ['aaaaaaaa', 'bbbbbbbb', 'aaaaaaaa', 'cccccccc']) {
      let claimed = await claimHostShellGeneration(dbAdapter, hash, 1000);
      assert.strictEqual(
        claimed.shellHash,
        hash,
        `claiming ${hash} reported ${claimed.shellHash}`,
      );
    }
  });

  // Drives the gap directly rather than hoping to hit it. A querier that lets
  // another shell be claimed *after* the claim's own statement runs is exactly
  // the interleaving a second read-back query would have been exposed to: the
  // lock is released by then, so the row has moved on. One statement has
  // nothing to interpose on, so the claim still answers about its own shell.
  test('a competing claim landing after the statement cannot change the answer', async function (assert) {
    await claimHostShellGeneration(dbAdapter, 'aaaaaaaa', 1000);

    let interposed = false;
    let interposing: Querier = async (expression) => {
      let rows = await dbAdapterQuerier(dbAdapter)(expression);
      if (!interposed) {
        interposed = true;
        // A different shell wins the row the instant this claim lets go of it.
        await claimHostShellGeneration(dbAdapter, 'bbbbbbbb', 2000);
      }
      return rows;
    };

    let claimed = await claimHostShellGeneration(
      dbAdapter,
      'aaaaaaaa',
      3000,
      interposing,
    );
    assert.true(interposed, 'the competing claim really did run');
    assert.strictEqual(
      claimed.shellHash,
      'aaaaaaaa',
      'answers about the shell it was asked about, not the one that overtook it',
    );
    assert.deepEqual(
      await currentHostShellGeneration(dbAdapter),
      { generation: 2, shellHash: 'bbbbbbbb' },
      'and the competing claim is what the row now holds',
    );
  });

  // The case the no-throw comment names, and the one the zero-row guard cannot
  // reach: a database with no such table at all. Reachable two ways — a
  // database predating the migration, and the browser's SQLite, which the
  // schema dump deliberately excludes this table from. Both must yield the
  // sentinel rather than propagate, because the intent stated at these
  // functions is that a boot sequence never fails for a diagnostic.
  test('a database without the table reports nothing observed', async function (assert) {
    await dbAdapter.execute('DROP TABLE host_shell_generation');

    assert.deepEqual(
      await currentHostShellGeneration(dbAdapter),
      { generation: NO_HOST_SHELL_OBSERVED, shellHash: '' },
      'the read reports no ordering rather than throwing',
    );
    assert.deepEqual(
      await claimHostShellGeneration(dbAdapter, 'aaaaaaaa', 1000),
      { generation: NO_HOST_SHELL_OBSERVED, shellHash: '' },
      'and so does the claim',
    );
  });

  // Narrow on purpose: only the missing table is absorbed. A fault a caller
  // should hear about still propagates.
  test('any other failure still propagates', async function (assert) {
    let broken: Querier = async () => {
      throw Object.assign(new Error('permission denied for table'), {
        code: '42501',
      });
    };
    await assert.rejects(
      claimHostShellGeneration(dbAdapter, 'aaaaaaaa', 1000, broken),
      /permission denied/,
      'a permissions failure is not mistaken for an absent table',
    );
  });

  test('the singleton constraint keeps a second row out', async function (assert) {
    await assert.rejects(
      dbAdapter.execute(
        `INSERT INTO host_shell_generation (id, shell_hash, generation, observed_at)
         VALUES (2, 'cccccccc', 99, 0)`,
      ),
      /host_shell_generation_singleton/,
      'the table holds the current shell, so a second row is a bug not a record',
    );
  });

  // The filter between a claim and what gets reported. The claim deliberately
  // answers rather than throwing when it cannot order anything, and that
  // answer is a well-formed number that would otherwise travel the whole path
  // unnoticed.
  module('reportableHostShellGeneration', function () {
    test('a real claim is reported as it stands', function (assert) {
      assert.strictEqual(
        reportableHostShellGeneration(
          { generation: 4, shellHash: 'aaaaaaaa' },
          'aaaaaaaa',
        ),
        4,
      );
    });

    // The bug this exists to stop. Generation 0 is the seeded "no shell
    // observed" sentinel, returned when the table is absent or its row has
    // gone. Reported as a number it would be stamped onto rows, and every
    // later `host_shell_generation < current` repair would treat them as older
    // than everything there is.
    test('the no-observation sentinel is reported as nothing, not as zero', function (assert) {
      assert.strictEqual(
        reportableHostShellGeneration(
          { generation: NO_HOST_SHELL_OBSERVED, shellHash: '' },
          'aaaaaaaa',
        ),
        undefined,
      );
    });

    // Should not happen — the claim returns the row it observed under the lock
    // — but a number that orders a bundle this render did not run is worse
    // than no number at all.
    test('a claim describing another shell is not reported', function (assert) {
      assert.strictEqual(
        reportableHostShellGeneration(
          { generation: 4, shellHash: 'bbbbbbbb' },
          'aaaaaaaa',
        ),
        undefined,
      );
    });

    test('the value a real claim returns passes its own filter', async function (assert) {
      let claimed = await claimHostShellGeneration(dbAdapter, 'aaaaaaaa', 1000);
      assert.strictEqual(
        reportableHostShellGeneration(claimed, 'aaaaaaaa'),
        1,
        'the filter must not reject the ordinary case it sits in front of',
      );
    });
  });

  // What the ordering exists for: selecting the index rows a bundle that is no
  // longer served produced. The tokens on those rows cannot answer this — they
  // are hashes — so the column the render stamps is the only thing that can.
  module('selecting the rows a deploy left behind', function (hooks) {
    const REALM = 'https://example.com/r/';
    // Seeded shells, so `current` below is a real claim rather than a literal.
    hooks.beforeEach(async function () {
      await claimHostShellGeneration(dbAdapter, 'aaaaaaaa', 1000);
      await claimHostShellGeneration(dbAdapter, 'bbbbbbbb', 2000);
      let seed = async (name: string, hostShellGeneration: number | null) => {
        await dbAdapter.execute(
          `INSERT INTO boxel_index
             (url, file_alias, type, generation, realm_url, host_shell_generation)
           VALUES ($1, $2, 'instance', 1, $3, $4)`,
          {
            bind: [
              `${REALM}${name}.json`,
              `${REALM}${name}`,
              REALM,
              hostShellGeneration,
            ],
          },
        );
      };
      await seed('old-1', 1);
      await seed('old-2', 1);
      await seed('current', 2);
      await seed('unknown', null);
    });

    test('returns every row below the current shell, and only those', async function (assert) {
      let { generation: current } = await currentHostShellGeneration(dbAdapter);
      assert.strictEqual(current, 2, 'two shells have been observed');

      let stale = await dbAdapter.execute(
        `SELECT url FROM boxel_index
         WHERE realm_url = $1 AND host_shell_generation < $2
         ORDER BY url`,
        { bind: [REALM, current] },
      );
      assert.deepEqual(
        stale.map((r) => r.url),
        [`${REALM}old-1.json`, `${REALM}old-2.json`],
        'both rows from the outgoing bundle, and neither the current one nor the unstamped one',
      );
    });

    // The distinction the column's nullability carries. A render that reported
    // no generation is unknown, not old, and a repair that swept those in
    // would re-render the whole index the first time it ran. `<` excludes NULL
    // by SQL's own semantics, so this holds without a guard — and would stop
    // holding the moment someone backfilled a zero.
    test('leaves an unstamped row out rather than treating it as ancient', async function (assert) {
      let unknown = await dbAdapter.execute(
        `SELECT url FROM boxel_index
         WHERE realm_url = $1 AND host_shell_generation IS NULL`,
        { bind: [REALM] },
      );
      assert.deepEqual(
        unknown.map((r) => r.url),
        [`${REALM}unknown.json`],
        'the row exists',
      );
      let sweptIn = await dbAdapter.execute(
        `SELECT count(*)::int AS n FROM boxel_index
         WHERE realm_url = $1 AND host_shell_generation < 2147483647`,
        { bind: [REALM] },
      );
      assert.strictEqual(
        sweptIn[0].n,
        3,
        'even an absurdly high current generation reaches only the stamped rows',
      );
    });

    // The predicate is a range scan over the largest table in the schema, so
    // the column exists to be indexed rather than merely stored.
    //
    // Issued in the repair's own shape — realm equality plus the generation
    // range — rather than on the generation alone. That is what makes the plan
    // discriminate: a generation-only index also satisfies the narrower
    // predicate, so testing that one would confirm an index the repair never
    // walks and would stay green if the key order stopped serving it.
    //
    // Asserted with sequential scans disabled, because on four seeded rows the
    // planner would choose one whatever indexes exist — so a plan taken at
    // face value here would pass with no index at all. Disabling it asks the
    // question that is actually about this change: is there an index this
    // predicate can walk? `SET LOCAL` reverts with the transaction, and
    // `withConnection` rolls back on a throw, so the pooled connection is
    // returned clean either way.
    test('has an index to walk', async function (assert) {
      let plan = await dbAdapter.withConnection(async (query) => {
        await query(['BEGIN']);
        await query(['SET LOCAL enable_seqscan = off']);
        let rows = await query([
          `EXPLAIN (FORMAT JSON) SELECT url FROM boxel_index WHERE realm_url = `,
          param(REALM),
          ` AND host_shell_generation < `,
          param(2),
        ]);
        await query(['COMMIT']);
        return JSON.stringify(rows);
      });
      assert.ok(
        plan.includes('boxel_index_host_shell_generation_index'),
        `the repair's predicate should resolve through the partial index; got: ${plan}`,
      );
    });
  });
});
