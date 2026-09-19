import QUnit from 'qunit';
import { basename } from 'node:path';
import { LatticeRealmConfig } from '@cardstack/runtime-common/lattice-config';
import {
  PgQueuePublisher,
  PgQueueRunner,
  type PgAdapter,
} from '@cardstack/postgres';
import { Deferred } from '@cardstack/runtime-common';
import {
  LatticeWorkSuperseded,
  type LatticeWorkScope,
} from '@cardstack/runtime-common/lattice-work';
import { openLatticeNativeWork } from '../lib/lattice-native-work.ts';
import {
  LatticeBxlWorker,
  type LatticeBxlManifest,
} from '../lib/lattice-bxl-derivation.ts';
import { setupDB } from './helpers/index.ts';

const { module, test } = QUnit;
const realm = 'https://lattice-native-work.example/';
const owner = realm + 'Day/one.json';
const actor = '@reader:example';
const request = {
  url: owner,
  realmURL: realm,
  sourceJSON: '{}',
  generation: 6,
  loaderEpoch: 'epoch',
  lastModified: 1,
  resourceCreatedAt: 1,
  inputSnapshot: { realmURL: realm, generation: 5 },
};
const admission = {
  deps: [realm + 'day', 'https://base.example/helper'],
  resolve: (ref: string, base: string) => new URL(ref, base).href,
  inputActor: actor,
};
async function aborted(scope: LatticeWorkScope) {
  if (!scope.signal.aborted)
    await new Promise<void>((resolve) =>
      scope.signal.addEventListener('abort', () => resolve(), { once: true }),
    );
  return scope.signal.reason;
}

