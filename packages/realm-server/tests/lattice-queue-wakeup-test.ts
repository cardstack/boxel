import { removeRealmDatabaseArtifacts } from '../handlers/realm-destruction-utils.ts';
import { latticeConcurrencyGroup } from '@cardstack/runtime-common/jobs/lattice';
import { prerenderHtmlConcurrencyGroup } from '@cardstack/runtime-common/jobs/prerender-html';
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

  test('realm teardown removes all three lanes and abandoned secondary candidates', async (assert) => {
    const realm = 'https://lattice-lane-teardown.example/';
    for (const [type, group] of [
      ['incremental-index', `indexing:${realm}`],
      ['lattice-materialize', latticeConcurrencyGroup(realm)],
      ['prerender_html', prerenderHtmlConcurrencyGroup(realm)],
    ])
      await db.execute(
        'INSERT INTO jobs(job_type,concurrency_group,priority,timeout,args) VALUES($1,$2,10,30,$3)',
        { bind: [type, group, JSON.stringify({ realmURL: realm })] },
      );
    await db.execute(
      `INSERT INTO lattice_index_candidates(batch_id,url,file_alias,realm_url,type,generation)
      VALUES('00000000-0000-0000-0000-000000000001',$1,$1,$2,'instance',1)`,
      { bind: [realm + 'one.json', realm] },
    );
    await removeRealmDatabaseArtifacts({ dbAdapter: db, realmURL: realm });
    const [jobs] = await db.execute(
      "SELECT count(*) AS n FROM jobs WHERE args->>'realmURL'=$1 AND status='unfulfilled'",
      { bind: [realm] },
    );
    const [candidates] = await db.execute(
      'SELECT count(*) AS n FROM lattice_index_candidates WHERE realm_url=$1',
      { bind: [realm] },
    );
    assert.strictEqual(Number(jobs.n), 0);
    assert.strictEqual(Number(candidates.n), 0);
  });

  test('a blocked HTML job cannot occupy primary or secondary queue lanes', async (assert) => {
    assert.timeout(20_000);
    const realm = 'https://lattice-three-lanes.example/';
    const publisher = new PgQueuePublisher(db);
    const types = [
      'prerender_html',
      'incremental-index',
      'lattice-materialize',
    ];
    const groups = [
      prerenderHtmlConcurrencyGroup(realm),
      `indexing:${realm}`,
      latticeConcurrencyGroup(realm),
    ];
    const started = types.map(() => new Deferred<void>());
    const release = types.map(() => new Deferred<void>());
    const adapters = types.map(() => new PgAdapter());
    const runners = types.map((type, i) => {
      const runner = new PgQueueRunner({
        adapter: adapters[i],
        workerId: `lane-${i}`,
        lattice: new LatticeRealmConfig([realm]),
      });
      runner.register(type, async () => {
        started[i].fulfill();
        await release[i].promise;
        return {};
      });
      return runner;
    });
    try {
      await db.execute(
        `INSERT INTO lattice_owners(realm_url,owner_url,published_generation,input_generation,dirty_generation,definition_revision,retired,stale_after)
        VALUES($1,$2,1,1,2,'epoch',FALSE,now()-interval '1 second')`,
        { bind: [realm, realm + 'Board/one.json'] },
      );
      const jobs = [];
      for (let i = 0; i < types.length; i++)
        jobs.push(
          await publisher.publish({
            jobType: types[i],
            concurrencyGroup: groups[i],
            priority: 10,
            timeout: 30,
            args: { realmURL: realm },
          }),
        );
      await runners[0].start();
      await started[0].promise;
      await Promise.all(runners.slice(1).map((runner) => runner.start()));
      await Promise.all(started.slice(1).map((event) => event.promise));
      const [active] = await db.execute(
        `SELECT count(DISTINCT j.concurrency_group) AS n FROM jobs j JOIN job_reservations r ON r.job_id=j.id
        WHERE j.args->>'realmURL'=$1 AND r.completed_at IS NULL AND r.locked_until>now()`,
        { bind: [realm] },
      );
      assert.strictEqual(
        Number(active.n),
        3,
        'all three reservations are active together while HTML remains blocked',
      );
      release[1].fulfill();
      release[2].fulfill();
      await Promise.all(jobs.slice(1).map((job) => job.done));
      assert.ok(true, 'both data lanes complete before HTML is released');
      release[0].fulfill();
      await jobs[0].done;
    } finally {
      release.forEach((event) => event.fulfill());
      await Promise.all(runners.map((runner) => runner.destroy()));
      await publisher.destroy();
      await Promise.all(adapters.map((adapter) => adapter.close()));
    }
  });

  test('unmatched input changes route during a source backlog without rerunning unchanged aggregates', async (assert) => {
    assert.timeout(20_000);
    const realm = 'https://lattice-input-progress.example/';
    const adapter = new ClaimObservingAdapter();
    const publisher = new PgQueuePublisher(db);
    const runner = new PgQueueRunner({
      adapter,
      workerId: 'input-progress',
      lattice: new LatticeRealmConfig([realm]),
    });
    let runs = 0;
    runner.register('lattice-materialize', async () => {
      runs++;
      await db.execute(
        'DELETE FROM lattice_pending_generations WHERE realm_url=$1',
        { bind: [realm] },
      );
      return {};
    });
    try {
      // This owner already read the relevant change. It still owes a clean
      // validation when source settles, but an expired deadline is not work.
      await db.execute(
        `INSERT INTO lattice_owners(realm_url,owner_url,published_generation,input_generation,dirty_generation,definition_revision,retired,stale_after)
        VALUES($1,$2,3,2,2,'epoch',FALSE,now()-interval '1 second')`,
        { bind: [realm, realm + 'Board/one.json'] },
      );
      await db.execute(
        `INSERT INTO jobs(job_type,concurrency_group,priority,timeout,args)
        VALUES('incremental-index',$1,10,30,$2)`,
        { bind: ['indexing:' + realm, JSON.stringify({ realmURL: realm })] },
      );
      await db.execute(
        `INSERT INTO lattice_pending_generations(realm_url,generation,definition_revision)
        VALUES($1,4,'epoch')`,
        { bind: [realm] },
      );
      const wake = () =>
        publisher.publish({
          jobType: 'lattice-materialize',
          concurrencyGroup: latticeConcurrencyGroup(realm),
          priority: 8,
          timeout: 10,
          args: { realmURL: realm },
        });
      const routing = await wake();
      await runner.start();
      await routing.done;
      assert.strictEqual(
        runs,
        1,
        'new input changes can route without waiting for primary indexing to stop',
      );
      adapter.blockedClaim = new Deferred<void>();
      const duplicate = await wake();
      await adapter.blockedClaim.promise;
      assert.strictEqual(
        runs,
        1,
        'after routing drains the same stale inputs cannot consume another worker',
      );
      const reservations = await db.execute(
        'SELECT id FROM job_reservations WHERE job_id=$1',
        { bind: [duplicate.id] },
      );
      assert.strictEqual(
        reservations.length,
        0,
        'the duplicate wake remains unclaimed',
      );
      await db.execute(
        "UPDATE jobs SET status='resolved' WHERE concurrency_group=$1",
        { bind: ['indexing:' + realm] },
      );
      await db.execute('NOTIFY jobs');
      await duplicate.done;
      assert.strictEqual(
        runs,
        2,
        'the ordinary final validation can run after the source backlog ends',
      );
    } finally {
      await runner.destroy();
      await publisher.destroy();
      await adapter.close();
    }
  });

  test('new ordinary source work runs immediately, then secondary work gets its turn', async (assert) => {
    assert.timeout(15_000);
    const realm = 'https://lattice-collection-lane.example/';
    const adapter = new PgAdapter();
    const publisher = new PgQueuePublisher(db);
    const runner = new PgQueueRunner({
      adapter,
      workerId: 'collection-lane',
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
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await db.execute(
        `INSERT INTO lattice_owners(realm_url,owner_url,published_generation,input_generation,dirty_generation,definition_revision,retired,stale_after)
        VALUES($1,$2,1,1,2,'epoch',FALSE,now()+interval '1 hour')`,
        { bind: [realm, realm + 'Board/one.json'] },
      );
      const [source] = await db.execute(
        `INSERT INTO jobs(job_type,concurrency_group,priority,timeout,args)
        VALUES('incremental-index',$1,10,10,$2) RETURNING id`,
        {
          bind: [
            'indexing:' + realm,
            JSON.stringify({
              realmURL: realm,
              latticeBatch: { atomic: false, immediate: false },
            }),
          ],
        },
      );
      const wave = await publisher.publish({
        jobType: 'lattice-materialize',
        concurrencyGroup: latticeConcurrencyGroup(realm),
        priority: 8,
        timeout: 10,
        args: { realmURL: realm },
      });
      await runner.start();
      await Promise.race([
        wave.done,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('secondary waited for primary collection')),
            3000,
          );
        }),
      ]);
      assert.deepEqual(
        order,
        ['source', 'wave'],
        'source and then ordinary wave run without a fixed collection delay',
      );
      const reservations = await db.execute(
        'SELECT id FROM job_reservations WHERE job_id=$1',
        { bind: [source.id] },
      );
      assert.strictEqual(
        reservations.length,
        1,
        'source work claimed without waiting five seconds',
      );
    } finally {
      clearTimeout(timer);
      await runner.destroy();
      await publisher.destroy();
      await adapter.close();
    }
  });

  test('a fresh ordinary write wakes an idle worker without a collection timer', async function (assert) {
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
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await runner.start();
      await adapter.blockedClaim.promise;
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
      await Promise.race([
        job.done,
        new Promise((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new Error('ordinary write waited for collection or polling'),
              ),
            3000,
          );
        }),
      ]);
      assert.ok(
        true,
        'NOTIFY starts fresh ordinary work before five seconds, without another write',
      );
    } finally {
      clearTimeout(timer);
      await runner.destroy();
      await publisher.destroy();
      await adapter.close();
    }
  });

  test('an immediate waiter promotes its existing unclaimed ordinary batch', async function (assert) {
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
      const urgent = await enqueue(true);
      assert.strictEqual(
        urgent.id,
        first.id,
        'urgency promotes the existing job',
      );
      await runner.start();
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
      assert.ok(true, 'the promoted pending batch runs immediately');
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
