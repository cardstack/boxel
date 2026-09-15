import QUnit from 'qunit';
import { basename } from 'node:path';
import { LatticeRealmConfig } from '@cardstack/runtime-common/lattice-config';
import {
  PgAdapter,
  PgQueuePublisher,
  PgQueueRunner,
} from '@cardstack/postgres';
import {
  Deferred,
  expressionToSql,
  type Expression,
  type PgPrimitive,
} from '@cardstack/runtime-common';
import { enqueueLattice } from '@cardstack/runtime-common/jobs/lattice';
import type { LatticeReadScope } from '@cardstack/runtime-common/lattice-work';
import { setupDB } from './helpers/index.ts';

const { module, test } = QUnit;
const realm = 'https://lattice-obligation.example/';
const actor = '@reader:example';

module(basename(import.meta.filename), function (hooks) {
  let db: PgAdapter;
  setupDB(hooks, {
    beforeEach: async (adapter) => {
      db = adapter;
      await db.execute('INSERT INTO realm_metadata(url) VALUES($1)', {
        bind: [realm],
      });
      await db.execute(
        'INSERT INTO realm_user_permissions(realm_url,username,read,write,realm_owner) VALUES($1,$2,TRUE,FALSE,FALSE)',
        { bind: [realm, actor] },
      );
    },
  });
  async function enqueue(
    wave = 0,
    attempt = 0,
    waitForRead?: LatticeReadScope,
    username = 'reader',
  ) {
    await db.withWriteLock('lattice:index:' + realm, async (tx) => {
      if (!tx) throw new Error('Expected transaction');
      await enqueueLattice(tx, realm, username, wave, attempt, waitForRead);
    });
  }
  const pending = () =>
    db.execute(
      "SELECT id,args,created_at::text AS created_at FROM jobs WHERE status='unfulfilled' ORDER BY id",
    );

  test('new work resets an existing wake-up budget without losing its queue position', async (assert) => {
    await enqueue(99, 2);
    const [before] = await pending();
    await enqueue();
    await enqueue(100, 2); // an old retry cannot undo the reset
    const rows = await pending();
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].id, before.id);
    assert.strictEqual(rows[0].created_at, before.created_at);
    assert.deepEqual(rows[0].args, {
      realmURL: realm,
      realmUsername: 'reader',
      wave: 0,
      attempt: 0,
    });
  });

  test('an ordinary wake-up preserves a read wait and different service identities do not coalesce', async (assert) => {
    const waitForRead = { realmURL: realm, actor };
    await enqueue(8, 2, waitForRead);
    await enqueue();
    await enqueue(0, 0, undefined, 'another-service');
    const rows = await pending();
    assert.strictEqual(rows.length, 2);
    assert.deepEqual((rows[0].args as any).latticeWaitForRead, waitForRead);
    assert.strictEqual((rows[0].args as any).attempt, 0);
    assert.notOk((rows[1].args as any).latticeWaitForRead);
  });

  test('a running claim is immutable and only its pending successor is replaced', async (assert) => {
    assert.timeout(10000);
    const runner = new PgQueueRunner({
      adapter: db,
      workerId: 'lattice-immutable',
      lattice: new LatticeRealmConfig([realm]),
      priority: 8,
    });
    const entered = new Deferred<void>();
    const release = new Deferred<void>();
    const completed = new Deferred<void>();
    const calls: any[] = [];
    runner.register('lattice-materialize', async (args: any) => {
      calls.push(args);
      if (calls.length === 1) {
        entered.fulfill();
        await release.promise;
      } else {
        completed.fulfill();
      }
      return {};
    });
    try {
      await enqueue(9, 2);
      await runner.start();
      await entered.promise;
      await enqueue(10, 2);
      await enqueue();
      const rows = await pending();
      assert.strictEqual(rows.length, 2);
      assert.strictEqual((rows[0].args as any).wave, 9);
      assert.strictEqual((rows[0].args as any).attempt, 2);
      assert.strictEqual((rows[1].args as any).wave, 0);
      release.fulfill();
      await completed.promise;
      assert.deepEqual(
        calls.map(({ wave, attempt }) => ({ wave, attempt })),
        [
          { wave: 9, attempt: 2 },
          { wave: 0, attempt: 0 },
        ],
      );
    } finally {
      release.fulfill();
      await runner.destroy();
    }
  });

  test('a claimant racing a coalescing transaction executes the committed new budget', async (assert) => {
    assert.timeout(10000);
    const claiming = new Deferred<void>();
    class ClaimAdapter extends PgAdapter {
      override async withConnection<T>(
        callback: (
          query: (
            expression: Expression,
          ) => Promise<Record<string, PgPrimitive>[]>,
        ) => Promise<T>,
      ): Promise<T> {
        return super.withConnection((query) =>
          callback(async (expression) => {
            if (
              expressionToSql(this.kind, expression).text.startsWith(
                'SELECT pg_advisory_xact_lock(hashtext(',
              )
            )
              claiming.fulfill();
            return query(expression);
          }),
        );
      }
    }
    const adapter = new ClaimAdapter();
    const runner = new PgQueueRunner({
      adapter,
      workerId: 'lattice-merge-race',
      lattice: new LatticeRealmConfig([realm]),
      priority: 8,
    });
    const entered = new Deferred<void>();
    const release = new Deferred<void>();
    const called = new Deferred<any>();
    let merging: Promise<void> | undefined;
    runner.register('lattice-materialize', async (args) => {
      called.fulfill(args);
      return {};
    });
    try {
      await enqueue(99, 2);
      merging = db.withWriteLock('lattice:index:' + realm, async (tx) => {
        if (!tx) throw new Error('Expected transaction');
        await enqueueLattice(
          async (expression) => {
            const rows = await tx(expression);
            // Hold the real row/group locks after selecting the pending job.
            if (
              expressionToSql(db.kind, expression).text.startsWith(
                'SELECT j.id FROM jobs j WHERE j.job_type',
              )
            ) {
              entered.fulfill();
              await release.promise;
            }
            return rows;
          },
          realm,
          'reader',
        );
      });
      await entered.promise;
      await runner.start();
      await claiming.promise;
      release.fulfill();
      await merging;
      const args = await called.promise;
      assert.strictEqual(args.wave, 0);
      assert.strictEqual(args.attempt, 0);
      assert.strictEqual((await db.execute('SELECT id FROM jobs')).length, 1);
    } finally {
      release.fulfill();
      await merging;
      await runner.destroy();
      await adapter.close();
    }
  });

  for (const reason of ['permission', 'archive', 'metadata'] as const) {
    test(`a ${reason} wait survives a runner restart without attempts and wakes after restoration`, async (assert) => {
      assert.timeout(15000);
      if (reason === 'permission')
        await db.execute(
          'UPDATE realm_user_permissions SET read=FALSE WHERE realm_url=$1',
          { bind: [realm] },
        );
      if (reason === 'archive')
        await db.execute(
          'UPDATE realm_metadata SET archived_at=NOW() WHERE url=$1',
          { bind: [realm] },
        );
      if (reason === 'metadata')
        await db.execute('DELETE FROM realm_metadata WHERE url=$1', {
          bind: [realm],
        });
      await enqueue(0, 0, { realmURL: realm, actor });
      const [obligation] = await pending();
      const publisher = new PgQueuePublisher(db);
      const calls: any[] = [];
      const called = new Deferred<number>();
      let runner: PgQueueRunner | undefined;
      try {
        for (let i = 0; i < 2; i++) {
          runner = new PgQueueRunner({
            adapter: db,
            workerId: 'lattice-wait-' + i,
            lattice: new LatticeRealmConfig([realm]),
            priority: 8,
          });
          runner.register('lattice-materialize', async (args) => {
            calls.push(args);
            called.fulfill(performance.now());
            return {};
          });
          runner.register('lattice-progress-probe', async () => ({}));
          const probe = await publisher.publish({
            jobType: 'lattice-progress-probe',
            concurrencyGroup: 'probe:' + i,
            priority: 8,
            timeout: 10,
            args: {},
          });
          await runner.start();
          // A later job really ran. The waiting job was examined, but did not
          // take a reservation or obstruct unrelated work in this worker.
          await probe.done;
          assert.strictEqual(calls.length, 0);
          assert.strictEqual(
            (
              await db.execute(
                'SELECT id FROM job_reservations WHERE job_id=$1',
                { bind: [obligation.id] },
              )
            ).length,
            0,
          );
          if (i === 0) await runner.destroy();
        }
        await db.execute(
          'UPDATE realm_user_permissions SET read=TRUE WHERE realm_url=$1',
          { bind: [realm] },
        );
        if (reason === 'archive')
          await db.execute(
            'UPDATE realm_metadata SET archived_at=NULL WHERE url=$1',
            { bind: [realm] },
          );
        if (reason === 'metadata')
          await db.execute('INSERT INTO realm_metadata(url) VALUES($1)', {
            bind: [realm],
          });
        const restoredAt = performance.now();
        await db.notify('realm_index_updated', realm);
        const startedAt = await called.promise;
        assert.strictEqual(calls.length, 1);
        assert.strictEqual(calls[0].jobInfo.jobId, obligation.id);
        assert.true(
          startedAt - restoredAt < 2500,
          'restoration wakes the same obligation before the polling interval',
        );
      } finally {
        await runner?.destroy();
        await publisher.destroy();
      }
    });
  }
});
