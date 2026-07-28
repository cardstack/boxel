import QUnit from 'qunit';
const { module, test } = QUnit;
import type { Test, SuperTest } from 'supertest';
import { basename } from 'path';
import type { Realm } from '@cardstack/runtime-common';
import { SupportedMimeType } from '@cardstack/runtime-common';
import { indexingConcurrencyGroup } from '@cardstack/runtime-common/jobs/indexing';
import { setupPermissionedRealmCached } from '../helpers/index.ts';
import type { PgAdapter } from '@cardstack/postgres';

// `_readiness-check` answers whether one realm's content is ready, not whether
// the server is healthy, so a caller that polls it needs to be able to tell a
// not-yet from a never. These cover the not-ready response's contract: the
// status, the retry hint, and the header naming which stage is outstanding.
module(`realm-endpoints/${basename(import.meta.filename)}`, function () {
  module('readiness check', function (hooks) {
    let testRealm: Realm;
    let request: SuperTest<Test>;
    let dbAdapter: PgAdapter;

    setupPermissionedRealmCached(hooks, {
      fixture: 'blank',
      permissions: {
        '*': ['read'],
      },
      onRealmSetup(args: {
        testRealm: Realm;
        request: SuperTest<Test>;
        dbAdapter: PgAdapter;
      }) {
        testRealm = args.testRealm;
        request = args.request;
        dbAdapter = args.dbAdapter;
      },
    });

    test('an idle realm reports ready', async function (assert) {
      let response = await request
        .get('/_readiness-check')
        .set('Accept', SupportedMimeType.RealmInfo);
      assert.strictEqual(response.status, 200, 'reports ready');
    });

    // Park a job in this realm's index lane behind a live reservation — the
    // state a peer replica's in-progress index leaves in the database, and one
    // no worker here can claim, since pg-queue skips any concurrency group
    // holding a valid reservation. The realm is mounted, indexed and idle in
    // this process, so both in-process gates fall through and the shared-state
    // gate is the only thing left to answer.
    test('an outstanding index job yields 503 naming the index stage, not a premature 200', async function (assert) {
      let [{ id: parkedJobId }] = (await dbAdapter.execute(
        `INSERT INTO jobs (job_type, concurrency_group, timeout, priority, args)
           VALUES ('from-scratch-index', $1, 3600, 10, $2)
           RETURNING id`,
        {
          bind: [
            indexingConcurrencyGroup(testRealm.url),
            JSON.stringify({ realmURL: testRealm.url }),
          ],
        },
      )) as { id: number }[];
      await dbAdapter.execute(
        `INSERT INTO job_reservations (job_id, locked_until, worker_id)
           VALUES ($1, NOW() + interval '5 minutes', 'peer-replica-worker')`,
        { bind: [parkedJobId] },
      );

      let response = await request
        .get('/_readiness-check')
        .set('Accept', SupportedMimeType.RealmInfo);

      assert.strictEqual(
        response.status,
        503,
        'reports not-ready rather than a premature 200',
      );
      assert.strictEqual(
        response.get('X-Boxel-Not-Ready'),
        'index',
        'names the index lane as the outstanding stage',
      );
      assert.strictEqual(
        response.get('Retry-After'),
        '1',
        'tells the caller to poll again',
      );
      assert.true(
        (response.get('Access-Control-Expose-Headers') ?? '').includes(
          'X-Boxel-Not-Ready',
        ),
        'the stage header is readable cross-origin',
      );
      assert.true(
        (response.get('Access-Control-Expose-Headers') ?? '').includes(
          'Retry-After',
        ),
        'the retry hint is readable cross-origin',
      );
    });
  });
});
