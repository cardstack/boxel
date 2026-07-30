import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { Server } from 'http';
import type { PgAdapter } from '@cardstack/postgres';
import { PgQueuePublisher } from '@cardstack/postgres';
import type {
  DefinitionLookup,
  IndexWriter,
  Prerenderer,
  Realm,
  VirtualNetwork,
} from '@cardstack/runtime-common';
import { logger, prerenderHtmlReconcile, rri } from '@cardstack/runtime-common';

import { createPrerenderHttpServer } from '../prerender/prerender-app.ts';
import { createRemotePrerenderer } from '../prerender/remote-prerenderer.ts';
import {
  closeServer,
  matrixURL,
  setupPermissionedRealmsCached,
  testPort,
  trackServer,
} from './helpers/index.ts';
import {
  currentRealmGeneration,
  maxPrerenderHtmlJobId,
  prerenderedHtmlRowFor,
  settlePrerenderHtmlJobs,
} from './helpers/indexing.ts';

// A card whose render never settles — a wedged runloop, a blocked main
// thread — must fail like any other broken card: a bounded visit, a
// persisted error row the reconcile sweep reads as the recorded outcome,
// and no collateral damage to other realms or to the tab pool. This test
// drives that failure mode through the real pipeline: a real card whose
// isolated template pegs the tab's main thread, rendered by a real
// prerender server through the queue's prerender_html job.
//
// The guarantees pinned here, end to end:
//
//   1. The visit fails within the prerender client's request budget. The
//      client aborts its request, the abort propagates to the prerender
//      server (which cancels the in-flight render and disposes the wedged
//      tab), and the visit loop records the failure instead of letting it
//      reject the whole job.
//   2. A real error row lands in `prerendered_html`, stamped at the
//      generation the pass targeted and marked `visitRequestFailure` with
//      its consecutive-failure count — the shape the reconcile sweep's
//      bounded retry lane keys on. Last-known-good HTML survives beneath
//      the error.
//   3. The reconcile sweep enqueues nothing for the failed URL: the error
//      row reads as "attempted, recorded" rather than "never attempted",
//      so the sweep does not re-enqueue the identical batch every tick.
//   4. Other realms' pipelines stay healthy while the bad card stands
//      broken, and fixing the card heals its row — the affinity's tab pool
//      recovered from the wedge.
//
// The scheduling of the bounded retry lane itself (the consecutive-failure
// cap, the minimum re-render age) and the rejection-streak backoff are
// pinned by prerender-html-reconcile-test.ts against seeded rows; this test
// is the proof that a genuinely pathological render produces exactly the
// row shape those lanes consume.

const badRealmURL = 'http://127.0.0.1:4472/wedged/';
const healthyRealmURL = 'http://127.0.0.1:4473/steady/';
const prerenderPort = testPort(4474);
const prerenderServerURL = `http://127.0.0.1:${prerenderPort}`;

// The budget that bounds a never-settling visit: the prerender client
// aborts its request at this timeout. It must comfortably cover a healthy
// render (the fixture realms' boot renders flow through the same client)
// while staying far below the server's own per-step render timeout, so the
// client abort — not the server timeout — is what ends the wedged visit.
const PRERENDER_CLIENT_TIMEOUT_MS = 15_000;

// How long the fixture card pegs the tab's main thread once told to block.
// Far past the client's request budget so the render genuinely cannot
// settle within it, but bounded, so a failure of the disposal path can
// never leave a tab spinning for the rest of the suite.
const MAIN_THREAD_BLOCK_MS = 120_000;

// The client timeout is read from the environment when the remote
// prerenderer is created, so the override is set only for the duration of
// this synchronous call and restored immediately — nothing leaks to test
// files that share this process.
function createAbortingPrerenderer(): Prerenderer {
  let prior = process.env.PRERENDER_MANAGER_REQUEST_TIMEOUT_MS;
  process.env.PRERENDER_MANAGER_REQUEST_TIMEOUT_MS = String(
    PRERENDER_CLIENT_TIMEOUT_MS,
  );
  try {
    return createRemotePrerenderer(prerenderServerURL);
  } finally {
    if (prior === undefined) {
      delete process.env.PRERENDER_MANAGER_REQUEST_TIMEOUT_MS;
    } else {
      process.env.PRERENDER_MANAGER_REQUEST_TIMEOUT_MS = prior;
    }
  }
}

