import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { PgAdapter } from '@cardstack/postgres';
import {
  claimHostShellGeneration,
  currentHostShellGeneration,
  NO_HOST_SHELL_OBSERVED,
  param,
  type HostShellGeneration,
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
});
