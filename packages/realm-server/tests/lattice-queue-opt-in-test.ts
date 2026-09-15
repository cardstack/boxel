import QUnit from 'qunit';
import { PgAdapter, PgQueueRunner } from '@cardstack/postgres';
import {
  Deferred,
  expressionToSql,
  type Expression,
  type PgPrimitive,
} from '@cardstack/runtime-common';
import { LatticeRealmConfig } from '@cardstack/runtime-common/lattice-config';
import { setupDB } from './helpers/index.ts';

const { module, test } = QUnit;
const enabledRealm = 'https://lattice-queue.example/enabled/';
const ordinaryRealm = 'https://lattice-queue.example/ordinary/';
const actor = '@reader:example';
const lattice = new LatticeRealmConfig([enabledRealm]);

class ObservedAdapter extends PgAdapter {
  claims: string[] = [];
  subscriptions: string[] = [];
  failNextClaim = false;
  conflict = new Deferred<void>();

  override async subscribe(...args: Parameters<PgAdapter['subscribe']>) {
    this.subscriptions.push(args[0]);
    return super.subscribe(...args);
  }

  override async withConnection<T>(
    callback: (
      query: (expression: Expression) => Promise<Record<string, PgPrimitive>[]>,
    ) => Promise<T>,
  ): Promise<T> {
    return super.withConnection((query) =>
      callback(async (expression) => {
        const sql = expressionToSql(this.kind, expression).text;
        if (sql.includes('pending_jobs AS')) {
          this.claims.push(sql);
          if (this.failNextClaim) {
            this.failNextClaim = false;
            this.conflict.fulfill();
            throw Object.assign(
              new Error('Injected claim serialization conflict'),
              { code: '40001' },
            );
          }
        }
        return query(expression);
      }),
    );
  }
}