function wedgeDoc(title: string, blockMainThread: boolean) {
  return JSON.stringify({
    data: {
      attributes: { title, blockMainThread },
      meta: {
        adoptsFrom: {
          module: rri('./wedge'),
          name: 'Wedge',
        },
      },
    },
  });
}

function personDoc(firstName: string, hourlyRate: number) {
  return JSON.stringify({
    data: {
      attributes: { firstName, hourlyRate },
      meta: {
        adoptsFrom: {
          module: rri('./person'),
          name: 'Person',
        },
      },
    },
  });
}

module(basename(import.meta.filename), function (hooks) {
  let dbAdapter: PgAdapter;
  let badRealm: Realm;
  let healthyRealm: Realm;
  let prerenderServer: Server | undefined;

  // A dedicated prerender server (rather than the shared test one) keeps
  // the deliberately hostile fixture isolated: the wedged tab and its
  // disposal live in this module's own pool. Two pages so the healthy
  // realm's renders never queue behind the wedged tab's disposal.
  hooks.before(async function () {
    let server = createPrerenderHttpServer({
      maxPages: 2,
      port: prerenderPort,
      fatalExitOnUncaught: false, // tests share the qunit process
    });
    trackServer(server);
    await new Promise<void>((resolve, reject) => {
      let onError = (error: Error) => reject(error);
      server.once('error', onError);
      server.listen(prerenderPort, '127.0.0.1', () => {
        server.off('error', onError);
        resolve();
      });
    });
    prerenderServer = server;
  });

  hooks.after(async function () {
    if (prerenderServer) {
      let stop = (
        prerenderServer as Server & { __stopPrerenderer?: () => Promise<void> }
      ).__stopPrerenderer;
      await stop?.();
      await closeServer(prerenderServer);
      prerenderServer = undefined;
    }
  });

  setupPermissionedRealmsCached(hooks, {
    prerenderer: createAbortingPrerenderer(),
    realms: [
      {
        realmURL: badRealmURL,
        permissions: {
          '*': ['read'],
          '@user1:localhost': ['read', 'write', 'realm-owner'],
        },
        fileSystem: {
          // The card under test. Its isolated template synchronously pegs
          // the tab's main thread when `blockMainThread` is set — the
          // runloop never settles, no CDP evaluate can run, so no render
          // response is ever produced. The block lives only in the
          // isolated component: the index visit's meta/icon routes never
          // instantiate it, so the search-doc channel indexes this card
          // cleanly and only the HTML channel's visit wedges.
          'wedge.gts': `
            import { CardDef, field, contains, StringField, Component } from '@cardstack/base/card-api';
            import BooleanField from '@cardstack/base/boolean';

            export class Wedge extends CardDef {
              static displayName = 'Wedge';
              @field title = contains(StringField);
              @field blockMainThread = contains(BooleanField);
              static isolated = class Isolated extends Component<typeof this> {
                get renderedTitle() {
                  if (this.args.model.blockMainThread) {
                    let deadline = performance.now() + ${MAIN_THREAD_BLOCK_MS};
                    while (performance.now() < deadline) {
                      // hold the main thread so the render cannot settle
                    }
                  }
                  return this.args.model.title;
                }
                <template><h1 data-test-wedge-title>{{this.renderedTitle}}</h1></template>
              };
            }
          `,
          // Healthy at boot: the flag is off, so the fixture build renders
          // real HTML for this row — the last-known-good content the error
          // row must preserve.
          'wedge-1.json': {
            data: {
              attributes: {
                title: 'calm before the block',
                blockMainThread: false,
              },
              meta: {
                adoptsFrom: {
                  module: rri('./wedge'),
                  name: 'Wedge',
                },
              },
            },
          },
        },
      },
      {
        realmURL: healthyRealmURL,
        permissions: {
          '*': ['read'],
          '@user2:localhost': ['read', 'write', 'realm-owner'],
        },
        fileSystem: {
          'person.gts': `
            import { CardDef, field, contains, StringField, Component } from '@cardstack/base/card-api';
            import NumberField from '@cardstack/base/number';

            export class Person extends CardDef {
              static displayName = 'Person';
              @field firstName = contains(StringField);
              @field hourlyRate = contains(NumberField);
              static isolated = class Isolated extends Component<typeof this> {
                <template><h1><@fields.firstName /> \${{@model.hourlyRate}}</h1></template>
              };
            }
          `,
          'steady-1.json': {
            data: {
              attributes: { firstName: 'Steady', hourlyRate: 25 },
              meta: {
                adoptsFrom: {
                  module: rri('./person'),
                  name: 'Person',
                },
              },
            },
          },
        },
      },
    ],
    onRealmSetup({ dbAdapter: setupDbAdapter, realms }) {
      dbAdapter = setupDbAdapter;
      [badRealm, healthyRealm] = realms.map((r) => r.realm);
    },
  });

  test('a render that never settles yields a persisted error row within budget, no reconcile churn, and a healthy rest-of-system', async function (assert) {
    // The wedged visit alone costs the full client budget; the surrounding
    // writes, settles, and renders share the rest.
    assert.timeout(240_000);
    let wedgeCardURL = `${badRealmURL}wedge-1.json`;

    // ── the boot rendered real HTML while the flag was off ─────────────
    let bootRow = await prerenderedHtmlRowFor(dbAdapter, wedgeCardURL);
    assert.ok(
      bootRow?.isolated_html?.includes('calm before the block'),
      'the card has last-known-good HTML from its healthy render',
    );
    assert.notOk(bootRow?.error_doc, 'no error recorded on the healthy row');

    // ── flip the flag: the next HTML visit can never settle ────────────
    let badBaseline = await maxPrerenderHtmlJobId(dbAdapter, badRealmURL);
    let started = Date.now();
    await badRealm.write(
      'wedge-1.json',
      wedgeDoc('calm before the block', true),
    );
    // Settles only when the spawned prerender_html job RESOLVES — a job
    // that rejects (the whole-batch failure this test guards against)
    // throws here. Per-URL failure isolation means the wedged visit's
    // failure is recorded and the job itself completes.
    await settlePrerenderHtmlJobs(dbAdapter, badRealmURL, {
      afterJobId: badBaseline,
      timeout: 120_000,
    });
    let elapsedMs = Date.now() - started;
    assert.true(
      elapsedMs < 60_000,
      `the visit failed within the client's request budget (${elapsedMs}ms) — bounded by the abort, not by multi-minute server burns`,
    );

    // ── a real error row is persisted, in the retry lane's shape ───────
    let errorRow = await prerenderedHtmlRowFor(dbAdapter, wedgeCardURL);
    let errorDoc = errorRow?.error_doc as {
      visitRequestFailure?: true;
      consecutiveVisitFailures?: number;
    } | null;
    assert.ok(errorDoc, 'an error row is persisted for the wedged visit');
    assert.true(
      errorDoc?.visitRequestFailure,
      'marked as a visit-request failure: the request was aborted before the render returned any verdict',
    );
    assert.strictEqual(
      errorDoc?.consecutiveVisitFailures,
      1,
      'the failure starts a consecutive-failure run of one — the counter the bounded retry lane caps on',
    );
    assert.strictEqual(
      errorRow?.generation,
      await currentRealmGeneration(dbAdapter, badRealmURL),
      'the error row is stamped at the generation the failing pass targeted, so it reads as the recorded outcome rather than residue',
    );
    assert.ok(
      errorRow?.isolated_html?.includes('calm before the block'),
      'last-known-good HTML is preserved beneath the error',
    );
    let fileErrorRow = await prerenderedHtmlRowFor(
      dbAdapter,
      wedgeCardURL,
      'file',
    );
    assert.ok(
      fileErrorRow?.error_doc,
      "the file rendering row records the failure too — both of the URL's rows carry the outcome",
    );

    // ── the reconcile sweep does not re-enqueue the failed batch ───────
    let badJobsBefore = await maxPrerenderHtmlJobId(dbAdapter, badRealmURL);
    let healthyJobsBefore = await maxPrerenderHtmlJobId(
      dbAdapter,
      healthyRealmURL,
    );
    let publisher = new PgQueuePublisher(dbAdapter);
    try {
      let result = await prerenderHtmlReconcile({
        reportStatus: () => {},
        log: logger('prerender-never-settles-test'),
        dbAdapter,
        queuePublisher: publisher,
        indexWriter: null as unknown as IndexWriter,
        prerenderer: null as unknown as Prerenderer,
        definitionLookup: null as unknown as DefinitionLookup,
        virtualNetwork: null as unknown as VirtualNetwork,
        matrixURL: matrixURL.href,
        getReader: () => {
          throw new Error('getReader is not used by prerender-html-reconcile');
        },
        getAuthedFetch: async () => globalThis.fetch,
        createPrerenderAuth: () => '',
      })({});
      assert.deepEqual(
        result,
        { realmsRepaired: 0, urlsEnqueued: 0, realmsInBackoff: 0 },
        'the sweep treats the fresh error row as the recorded outcome and enqueues nothing',
      );
    } finally {
      await publisher.destroy();
    }
    assert.strictEqual(
      await maxPrerenderHtmlJobId(dbAdapter, badRealmURL),
      badJobsBefore,
      'no repair job re-enqueued for the failing realm',
    );
    assert.strictEqual(
      await maxPrerenderHtmlJobId(dbAdapter, healthyRealmURL),
      healthyJobsBefore,
      'no spurious job enqueued for the healthy realm either',
    );

    // ── other realms keep working while the bad card stands broken ─────
    let healthyBaseline = await maxPrerenderHtmlJobId(
      dbAdapter,
      healthyRealmURL,
    );
    await healthyRealm.write('steady-1.json', personDoc('Steady', 60));
    await settlePrerenderHtmlJobs(dbAdapter, healthyRealmURL, {
      afterJobId: healthyBaseline,
      timeout: 60_000,
    });
    let healthyRow = await prerenderedHtmlRowFor(
      dbAdapter,
      `${healthyRealmURL}steady-1.json`,
    );
    assert.ok(
      healthyRow?.isolated_html?.includes('$60'),
      "the healthy realm's write → index → render pipeline lands fresh HTML while the bad card is still broken",
    );
    assert.strictEqual(
      healthyRow?.generation,
      await currentRealmGeneration(dbAdapter, healthyRealmURL),
      "the healthy realm's HTML is stamped at its own current generation",
    );
    let rowWhileBroken = await prerenderedHtmlRowFor(dbAdapter, wedgeCardURL);
    assert.ok(
      (rowWhileBroken?.error_doc as { visitRequestFailure?: true } | null)
        ?.visitRequestFailure,
      "the bad card's recorded failure still stands — the healthy realm's progress did not disturb it",
    );

    // ── fixing the card heals the row; the tab pool recovered ──────────
    let healBaseline = await maxPrerenderHtmlJobId(dbAdapter, badRealmURL);
    await badRealm.write('wedge-1.json', wedgeDoc('unblocked at last', false));
    await settlePrerenderHtmlJobs(dbAdapter, badRealmURL, {
      afterJobId: healBaseline,
      timeout: 60_000,
    });
    let healedRow = await prerenderedHtmlRowFor(dbAdapter, wedgeCardURL);
    assert.notOk(
      healedRow?.error_doc,
      'a successful render replaces the error row outright, ending the consecutive-failure run',
    );
    assert.ok(
      healedRow?.isolated_html?.includes('unblocked at last'),
      "the realm's affinity renders normally after the wedged tab was disposed",
    );
  });
});