module(basename(import.meta.filename), function (hooks) {
  let db: PgAdapter;
  let scopes: LatticeWorkScope[];
  setupDB(hooks, {
    beforeEach: async (adapter) => {
      db = adapter;
      scopes = [];
      await db.execute(
        'INSERT INTO realm_generations(realm_url,current_generation,loader_epoch) VALUES($1,5,$2)',
        { bind: [realm, 'epoch'] },
      );
      await db.execute('INSERT INTO realm_metadata(url) VALUES($1)', {
        bind: [realm],
      });
      await db.execute(
        'INSERT INTO realm_user_permissions(realm_url,username,read,write,realm_owner) VALUES($1,$2,TRUE,FALSE,FALSE)',
        { bind: [realm, actor] },
      );
      await db.execute(
        `INSERT INTO lattice_owners(realm_url,owner_url,published_generation,input_generation,dirty_generation,definition_revision,retired)
      VALUES($1,$2,4,3,5,'epoch',FALSE)`,
        { bind: [realm, owner] },
      );
    },
  });
  hooks.afterEach(async () => {
    await Promise.all(scopes.map((s) => s.close()));
  });
  async function open() {
    const scope = await openLatticeNativeWork(db, request, admission);
    scopes.push(scope);
    return scope;
  }

  test('queued source work blocks admission but only changed inputs cancel admitted work', async (assert) => {
    assert.timeout(5000);
    const publisher = new PgQueuePublisher(db);
    const scope = await open();
    const execute = db.execute.bind(db);
    const inspectedPending = new Deferred<void>();
    // Observe an actual recovery inspection, not just receipt of NOTIFY. The
    // queued job has to be seen by the guard before we check continuation.
    db.execute = async (sql, opts) => {
      const rows = await execute(sql, opts);
      if (rows[0]?.source_pending === true) inspectedPending.fulfill();
      return rows;
    };
    try {
      await publisher.publish({
        jobType: 'incremental-index',
        concurrencyGroup: 'indexing:https://other.example/',
        priority: 10,
        timeout: 10,
        args: {},
      });
      const unrelated = await open();
      assert.false(
        unrelated.signal.aborted,
        'another realm does not block admission',
      );
      await unrelated.close();
      await publisher.publish({
        jobType: 'incremental-index',
        concurrencyGroup: 'indexing:' + realm,
        priority: 10,
        timeout: 10,
        args: {},
      });
      await inspectedPending.promise;
      assert.false(
        scope.signal.aborted,
        'queued work alone leaves captured inputs usable',
      );
      await assert.rejects(
        open(),
        /new source work has priority/,
        'new admission waits for source work',
      );
      await db.execute(
        'UPDATE realm_generations SET current_generation=6 WHERE realm_url=$1',
        { bind: [realm] },
      );
      const reason = await aborted(scope);
      assert.true(reason instanceof LatticeWorkSuperseded);
      assert.strictEqual(reason.reason, 'input or module revision changed');
    } finally {
      db.execute = execute;
      await publisher.destroy();
    }
  });

  for (const change of [
    'dirty',
    'generation',
    'retired',
    'satisfied',
    'permission',
  ])
    test(`SQL recovery cancels ${change} work without relying on a notification`, async (assert) => {
      assert.timeout(5000);
      const scope = await open();
      if (change === 'dirty')
        await db.execute(
          'UPDATE lattice_owners SET dirty_generation=6 WHERE owner_url=$1',
          { bind: [owner] },
        );
      if (change === 'generation')
        await db.execute(
          'UPDATE realm_generations SET current_generation=6 WHERE realm_url=$1',
          { bind: [realm] },
        );
      if (change === 'retired')
        await db.execute(
          'UPDATE lattice_owners SET retired=TRUE WHERE owner_url=$1',
          { bind: [owner] },
        );
      if (change === 'satisfied')
        await db.execute(
          'UPDATE lattice_owners SET dirty_generation=NULL WHERE owner_url=$1',
          { bind: [owner] },
        );
      if (change === 'permission')
        await db.execute(
          'UPDATE realm_user_permissions SET read=FALSE WHERE realm_url=$1',
          { bind: [realm] },
        );
      assert.true((await aborted(scope)) instanceof LatticeWorkSuperseded);
    });

  test('an imported module invalidation cancels work even outside the owner realm', async (assert) => {
    assert.timeout(5000);
    const scope = await open();
    await db.notify(
      'module_cache_invalidated',
      JSON.stringify({
        k: 'module',
        r: 'https://base.example/',
        m: ['https://base.example/helper.gts'],
      }),
    );
    assert.strictEqual(
      (await aborted(scope)).reason,
      'a computation module was invalidated',
    );
  });

  test('already satisfied owners refuse admission and finished scopes ignore late events', async (assert) => {
    const scope = await open();
    await scope.close();
    await db.execute(
      'UPDATE lattice_owners SET dirty_generation=NULL WHERE owner_url=$1',
      { bind: [owner] },
    );
    await assert.rejects(open(), /already satisfied/);
    assert.false(
      scope.signal.aborted,
      'a closed attempt is no longer a notification target',
    );
  });

  test('source indexing proceeds beside BXL and changed inputs cancel obsolete work', async (assert) => {
    assert.timeout(15000);
    const worker = new LatticeBxlWorker();
    const publisher = new PgQueuePublisher(db);
    const ownerRunner = new PgQueueRunner({
      adapter: db,
      workerId: 'lattice-cancel-owner',
      lattice: new LatticeRealmConfig([realm]),
      priority: 8,
    });
    const sourceRunner = new PgQueueRunner({
      adapter: db,
      workerId: 'lattice-cancel-source',
      lattice: new LatticeRealmConfig([realm]),
      priority: 10,
    });
    const entered = new Deferred<void>();
    const sourceEntered = new Deferred<void>();
    const manifest: LatticeBxlManifest = {
      version: 1,
      definition: { module: realm + 'day', name: 'Day', revision: 'v1' },
      field: 'sum',
      expression: '[range(0; 5000)] | add',
      input: { object: {} },
      output: 'number',
    };
    const inputs = Array.from({ length: 128 }, (_, i) => ({
      id: realm + 'Input/' + i,
      revision: 'v1',
      json: '{}',
    }));
    let workStopped = false;
    const order: string[] = [];
    ownerRunner.register('lattice-materialize', async () => {
      const scope = await open();
      try {
        const running = worker.evaluate(
          manifest,
          inputs,
          undefined,
          scope.signal,
        );
        entered.fulfill();
        await running;
        throw new Error('Obsolete batch unexpectedly completed');
      } catch (error) {
        if (!(error instanceof LatticeWorkSuperseded)) throw error;
        workStopped = true;
        order.push('cancelled');
        return { superseded: error.reason };
      } finally {
        await scope.close();
      }
    });
    sourceRunner.register('incremental-index', async () => {
      assert.false(
        workStopped,
        'the independent source lane can run while captured BXL work is active',
      );
      order.push('source');
      await db.execute(
        'UPDATE lattice_owners SET dirty_generation=6 WHERE owner_url=$1',
        { bind: [owner] },
      );
      await db.notify('realm_index_updated', realm);
      sourceEntered.fulfill();
      return {};
    });
    try {
      await worker.evaluate(manifest, inputs.slice(0, 1));
      const old = await publisher.publish({
        jobType: 'lattice-materialize',
        concurrencyGroup: 'lattice:' + realm,
        priority: 8,
        timeout: 10,
        args: { realmURL: realm },
      });
      await ownerRunner.start();
      await sourceRunner.start();
      await entered.promise;
      const source = await publisher.publish({
        jobType: 'incremental-index',
        concurrencyGroup: 'indexing:' + realm,
        priority: 10,
        timeout: 10,
        args: { realmURL: realm },
      });
      await sourceEntered.promise;
      await Promise.all([old.done, source.done]);
      assert.deepEqual(order, ['source', 'cancelled']);
      const [row] = await db.execute(
        'SELECT dirty_generation FROM lattice_owners WHERE owner_url=$1',
        { bind: [owner] },
      );
      assert.strictEqual(
        Number(row.dirty_generation),
        6,
        'cancellation did not clear the dirty obligation',
      );
      assert.strictEqual(
        (await worker.evaluate(manifest, inputs.slice(0, 1))).artifacts[0]
          .value,
        12497500,
        'the next computation can run',
      );
    } finally {
      entered.fulfill();
      await ownerRunner.destroy();
      await sourceRunner.destroy();
      await publisher.destroy();
      await worker.close();
    }
  });
});
