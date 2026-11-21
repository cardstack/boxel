import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { PgAdapter, resolvePoolMax } from '@cardstack/postgres';

// Each kind of process sizes its pool on its own variable, then on the shared
// PG_POOL_MAX, then on its own default.
module(basename(import.meta.filename), function () {
  test('with nothing set, each role takes its default', function (assert) {
    assert.strictEqual(resolvePoolMax('realm-server', {}), 40);
    assert.strictEqual(resolvePoolMax('worker-manager', {}), 4);
    assert.strictEqual(resolvePoolMax('worker', {}), 10);
    assert.strictEqual(resolvePoolMax(undefined, {}), 40, 'the default role');
  });

  test('an explicit PG_POOL_MAX still sizes every role', function (assert) {
    let env = { PG_POOL_MAX: '25' };
    assert.strictEqual(resolvePoolMax('realm-server', env), 25);
    assert.strictEqual(resolvePoolMax('worker-manager', env), 25);
    assert.strictEqual(resolvePoolMax('worker', env), 25);
  });

  test("a role's own variable wins over PG_POOL_MAX", function (assert) {
    let env = {
      PG_POOL_MAX: '25',
      PG_POOL_MAX_WORKER_MANAGER: '3',
      PG_POOL_MAX_WORKER: '6',
    };
    assert.strictEqual(resolvePoolMax('worker-manager', env), 3);
    assert.strictEqual(resolvePoolMax('worker', env), 6);
    assert.strictEqual(
      resolvePoolMax('realm-server', env),
      25,
      'the realm server has no variable of its own',
    );
  });

  test('an invalid value falls through to the next', function (assert) {
    for (let bad of ['0', '-2', '2.5', 'many', '']) {
      assert.strictEqual(
        resolvePoolMax('worker', { PG_POOL_MAX_WORKER: bad, PG_POOL_MAX: '7' }),
        7,
        `PG_POOL_MAX_WORKER=${JSON.stringify(bad)}`,
      );
      assert.strictEqual(
        resolvePoolMax('worker', { PG_POOL_MAX: bad }),
        10,
        `PG_POOL_MAX=${JSON.stringify(bad)}`,
      );
    }
  });

  test('an adapter sizes its pool by its role', async function (assert) {
    let saved = {
      PG_POOL_MAX: process.env.PG_POOL_MAX,
      PG_POOL_MAX_WORKER: process.env.PG_POOL_MAX_WORKER,
      PG_POOL_MAX_WORKER_MANAGER: process.env.PG_POOL_MAX_WORKER_MANAGER,
    };
    delete process.env.PG_POOL_MAX;
    delete process.env.PG_POOL_MAX_WORKER;
    delete process.env.PG_POOL_MAX_WORKER_MANAGER;
    let adapters: PgAdapter[] = [];
    try {
      let limitFor = (poolRole?: 'worker' | 'worker-manager') => {
        let adapter = new PgAdapter(poolRole ? { poolRole } : undefined);
        adapters.push(adapter);
        return adapter.connectionStats.limit;
      };
      assert.strictEqual(limitFor(), 40);
      assert.strictEqual(limitFor('worker-manager'), 4);
      assert.strictEqual(limitFor('worker'), 10);
    } finally {
      for (let adapter of adapters) {
        await adapter.close();
      }
      for (let [name, value] of Object.entries(saved)) {
        if (value === undefined) {
          delete process.env[name];
        } else {
          process.env[name] = value;
        }
      }
    }
  });
});