module('Lattice | queue opt-in', function (hooks) {
  let db: PgAdapter;
  let observed: ObservedAdapter;
  let runners: PgQueueRunner[];
  setupDB(hooks, {
    beforeEach: async (adapter) => {
      db = adapter;
      observed = new ObservedAdapter();
      runners = [];
    },
    afterEach: async () => {
      for (const runner of runners) await runner.destroy();
      await observed.close();
    },
  });

  function runner(config?: LatticeRealmConfig) {
    const opts = {
      adapter: observed,
      workerId: 'gate-' + runners.length,
      lattice: config,
    };
    const instance = new PgQueueRunner(opts);
    runners.push(instance);
    return instance;
  }

  async function enqueue(
    jobType: string,
    realmURL: string,
    extra: Record<string, unknown> = {},
    group?: string,
  ) {
    const [job] = await db.execute(
      `INSERT INTO jobs(job_type,concurrency_group,priority,timeout,args)
      VALUES($1,$2,8,10,$3::jsonb) RETURNING id`,
      {
        bind: [
          jobType,
          group ?? jobType + ':' + realmURL,
          JSON.stringify({ realmURL, realmUsername: 'reader', ...extra }),
        ],
      },
    );
    return Number(job.id);
  }

  const reserved = (id: number) =>
    db.execute('SELECT id FROM job_reservations WHERE job_id=$1', {
      bind: [id],
    });
  const pause = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));

  for (const [label, config] of [
    ['absent', undefined],
    ['empty', new LatticeRealmConfig()],
  ] as const) {
    test(`${label} policy keeps ordinary claims and subscriptions free of Lattice work`, async (assert) => {
      assert.timeout(10000);
      const queue = runner(config);
      const calls: string[] = [];
      const done = new Deferred<void>();
      for (const type of [
        'lattice-materialize',
        'lattice-link-code',
        'prerender_html',
        'ordinary',
      ]) {
        queue.register(type, async () => {
          calls.push(type);
          if (type === 'ordinary') done.fulfill();
          return {};
        });
      }
      const materialize = await enqueue('lattice-materialize', enabledRealm, {
        latticeEnabled: true,
      });
      const code = await enqueue('lattice-link-code', enabledRealm, {
        latticeEnabled: true,
      });
      await enqueue('prerender_html', ordinaryRealm, {
        latticeRenderRetryOwner: ordinaryRealm + 'day.json',
      });
      await enqueue('ordinary', ordinaryRealm);
      await queue.start();
      await done.promise;
      assert.deepEqual(
        calls,
        ['prerender_html', 'ordinary'],
        'job flags and registered handlers cannot grant enablement',
      );
      assert.deepEqual(await reserved(materialize), []);
      assert.deepEqual(await reserved(code), []);
      assert.ok(observed.claims.length > 0);
      assert.true(
        observed.claims.every((sql) => !/\b(?:lattice_|lattice_)/.test(sql)),
        'ordinary claim SQL has no Lattice readiness subqueries',
      );
      assert.false(
        observed.subscriptions.includes('realm_index_updated'),
        'no Lattice permission wake-up subscription',
      );
      await queue.destroy();
      const enabled = runner(lattice);
      const recovered: string[] = [];
      const recoveredAll = new Deferred<void>();
      for (const type of ['lattice-materialize', 'lattice-link-code']) {
        enabled.register(type, async () => {
          recovered.push(type);
          if (recovered.length === 2) recoveredAll.fulfill();
          return {};
        });
      }
      await enabled.start();
      await recoveredAll.promise;
      assert.deepEqual(recovered, ['lattice-materialize', 'lattice-link-code']);
      assert.strictEqual((await reserved(materialize)).length, 1);
      assert.strictEqual((await reserved(code)).length, 1);
    });
  }

  test('enabled jobs preserve source ordering and cannot claim another realm through their arguments', async (assert) => {
    assert.timeout(10000);
    const queue = runner(lattice);
    const calls: string[] = [];
    const done = new Deferred<void>();
    for (const type of [
      'lattice-materialize',
      'lattice-link-code',
      'incremental-index',
      'prerender_html',
      'ordinary',
    ]) {
      queue.register(type, async (args: any) => {
        calls.push(type + ':' + args.realmURL);
        if (type === 'lattice-materialize' && args.realmURL === enabledRealm)
          done.fulfill();
        return {};
      });
    }
    const disabled = await enqueue('lattice-link-code', ordinaryRealm, {
      latticeEnabled: true,
    });
    const child = await enqueue('lattice-materialize', enabledRealm + 'child/');
    await enqueue('prerender_html', ordinaryRealm, {
      latticeRenderRetryOwner: ordinaryRealm + 'day.json',
    });
    await enqueue(
      'lattice-materialize',
      enabledRealm,
      {},
      'indexing:' + enabledRealm,
    );
    await enqueue('ordinary', ordinaryRealm);
    await enqueue(
      'incremental-index',
      enabledRealm,
      {},
      'indexing:' + enabledRealm,
    );
    await queue.start();
    await done.promise;
    assert.deepEqual(calls, [
      'prerender_html:' + ordinaryRealm,
      'ordinary:' + ordinaryRealm,
      'incremental-index:' + enabledRealm,
      'lattice-materialize:' + enabledRealm,
    ]);
    assert.deepEqual(
      await reserved(disabled),
      [],
      'disabled Lattice job remains available to an enabled worker',
    );
    assert.deepEqual(
      await reserved(child),
      [],
      'enablement is an exact realm root',
    );
    assert.true(observed.subscriptions.includes('realm_index_updated'));
  });

  test('an enabled read wait leaves capacity free and wakes after permission changes', async (assert) => {
    assert.timeout(10000);
    await db.execute('INSERT INTO realm_metadata(url) VALUES($1)', {
      bind: [enabledRealm],
    });
    await db.execute(
      'INSERT INTO realm_user_permissions(realm_url,username,read,write,realm_owner) VALUES($1,$2,FALSE,FALSE,FALSE)',
      { bind: [enabledRealm, actor] },
    );
    const waiting = await enqueue('lattice-materialize', enabledRealm, {
      latticeWaitForRead: { realmURL: enabledRealm, actor },
    });
    await enqueue('ordinary', ordinaryRealm);
    const queue = runner(lattice);
    // Registration can follow start. Capacity, not the handler map at start,
    // determines whether permission restoration can wake this worker.
    await queue.start();
    await pause(25);
    const ordinaryDone = new Deferred<void>();
    const materialized = new Deferred<void>();
    queue.register('ordinary', async () => {
      ordinaryDone.fulfill();
      return {};
    });
    queue.register('lattice-materialize', async () => {
      materialized.fulfill();
      return {};
    });
    await db.notify('jobs', 'handlers-ready');
    await ordinaryDone.promise;
    assert.deepEqual(
      await reserved(waiting),
      [],
      'denied work has no reservation while unrelated work runs',
    );
    await db.execute(
      'UPDATE realm_user_permissions SET read=TRUE WHERE realm_url=$1',
      { bind: [enabledRealm] },
    );
    await db.notify('realm_index_updated', enabledRealm);
    await materialized.promise;
    assert.strictEqual(
      (await reserved(waiting)).length,
      1,
      'restored authority permits one attempt',
    );
  });

  for (const [label, config] of [
    ['ordinary', undefined],
    ['enabled', lattice],
  ] as const) {
    test(`${label} claim-conflict policy does not silently change the other lane`, async (assert) => {
      assert.timeout(10000);
      const queue = runner(config);
      const done = new Deferred<void>();
      let calls = 0;
      queue.register('ordinary', async () => {
        calls++;
        done.fulfill();
        return {};
      });
      queue.register('lattice-materialize', async () => ({}));
      await enqueue('ordinary', config ? enabledRealm : ordinaryRealm);
      observed.failNextClaim = true;
      await queue.start();
      await observed.conflict.promise;
      if (!config) {
        await pause(250);
        assert.strictEqual(
          calls,
          0,
          'ordinary conflict rolls back and waits for the existing wake/poll policy',
        );
        await db.notify('jobs', 'ordinary-retry');
      }
      await done.promise;
      assert.strictEqual(
        calls,
        1,
        'a claim conflict never executes the handler twice',
      );
      assert.ok(
        observed.claims.length >= 2,
        'claim was retried after rollback',
      );
    });
  }
});
