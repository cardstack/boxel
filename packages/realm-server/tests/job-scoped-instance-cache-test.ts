import { module, test } from 'qunit';
import { basename } from 'path';
import type { PgAdapter } from '@cardstack/postgres';
import { query, param, type Expression } from '@cardstack/runtime-common';
import { setupDB } from './helpers';
import { JobScopedInstanceCache } from '../job-scoped-instance-cache';

const TABLE = 'job_scoped_instance_cache';
const realm = 'http://localhost:4201/test/';

async function seed(
  dbAdapter: PgAdapter,
  jobId: string,
  url: string,
  ageSql = 'NOW()',
): Promise<void> {
  await query(dbAdapter, [
    `INSERT INTO ${TABLE} (job_id, url, result, created_at) VALUES (`,
    param(jobId),
    `,`,
    param(url),
    `,`,
    param('{}'),
    `, ${ageSql})`,
  ] as Expression);
}

module(basename(__filename), function (hooks) {
  let dbAdapter: PgAdapter;

  setupDB(hooks, {
    beforeEach: async (adapter) => {
      dbAdapter = adapter;
    },
  });

  module('JobScopedInstanceCache eviction', function () {
    test('jobIds returns the distinct job identities holding entries', async function (assert) {
      let cache = new JobScopedInstanceCache(dbAdapter);
      await seed(dbAdapter, '42.1', `${realm}a`);
      await seed(dbAdapter, '42.1', `${realm}b`);
      await seed(dbAdapter, '43.1', `${realm}c`);

      let ids = (await cache.jobIds()).sort();
      assert.deepEqual(ids, ['42.1', '43.1'], 'one entry per distinct job id');
      assert.strictEqual(await cache.size(), 3, 'three rows total');
    });

    test('clearJob deletes only the named job identity', async function (assert) {
      let cache = new JobScopedInstanceCache(dbAdapter);
      await seed(dbAdapter, '42.1', `${realm}a`);
      await seed(dbAdapter, '42.1', `${realm}b`);
      await seed(dbAdapter, '43.1', `${realm}c`);

      await cache.clearJob('42.1');

      assert.deepEqual(await cache.jobIds(), ['43.1'], 'only 43.1 remains');
      assert.strictEqual(await cache.size(), 1, 'one row left');
    });

    test('clearJob distinguishes reservations of the same job', async function (assert) {
      let cache = new JobScopedInstanceCache(dbAdapter);
      await seed(dbAdapter, '50.1', `${realm}a`);
      await seed(dbAdapter, '50.2', `${realm}a`);

      await cache.clearJob('50.1');

      assert.deepEqual(
        await cache.jobIds(),
        ['50.2'],
        'the other reservation’s entry survives a per-reservation clear',
      );
    });

    test('sweepExpired drops rows older than the TTL, keeps fresh ones', async function (assert) {
      let cache = new JobScopedInstanceCache(dbAdapter);
      await seed(dbAdapter, '42.1', `${realm}old`, `NOW() - INTERVAL '1 day'`);
      await seed(dbAdapter, '43.1', `${realm}fresh`);

      await cache.sweepExpired();

      assert.deepEqual(
        await cache.jobIds(),
        ['43.1'],
        'the day-old row was swept, the fresh row kept',
      );
    });
  });
});
