import QUnit from 'qunit';
const { module, test } = QUnit;
import type { Test, SuperTest } from 'supertest';
import { basename, join } from 'path';
import fsExtra from 'fs-extra';
const { ensureDirSync, writeJSONSync } = fsExtra;
import { dirSync } from 'tmp';
import type {
  LooseSingleCardDocument,
  ModuleRenderResponse,
  Prerenderer,
  Realm,
  RenderError,
  RenderVisitResponse,
  QueuePublisher,
  QueueRunner,
} from '@cardstack/runtime-common';
import {
  CachingDefinitionLookup,
  rri,
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

  // A brand-new realm whose first from-scratch index cannot complete is the
  // other way a readiness poll could run forever. Here every render times out
  // with the page idle — the shape a prerender takes when its browser cannot
  // reach an origin it needs. Whether a base module renders decides what that
  // means: when it cannot, the job gives up after a few files instead of
  // paying the full render timeout for every file, and the realm reports that
  // as a terminal not-ready rather than a ready over an empty index; when it
  // can, the idle timeouts are the cards' own and the pass completes.
  module('boot index whose renders all time out idle', function (hooks) {
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

    const realmURL = 'http://127.0.0.1:6678/idle-timeouts/';
    const cardCount = 6;

    function moduleResponse(
      url: string,
      outcome: 'ready' | 'timeout',
    ): ModuleRenderResponse {
      let base = {
        id: url,
        nonce: 'canary',
        isShimmed: false,
        lastModified: 0,
        createdAt: 0,
        deps: [],
        definitions: {},
      };
      if (outcome === 'ready') {
        return { ...base, status: 'ready' };
      }
      return {
        ...base,
        status: 'error',
        error: {
          type: 'module-error',
          error: {
            id: url,
            status: 504,
            title: 'Render timeout',
            message: 'Render timed-out after 60000 ms',
            additionalErrors: null,
          },
        },
      };
    }

    function idleTimeoutFileSystem(): Record<string, LooseSingleCardDocument> {
      let fileSystem: Record<string, LooseSingleCardDocument> = {
        'realm.json': {
          data: {
            type: 'card',
            attributes: { cardInfo: { name: 'Idle Timeouts Realm' } },
            meta: {
              adoptsFrom: {
                module: rri('@cardstack/base/realm-config'),
                name: 'RealmConfig',
              },
            },
          },
        },
      };
      for (let i = 0; i < cardCount; i++) {
        fileSystem[`card-${i}.json`] = {
          data: {
            type: 'card',
            attributes: { title: `Card ${i}` },
            meta: {
              adoptsFrom: {
                module: rri('https://cardstack.com/base/card-api'),
                name: 'CardDef',
              },
            },
          },
        };
      }
      return fileSystem;
    }

    // A realm whose every index visit times out idle, with the canary module
    // render behaving as `canary` says; started, so its boot index has run.
    async function startRealmWithIdleTimeouts(canary: 'ready' | 'timeout') {
      let real = await getTestPrerenderer();
      let indexVisits: string[] = [];
      let canaryRenders = 0;
      let prerenderer: Prerenderer = {
        prerenderModule: async (args) => {
          // The prerender-html job that follows a completed pass may render
          // modules too; only the canary's module counts here.
          if (args.url === 'https://cardstack.com/base/card-api') {
            canaryRenders++;
          }
          return moduleResponse(args.url, canary);
        },
        runCommand: (args) => real.runCommand(args),
        releaseBatch: async () => {},
        prerenderVisit: async (args) => {
          if (args.visitType === 'index') {
            indexVisits.push(args.url);
          }
          return idleTimeoutVisitResponse(args.url);
        },
      };
      let virtualNetwork = createVirtualNetwork();
      let definitionLookup = new CachingDefinitionLookup(
        dbAdapter,
        real,
        virtualNetwork,
        testCreatePrerenderAuth,
      );
      let dir = join(dirSync().name, 'idle-timeouts');
      ensureDirSync(dir);
      let { realm } = await createRealm({
        dir,
        fileSystem: idleTimeoutFileSystem(),
        definitionLookup,
        realmURL,
        permissions: { '*': ['read'] },
        virtualNetwork,
        publisher,
        runner,
        dbAdapter,
        withWorker: true,
        prerenderer,
      });
      virtualNetwork.mount(realm.handle);
      // Startup awaits a brand-new index's from-scratch job; the job's failure
      // is swallowed there, so this resolves either way.
      await realm.start();
      let [job] = (await dbAdapter.execute(
        `SELECT status, result FROM jobs
           WHERE job_type = 'from-scratch-index' AND concurrency_group = $1`,
        { bind: [indexingConcurrencyGroup(realm.url)] },
      )) as { status: string; result: unknown }[];
      let readiness = await realm.handle(
        new Request(`${realmURL}_readiness-check`, {
          headers: { Accept: SupportedMimeType.RealmInfo },
        }),
      );
      return {
        indexVisits,
        canaryRenders: () => canaryRenders,
        job,
        readiness: readiness!,
      };
    }

    // The response the prerender server sends for a render that hit its
    // timeout while waiting on nothing: a `Render timeout` error on the pass
    // and on `pageUnusableError`, with the diagnostics captured as the timer
    // fired showing a responsive, idle page.
    function idleTimeoutVisitResponse(url: string): RenderVisitResponse {
      let timeout: RenderError = {
        type: 'instance-error',
        error: {
          id: url,
          status: 504,
          title: 'Render timeout',
          message: 'Render timed-out after 60000 ms',
          additionalErrors: null,
        },
        evict: true,
      };
      return {
        card: {
          serialized: null,
          searchDoc: null,
          displayNames: null,
          deps: null,
          types: null,
          isolatedHTML: null,
          headHTML: null,
          atomHTML: null,
          embeddedHTML: null,
          fittedHTML: null,
          iconHTML: null,
          markdown: null,
          error: timeout,
        },
        pageUnusableError: timeout,
        meta: {
          diagnostics: {
            mainThreadResponsive: true,
            scriptBusyFraction: 0,
            pendingNetworkRequests: [],
            inFlightModuleImports: [],
            cardDocsInFlight: [],
            fileMetaDocsInFlight: [],
          },
        },
      };
    }

    test('gives up when a base module cannot render either, and reports the failure as terminal', async function (assert) {
      let { indexVisits, canaryRenders, job, readiness } =
        await startRealmWithIdleTimeouts('timeout');

      // Three consecutive idle timeouts trigger the canary; the render-ahead
      // loop may have started one more visit before the third was finished.
      assert.true(
        indexVisits.length >= 3,
        `made at least the three visits it takes to give up (made ${indexVisits.length})`,
      );
      assert.true(
        indexVisits.length <= 4,
        `gave up after ${indexVisits.length} index visits rather than visiting all ${cardCount} files`,
      );
      assert.strictEqual(canaryRenders(), 1, 'rendered the canary once');

      assert.strictEqual(job.status, 'rejected', 'the job was rejected');
      let reason = JSON.stringify(job.result);
      assert.true(
        reason.includes('timed out with the page idle'),
        'the rejection names the idle timeouts',
      );
      assert.true(
        reason.includes('a base module could not render either'),
        'the rejection names the failed canary',
      );

      assert.strictEqual(readiness.status, 503, 'reports not-ready');
      assert.strictEqual(
        readiness.headers.get('X-Boxel-Not-Ready'),
        'index-failed',
        'names the failed boot index as the stage',
      );
      assert.strictEqual(
        readiness.headers.get('Retry-After'),
        null,
        'carries no retry hint: the state is terminal',
      );
      let body = await readiness.text();
      assert.true(
        body.includes('timed out with the page idle'),
        `the body carries the failure: ${body}`,
      );
    });

    test("keeps going when a base module renders: the idle timeouts are the cards' own", async function (assert) {
      let { indexVisits, canaryRenders, job, readiness } =
        await startRealmWithIdleTimeouts('ready');

      assert.strictEqual(indexVisits.length, cardCount, 'visited every file');
      // One canary per run of three idle timeouts: six files, two canaries.
      assert.strictEqual(canaryRenders(), 2, 'rendered the canary per streak');
      assert.strictEqual(job.status, 'resolved', 'the job completed');
      assert.strictEqual(
        readiness.status,
        200,
        'the realm is ready: its index exists, with the files recorded as errors',
      );
    });
  });
});
