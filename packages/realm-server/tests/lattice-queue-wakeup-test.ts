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

module(basename(import.meta.filename), function (hooks) {
  let db: PgAdapter;
  setupDB(hooks, {
    templateDatabase: process.env.LATTICE_TEST_TEMPLATE_DB,
    beforeEach: async (adapter) => {
      db = adapter;
    },
  });

  test('a background collection window wakes at its deadline without another write', async function (assert) {
    assert.timeout(15_000);
    const realm = 'https://lattice-window.example/';
    const adapter = new ClaimObservingAdapter();
    const publisher = new PgQueuePublisher(db);
    const runner = new PgQueueRunner({
      adapter,
      workerId: 'window',
      lattice: new LatticeRealmConfig([realm]),
    });
    runner.register('incremental-index', async () => ({}));
    try {
      const job = await publisher.publish({
        jobType: 'incremental-index',
        concurrencyGroup: `indexing:${realm}`,
        priority: 10,
        timeout: 10,
        args: {
          realmURL: realm,
          latticeBatch: {
            atomic: false,
            admittedAtMs: Date.now(),
            immediate: false,
          },
        },
      });
      await runner.start();
      await adapter.blockedClaim.promise;
      const reservations = await db.execute(
        'SELECT id FROM job_reservations WHERE job_id=$1',
        { bind: [job.id] },
      );
      assert.strictEqual(
        reservations.length,
        0,
        'collection does not reserve a worker',
      );
      await db.execute(
        "UPDATE jobs SET created_at=clock_timestamp()-interval '4.5 seconds' WHERE id=$1",
        { bind: [job.id] },
      );
      await db.execute('NOTIFY jobs');
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          job.done,
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(new Error('deadline did not wake the worker')),
              3000,
            );
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
      assert.ok(
        true,
        'deadline runs the batch without waiting for the normal ten-second poll',
      );
    } finally {
      await runner.destroy();
      await publisher.destroy();
      await adapter.close();
    }
  });

  test('an immediate waiter releases its existing collection window', async function (assert) {
    assert.timeout(15_000);
    const realm = 'https://lattice-immediate.example/';
    const adapter = new ClaimObservingAdapter();
    const publisher = new PgQueuePublisher(db);
    const runner = new PgQueueRunner({
      adapter,
      workerId: 'immediate',
      lattice: new LatticeRealmConfig([realm]),
    });
    runner.register('incremental-index', async () => ({}));
    const enqueue = (immediate: boolean) =>
      publisher.publish({
        jobType: 'incremental-index',
        concurrencyGroup: `indexing:${realm}`,
        priority: 10,
        timeout: 10,
        args: {
          realmURL: realm,
          realmUsername: 'owner',
          changes: [{ url: `${realm}one.json`, operation: 'update' }],
          revisions: {},
          ignoreData: {},
          coalescedCallers: [],
          latticeBatch: { atomic: false, admittedAtMs: 1000, immediate },
        },
      });
    try {
      const first = await enqueue(false);
      await db.execute(
        "UPDATE jobs SET created_at=clock_timestamp()+interval '1 hour' WHERE id=$1",
        { bind: [first.id] },
      );
      await runner.start();
      await adapter.blockedClaim.promise;
      const urgent = await enqueue(true);
      assert.strictEqual(
        urgent.id,
        first.id,
        'urgency promotes the existing job',
      );
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          urgent.done,
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(new Error('immediate waiter remained deferred')),
              3000,
            );
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
      assert.ok(true, 'urgency bypasses the remaining collection delay');
    } finally {
      await runner.destroy();
      await publisher.destroy();
      await adapter.close();
    }
  });

  test('immediate writes cannot take an overdue wave reserved turn', async (assert) => {
    const realm = 'https://lattice-fairness.example/';
    const group = `indexing:${realm}`;
    const adapter = new PgAdapter();
    const publisher = new PgQueuePublisher(db);
    const runner = new PgQueueRunner({
      adapter,
      workerId: 'fairness',
      lattice: new LatticeRealmConfig([realm]),
    });
    const order: string[] = [];
    runner.register('incremental-index', async () => {
      order.push('source');
      return {};
    });
    runner.register('lattice-materialize', async () => {
      order.push('wave');
      return {};
    });
    try {
      await db.execute(
        `INSERT INTO lattice_owners (realm_url,owner_url,published_generation,input_generation,dirty_generation,definition_revision,retired,stale_after)
        VALUES($1,$2,1,1,2,'epoch',FALSE,now()-interval '1 second')`,
        { bind: [realm, realm + 'Board/one.json'] },
      );
      await db.execute(
        `INSERT INTO jobs(job_type,concurrency_group,priority,timeout,args,status,finished_at)
        VALUES('incremental-index',$1,10,10,'{}','resolved',now())`,
        { bind: [group] },
      );
      const sources = [];
      for (let i = 0; i < 2; i++)
        sources.push(
          await publisher.publish({
            jobType: 'incremental-index',
            concurrencyGroup: group,
            priority: 10,
            timeout: 10,
            args: {
              realmURL: realm,
              realmUsername: 'owner',
              changes: [{ url: realm + i + '.json', operation: 'update' }],
              revisions: {},
              ignoreData: {},
              coalescedCallers: [],
              latticeBatch: {
                atomic: true,
                admittedAtMs: Date.now(),
                immediate: true,
              },
            },
          }),
        );
      const wave = await publisher.publish({
        jobType: 'lattice-materialize',
        concurrencyGroup: group,
        priority: 8,
        timeout: 10,
        args: { realmURL: realm },
      });
      await runner.start();
      await Promise.all([wave.done, ...sources.map((source) => source.done)]);
      assert.deepEqual(
        order,
        ['wave', 'source', 'source'],
        'a source completed, so the due wave runs before the immediate backlog',
      );
    } finally {
      await runner.destroy();
      await publisher.destroy();
      await adapter.close();
    }
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
