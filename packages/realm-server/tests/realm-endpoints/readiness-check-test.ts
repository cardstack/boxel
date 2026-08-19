import QUnit from 'qunit';
const { module, test } = QUnit;
import type { Test, SuperTest } from 'supertest';
import { basename, join } from 'path';
import fsExtra from 'fs-extra';
const { ensureDirSync, writeJSONSync } = fsExtra;
import { dirSync } from 'tmp';
import type {
  Realm,
  QueuePublisher,
  QueueRunner,
} from '@cardstack/runtime-common';
import {
  CachingDefinitionLookup,
  SupportedMimeType,
} from '@cardstack/runtime-common';
import { indexingConcurrencyGroup } from '@cardstack/runtime-common/jobs/indexing';
import {
  createRealm,
  createVirtualNetwork,
  getTestPrerenderer,
  setupDB,
  setupPermissionedRealmCached,
  testCreatePrerenderAuth,
} from '../helpers/index.ts';
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

  // A realm that is mounted but whose start() has not completed. The gate in
  // front of that state is the one a publish poll sits behind: a brand-new
  // published realm is mounted and serving before its from-scratch index
  // finishes. The realm here is deliberately never started, which is the
  // never-settles end of that spectrum — a startup that hangs rather than one
  // that is merely slow. The endpoint must still answer.
  module('startup that has not completed', function (hooks) {
    let dbAdapter: PgAdapter;
    let publisher: QueuePublisher;
    let runner: QueueRunner;

    setupDB(hooks, {
      beforeEach: async (adapter, pub, run) => {
        dbAdapter = adapter;
        publisher = pub;
        runner = run;
      },
    });

    const unstartedRealmURL = 'http://127.0.0.1:6677/unstarted/';

    async function buildUnstartedRealm(): Promise<Realm> {
      let dir = join(dirSync().name, 'unstarted-realm');
      ensureDirSync(dir);
      writeJSONSync(join(dir, 'realm.json'), {
        data: {
          type: 'card',
          attributes: { cardInfo: { name: 'Unstarted Realm' } },
          meta: {
            adoptsFrom: {
              module: '@cardstack/base/realm-config',
              name: 'RealmConfig',
            },
          },
        },
      });
      let virtualNetwork = createVirtualNetwork();
      let definitionLookup = new CachingDefinitionLookup(
        dbAdapter,
        await getTestPrerenderer(),
        virtualNetwork,
        testCreatePrerenderAuth,
      );
      // createRealm constructs without starting, so #startedUp stays pending
      // for as long as this realm exists.
      let { realm } = await createRealm({
        dir,
        definitionLookup,
        realmURL: unstartedRealmURL,
        permissions: { '*': ['read'] },
        virtualNetwork,
        publisher,
        runner,
        dbAdapter,
      });
      return realm;
    }

    test('answers 503 naming the startup stage instead of holding the request open', async function (assert) {
      let realm = await buildUnstartedRealm();
      let startedAt = Date.now();
      let response = await realm.handle(
        new Request(`${unstartedRealmURL}_readiness-check`, {
          headers: { Accept: SupportedMimeType.RealmInfo },
        }),
      );
      let elapsed = Date.now() - startedAt;

      assert.ok(response, 'the realm handled the request');
      assert.strictEqual(
        response!.status,
        503,
        'reports not-ready rather than hanging until the caller gives up',
      );
      assert.strictEqual(
        response!.headers.get('X-Boxel-Not-Ready'),
        'startup',
        'names startup — not the shared index lane — as the outstanding stage',
      );
      assert.strictEqual(
        response!.headers.get('Retry-After'),
        '1',
        'tells the caller to poll again',
      );
      // The budget bounds one request; the assertion is that the request came
      // back on its own rather than being released by something else. A
      // generous ceiling keeps this from failing on a loaded CI box.
      assert.true(
        elapsed < 60_000,
        `answered within the in-process budget (took ${elapsed}ms)`,
      );
    });
  });
});
