import QUnit from 'qunit';
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
import { setupDB } from './helpers/index.ts';

const { module, test } = QUnit;

// Observe a real unsuccessful claim without replacing any database results.
// Waiting for its rollback makes the notification race deterministic: the
// source runner has already found the owner's concurrency group occupied.
class ClaimObservingAdapter extends PgAdapter {
  blockedClaim = new Deferred<void>();

  override async withConnection<T>(
    callback: (
      query: (expression: Expression) => Promise<Record<string, PgPrimitive>[]>,
    ) => Promise<T>,
  ): Promise<T> {
    return await super.withConnection(async (query) => {
      let blocked = false;
      return await callback(async (expression) => {
        let rows = await query(expression);
        let { text } = expressionToSql(this.kind, expression);
        if (text.includes('active_concurrency_groups') && rows.length === 0) {
          blocked = true;
        }
        if (blocked && text === 'ROLLBACK') {
          this.blockedClaim.fulfill();
        }
        return rows;
      });
    });
  }
}

module('Lattice | queue completion wakeup', function (hooks) {
  let db: PgAdapter;
  setupDB(hooks, {
    templateDatabase: process.env.LATTICE_TEST_TEMPLATE_DB,
    beforeEach: async (adapter) => {
      db = adapter;
    },
  });

  test('releasing a Lattice owner promptly wakes a blocked source runner', async function (assert) {
    assert.timeout(20_000);
    let sourceAdapter = new ClaimObservingAdapter();
    let publisher = new PgQueuePublisher(db);
    let ownerRunner = new PgQueueRunner({
      adapter: db,
      workerId: 'lattice-wakeup-owner',
      lattice: new LatticeRealmConfig(['https://lattice-wakeup.example/']),
      priority: 8,
    });
    let sourceRunner = new PgQueueRunner({
      adapter: sourceAdapter,
      workerId: 'lattice-wakeup-source',
      lattice: new LatticeRealmConfig(['https://lattice-wakeup.example/']),
      priority: 10,
    });
    let ownerEntered = new Deferred<void>();
    let releaseOwner = new Deferred<void>();
    let sourceEntered = new Deferred<number>();
    let ownerRunning = false;
    let sourceRunning = false;
    let order: string[] = [];
    ownerRunner.register('lattice-materialize', async () => {
      ownerRunning = true;
      order.push('owner');
      ownerEntered.fulfill();
      await releaseOwner.promise;
      ownerRunning = false;
      return {};
    });
    sourceRunner.register('incremental-index', async () => {
      sourceRunning = true;
      order.push('source');
      sourceEntered.fulfill(performance.now());
      return {};
    });
    try {
      let owner = await publisher.publish({
        jobType: 'lattice-materialize',
        priority: 8,
        concurrencyGroup: 'indexing:https://lattice-wakeup.example/',
        timeout: 20,
        args: { realmURL: 'https://lattice-wakeup.example/' },
      });
      await ownerRunner.start();
      await ownerEntered.promise;
      let source = await publisher.publish({
        jobType: 'incremental-index',
        priority: 10,
        concurrencyGroup: 'indexing:https://lattice-wakeup.example/',
        timeout: 20,
        args: { realmURL: 'https://lattice-wakeup.example/' },
      });
      await sourceRunner.start();
      await sourceAdapter.blockedClaim.promise;
      assert.true(ownerRunning, 'the owner still holds the realm group');
      assert.false(sourceRunning, 'the source did not overlap the owner');

      let releasedAt = performance.now();
      releaseOwner.fulfill();
      let startedAt = await sourceEntered.promise;
      assert.true(
        startedAt - releasedAt < 2500,
        `the source wakes on completion instead of the 10s poll (${Math.round(startedAt - releasedAt)}ms)`,
      );
      await Promise.all([owner.done, source.done]);
      assert.deepEqual(order, ['owner', 'source']);
    } finally {
      releaseOwner.fulfill();
      await Promise.all([ownerRunner.destroy(), sourceRunner.destroy()]);
      await publisher.destroy();
      await sourceAdapter.close();
    }
  });

  test('a Lattice claim retries a real serialization conflict without waiting for the polling timer', async function (assert) {
    assert.timeout(20_000);
    let injected = false;
    let conflicts = 0;
    class ConflictingClaimAdapter extends PgAdapter {
      override async withConnection<T>(
        callback: (
          query: (
            expression: Expression,
          ) => Promise<Record<string, PgPrimitive>[]>,
        ) => Promise<T>,
      ): Promise<T> {
        return super.withConnection((query) =>
          callback(async (expression) => {
            try {
              let rows = await query(expression);
              let { text } = expressionToSql(this.kind, expression);
              if (
                !injected &&
                text.includes('active_concurrency_groups') &&
                rows.length
              ) {
                injected = true;
                // A second real transaction changes the row after the claim's
                // SERIALIZABLE snapshot read, before SELECT FOR UPDATE.
                await db.execute('UPDATE jobs SET args = args WHERE id = $1', {
                  bind: [rows[0].id],
                });
              }
              return rows;
            } catch (error) {
              if ((error as { code?: string }).code === '40001') conflicts++;
              throw error;
            }
          }),
        );
      }
    }
    let adapter = new ConflictingClaimAdapter();
    let publisher = new PgQueuePublisher(db);
    let runner = new PgQueueRunner({
      adapter,
      workerId: 'lattice-claim-retry',
      lattice: new LatticeRealmConfig(['https://lattice-claim.example/']),
      priority: 8,
    });
    let entered = new Deferred<number>();
    runner.register('lattice-materialize', async () => {
      entered.fulfill(performance.now());
      return {};
    });
    try {
      let job = await publisher.publish({
        jobType: 'lattice-materialize',
        priority: 8,
        concurrencyGroup: 'indexing:https://lattice-claim.example/',
        timeout: 20,
        args: { realmURL: 'https://lattice-claim.example/' },
      });
      let start = performance.now();
      await runner.start();
      let elapsed = (await entered.promise) - start;
      assert.true(injected);
      assert.strictEqual(
        conflicts,
        1,
        'the database rejected exactly one claim',
      );
      assert.true(elapsed < 2500, `claim retried in ${Math.round(elapsed)}ms`);
      await job.done;
    } finally {
      await runner.destroy();
      await publisher.destroy();
      await adapter.close();
    }
  });
});
