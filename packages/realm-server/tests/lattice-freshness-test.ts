import QUnit from 'qunit';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PgQueueRunner, type PgAdapter } from '@cardstack/postgres';
import {
  IndexWriter,
  Worker,
  rri,
  type QueuePublisher,
  type Realm,
  type VirtualNetwork,
  type Prerenderer as Renderer,
} from '@cardstack/runtime-common';
import { LatticeRealmConfig } from '@cardstack/runtime-common/lattice-config';
import type { LatticeNativeCardIndexer } from '@cardstack/runtime-common/lattice-native-index';
import { registerUser } from '../synapse.ts';
import { browse } from '../../boxel-cli/src/commands/browse.ts';
import { matrixLogin } from '../../boxel-cli/src/lib/auth.ts';
import { ProfileManager } from '../../boxel-cli/src/lib/profile-manager.ts';
import { LatticeBxlWorker } from '../lib/lattice-bxl-derivation.ts';
import { LatticePublicationDispatcher } from '../lib/lattice-publication-dispatcher.ts';
import { publishedNativeIndexer } from './helpers/lattice-captured-native-indexer.ts';
import type { Prerenderer } from '../prerender/prerenderer.ts';
import {
  localBaseRealm,
  getPrerendererForTesting,
  matrixRegistrationSecret,
  realmServerTestMatrix,
  realmSecretSeed,
  testRealmServerMatrixUsername,
  setupPermissionedRealm,
  testCreatePrerenderAuth,
  waitUntil,
} from './helpers/index.ts';
import {
  latticeParityFixtures,
  latticeParitySource,
} from './helpers/lattice-parity-fixture.ts';
import { installRealmServerAssertOwnRealmServerBypassPatch } from './helpers/prerender-page-patches.ts';

const mode = 'on';
const origin = 'http://127.0.0.1:4454/';
const realmURL = origin + 'lattice-freshness/';
const owner = realmURL + 'Day/blue';
const target = realmURL + 'Observation/two';
const username = `lattice-freshness-${process.pid}`;
const actor = `@${username}:localhost`;
const password = 'synthetic-freshness-password';
// Reuse the G1 model, including its query-on-query dependency, and the normal
// delegated editor. This measures publication into two existing client stores.
const source = latticeParitySource
  .replace('linksToMany }', 'linksToMany, getComponent }')
  .replace(
    '<template><output>{{@model.cardTitle}}: {{@model.postedCount}} / {{@model.total}}</output></template>',
    `draft = new Observation({ room: 'Unsaved local draft', status: 'draft', ratings: [] });
     Editor = getComponent(this.draft);
     <template>
       <section data-lattice-freshness data-state={{@model.publicationState}}>
         <h1>{{@model.cardTitle}}</h1>
         <output data-count>{{@model.postedCount}}</output>
         <output data-total>{{@model.total}}</output>
         {{#each @model.selected as |row|}}{{#if row}}
           <div data-row={{row.id}}>{{row.room}} / {{row.status}} / {{row.score}}</div>
         {{/if}}{{/each}}
         <div data-editor><this.Editor @format="edit" /></div>
       </section>
     </template>`,
  );

// Opt-in measurement, never an automatic timing assertion in ordinary CI.
if (process.env.LATTICE_MEASURE_FRESHNESS === '1') {
  QUnit.module('Lattice | two-store freshness measurement', (hooks) => {
    const writeTransport =
      process.env.LATTICE_FRESHNESS_WRITE_TRANSPORT === 'store'
        ? 'store'
        : 'http';
    let db: PgAdapter;
    let publisher: QueuePublisher;
    let materializationRunner: PgQueueRunner | undefined;
    let network: VirtualNetwork;
    let realm: Realm;
    let rendererProcess: Prerenderer;
    let chrome: Browser;
    let bxl: LatticeBxlWorker;
    let native: LatticeNativeCardIndexer | undefined;
    let dispatcher: LatticePublicationDispatcher | undefined;
    let profileDir: string;
    let patch: ReturnType<
      typeof installRealmServerAssertOwnRealmServerBypassPatch
    >;
    const nativeURLs: string[] = [];
    const browserURLs: string[] = [];
    const activeRenders = new Set<{ url: string; kind: string }>();
    const failures: string[] = [];
    const trials: Record<string, unknown>[] = [];
    const evidencePath =
      process.env.LATTICE_FRESHNESS_OUTPUT ??
      join(tmpdir(), `lattice-freshness-${mode}.json`);
    const renderer: Renderer = {
      async prerenderVisit(args) {
        if (args.visitType === 'index') browserURLs.push(args.url);
        const activity = { url: args.url, kind: args.visitType ?? 'fused' };
        activeRenders.add(activity);
        try {
          return (await rendererProcess.prerenderVisit(args)).response;
        } finally {
          activeRenders.delete(activity);
        }
      },
      async prerenderModule(args) {
        return (await rendererProcess.prerenderModule(args)).response;
      },
      async releaseBatch(args) {
        await rendererProcess.releaseBatch(args);
      },
      async runCommand() {
        throw new Error('Unexpected freshness command');
      },
    };
    hooks.before(async (assert) => {
      // Allow the cold fixture/bootstrap the same budget as other real-browser
      // fixtures. Per-write and confirmed-DOM deadlines below stay unchanged.
      assert.timeout(300_000);
      console.log('LATTICE_FRESHNESS_SETUP register-user');
      await registerUser({
        matrixURL: realmServerTestMatrix.url,
        registrationSecret: matrixRegistrationSecret,
        username,
        password,
        displayname: 'Synthetic freshness client',
      });
      console.log('LATTICE_FRESHNESS_SETUP registered');
      patch = installRealmServerAssertOwnRealmServerBypassPatch();
      rendererProcess = getPrerendererForTesting({
        serverURL: origin,
        maxPages: 2,
      });
      bxl = new LatticeBxlWorker();
      profileDir = await mkdtemp(join(tmpdir(), 'lattice-freshness-profile-'));
      chrome = await puppeteer.launch({
        headless: true,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
        args: ['--no-sandbox'],
      });
      console.log('LATTICE_FRESHNESS_SETUP browser-ready');
    });
    setupPermissionedRealm(hooks, {
      latticeEnabled: true,
      mode: 'before',
      realmURL: new URL(realmURL),
      permissions: { '*': ['read'], [actor]: ['read', 'write', 'realm-owner'] },
      fileSystem: { 'cards.gts': source, ...latticeParityFixtures(realmURL) },
      prerenderer: renderer,
      assetsURL: new URL(process.env.HOST_URL ?? 'http://localhost:4200/'),
      nativeCardIndexer: async (request) => {
        const result = await native?.(request);
        if (result) nativeURLs.push(request.url);
        return result;
      },
      onRealmSetup({
        dbAdapter,
        publisher: fixturePublisher,
        virtualNetwork,
        testRealm,
      }) {
        db = dbAdapter;
        publisher = fixturePublisher;
        network = virtualNetwork;
        realm = testRealm;
        console.log('LATTICE_FRESHNESS_SETUP fixture-ready');
        network.mount(async (request) => {
          if (!request.url.startsWith(origin + 'base/')) return null;
          if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method))
            return new Response(null, { status: 405 });
          const headers = new Headers(request.headers);
          headers.delete('authorization');
          return fetch(
            request.url.replace(origin + 'base/', localBaseRealm + '/'),
            { method: request.method, headers, signal: request.signal },
          );
        });
      },
    });
    hooks.before(async (assert) => {
      assert.timeout(300_000);
      // Source indexing has completed in setup. Admit the native processor
      // before draining secondary materialization; otherwise startup owners
      // must finish through Chrome before the Node path can be installed.
      native = await publishedNativeIndexer({
        db,
        network,
        realm,
        actor,
        renderer,
        worker: bxl,
        refs: ['Day', 'Observation'].map((name) => ({
          module: rri(realmURL + 'cards'),
          name,
        })),
        sourcePaths: [
          'cards.gts',
          ...Object.keys(latticeParityFixtures(realmURL)),
        ],
        createPrerenderAuth: testCreatePrerenderAuth,
      });
      console.log('LATTICE_FRESHNESS_SETUP native-ready');
      // Mirror the dedicated materialization lane already supported by the
      // worker manager. The fixture's general runner can be occupied by HTML
      // that itself needs a publication; a priority number cannot preempt it.
      const lattice = new LatticeRealmConfig([realmURL]);
      materializationRunner = new PgQueueRunner({
        adapter: db,
        workerId: `freshness-materialize-${process.pid}`,
        lattice,
      });
      const materializationWorker = new Worker({
        indexWriter: new IndexWriter(db, { lattice }),
        queue: materializationRunner,
        dbAdapter: db,
        queuePublisher: publisher,
        virtualNetwork: network,
        matrixURL: realmServerTestMatrix.url,
        realmServerMatrixUsername: testRealmServerMatrixUsername,
        secretSeed: realmSecretSeed,
        prerenderer: renderer,
        nativeCardIndexer: async (request) => {
          const result = await native?.(request);
          if (result) nativeURLs.push(request.url);
          return result;
        },
        createPrerenderAuth: testCreatePrerenderAuth,
        latticeJobsOnly: true,
      });
      await materializationWorker.run();
      await idle(180_000);
    });
    hooks.after(async () => {
      await writeFile(
        evidencePath,
        JSON.stringify(
          {
            mode,
            writeTransport,
            workerLanes: ['fixture-general', 'lattice-materialize'],
            gitHead: process.env.LATTICE_FRESHNESS_HEAD,
            host: process.env.HOST_URL,
            realmURL,
            sourceSha256: createHash('sha256').update(source).digest('hex'),
            fixtureSha256: createHash('sha256')
              .update(JSON.stringify(latticeParityFixtures(realmURL)))
              .digest('hex'),
            cards: 5,
            realmServerPID: process.pid,
            trials,
            failures,
          },
          null,
          2,
        ),
      );
      await chrome?.close();
      await dispatcher?.shutDown();
      await materializationRunner?.destroy();
      await patch?.restore();
      await bxl?.close();
      await rendererProcess?.stop();
      if (profileDir) await rm(profileDir, { recursive: true, force: true });
    });
    async function idle(timeout = 60_000) {
      try {
        await waitUntil(
          async () =>
            !(
              await db.execute(
                "SELECT 1 FROM jobs WHERE status='unfulfilled' LIMIT 1",
              )
            ).length,
          { timeout, timeoutMessage: 'Freshness queue did not settle' },
        );
      } catch (error) {
        failures.push(String(error));
        console.error(
          'LATTICE_FRESHNESS_QUEUE_TIMEOUT',
          JSON.stringify({
            jobs: await db.execute(
              "SELECT id,job_type,status FROM jobs WHERE status='unfulfilled' ORDER BY id",
            ),
            activeRenders: [...activeRenders],
            nativeURLs: nativeURLs.slice(-10),
            browserURLs: browserURLs.slice(-10),
          }),
        );
        throw error;
      }
    }
    QUnit.test(
      'one warmup and three writes reach both confirmed DOMs',
      async (assert) => {
        assert.timeout(180_000);
        dispatcher = new LatticePublicationDispatcher({
          lattice: new LatticeRealmConfig([realmURL]),
          dbAdapter: db,
          send: (requestedRealm, roomId, event, signal) => {
            if (requestedRealm !== realmURL)
              throw new Error('Outside freshness realm');
            return realm.deliverPublicationEvent(roomId, event, signal);
          },
        });
        await dispatcher.start();
        const auth = await matrixLogin(
          realmServerTestMatrix.url.href,
          username,
          password,
        );
        const profile = new ProfileManager(profileDir);
        await profile.addProfileWithAuth(
          auth.userId,
          auth,
          'Freshness test',
          origin,
        );
        const pages: Page[] = [];
        for (let i = 0; i < 2; i++) {
          const context = await chrome.createBrowserContext();
          const page = await context.newPage();
          pages.push(page);
          page.on('pageerror', (error) => failures.push(String(error)));
          await page.setViewport({ width: 1200, height: 900 });
          if (i) {
            const storage = await pages[0].evaluate(() =>
              Object.entries(localStorage),
            );
            await context.setCookie(
              ...(await pages[0].browserContext().cookies()),
            );
            await page.evaluateOnNewDocument((entries: [string, string][]) => {
              for (const [key, value] of entries)
                localStorage.setItem(key, value);
            }, storage);
            await page.goto(pages[0].url(), { waitUntil: 'domcontentloaded' });
          } else {
            await browse(owner, {
              profile: auth.userId,
              profileManager: profile,
              hostUrl: origin,
              log: () => {},
              openBrowserFn: async (url) => {
                await page.goto(url, { waitUntil: 'domcontentloaded' });
                return true;
              },
            });
          }
          try {
            await page.waitForFunction(
              () =>
                document.querySelector('[data-count]')?.textContent === '1' &&
                document.querySelector('[data-total]')?.textContent === '5',
              { timeout: 30_000, polling: 'mutation' },
            );
          } catch (error) {
            failures.push(String(error));
            await page.screenshot({
              path: `${evidencePath}.startup.png`,
              fullPage: true,
            });
            console.error(
              'LATTICE_FRESHNESS_STARTUP',
              JSON.stringify({
                mode,
                browser: await page.evaluate((id) => {
                  const store = (window as any)['@cardstack/host']?.lookup(
                    'service:store',
                  );
                  const card = store?.peek(id);
                  return {
                    text: document.body.innerText.slice(0, 4000),
                    card: card && {
                      room: card.room,
                      total: card.total,
                      postedCount: card.postedCount,
                      submittedIds: card.submittedIds,
                    },
                  };
                }, owner),
                rows: await db.execute(
                  "SELECT url,has_error,pristine_doc->'attributes' AS attributes,error_doc FROM boxel_index WHERE type='instance' ORDER BY url",
                ),
              }),
            );
            throw error;
          }
          await page.evaluate((id) => {
            (window as any).freshnessIdentity = {
              card: (window as any)['@cardstack/host']
                .lookup('service:store')
                .peek(id),
              section: document.querySelector('[data-lattice-freshness]'),
            };
          }, owner);
        }
        await pages[0].focus('[data-editor] input');
        await pages[0].keyboard.type('Keep this exact pending draft');
        const draftBefore = await pages[0].$eval(
          '[data-editor] input',
          (input) => (input as HTMLInputElement).value,
        );
        const sessions = JSON.parse(
          testCreatePrerenderAuth(actor, {
            [realmURL]: ['read', 'write', 'realm-owner'],
          }),
        );
        if (writeTransport === 'store') {
          // Load the edited card once before measuring. A save through the
          // real Store must preserve this identity and its authored values,
          // independently of the later dashboard publication.
          await pages[0].evaluate(async (id) => {
            const store = (window as any)['@cardstack/host'].lookup(
              'service:store',
            );
            (window as any).freshnessWriterCard = await store.get(id);
          }, target);
        }
        for (let i = 0; i < 4; i++) {
          await idle();
          const done = i % 2 === 0;
          const score = i + 8;
          const expected = {
            count: done ? 2 : 1,
            total: done ? score + 5 : 5,
            score,
            done,
          };
          const nativeStart = nativeURLs.length,
            browserStart = browserURLs.length;
          // Install both observers before dispatch. An acknowledgement is not a
          // freshness result; these settle independently when the complete DOM agrees.
          await Promise.all(
            pages.map((page) =>
              page.evaluate(
                ({ expected }) => {
                  (window as any).freshnessResult = new Promise<number>(
                    (resolve, reject) => {
                      const began = performance.now();
                      const check = () => {
                        const section = document.querySelector(
                          '[data-lattice-freshness]',
                        );
                        const rows = [
                          ...document.querySelectorAll('[data-row]'),
                        ]
                          .map((row) => row.textContent?.trim())
                          .sort();
                        const wanted = [
                          'blue / done / 5',
                          ...(expected.done
                            ? [`blue / done / ${expected.score}`]
                            : []),
                        ].sort();
                        if (
                          document.querySelector('[data-count]')
                            ?.textContent === String(expected.count) &&
                          document.querySelector('[data-total]')
                            ?.textContent === String(expected.total) &&
                          JSON.stringify(rows) === JSON.stringify(wanted) &&
                          section?.getAttribute('data-state') === 'ready'
                        ) {
                          observer.disconnect();
                          clearTimeout(timeout);
                          resolve(performance.timeOrigin + performance.now());
                        }
                      };
                      const observer = new MutationObserver(check);
                      const timeout = setTimeout(() => {
                        observer.disconnect();
                        reject(
                          new Error(
                            `DOM did not confirm within ${performance.now() - began} ms`,
                          ),
                        );
                      }, 30_000);
                      observer.observe(document.body, {
                        childList: true,
                        subtree: true,
                        characterData: true,
                        attributes: true,
                      });
                      check();
                    },
                  );
                  void (window as any).freshnessResult.catch(() => {});
                },
                { expected },
              ),
            ),
          );
          const observers: Promise<number>[] = pages.map((page) =>
            page.evaluate(() => (window as any).freshnessResult),
          );
          for (const observer of observers) void observer.catch(() => {});
          const started = Date.now();
          let trial: Record<string, unknown> = {
            warmup: i === 0,
            expected,
            started,
          };
          trials.push(trial);
          try {
            if (writeTransport === 'store') {
              const saved = await pages[0].evaluate(
                async ({ id, done, score, i }) => {
                  const store = (window as any)['@cardstack/host'].lookup(
                    'service:store',
                  );
                  const result = await store.patch(
                    id,
                    {
                      attributes: {
                        status: done ? 'done' : 'draft',
                        ratings: [{ metric: 'focus', points: score }],
                      },
                    },
                    { clientRequestId: `instance:lattice-freshness-${i}` },
                  );
                  const current = store.peek(id);
                  return {
                    saved: !!result?.id && !result.errors,
                    identity: current === (window as any).freshnessWriterCard,
                    status: current?.status,
                    points: current?.ratings?.map(
                      (rating: { points: number }) => rating.points,
                    ),
                  };
                },
                { id: target, done, score, i },
              );
              trial.ackMs = Date.now() - started;
              trial.writer = saved;
              assert.true(saved.saved, 'real Store save succeeds');
              assert.true(
                saved.identity,
                'saving Store preserves the edited card identity',
              );
              assert.strictEqual(
                saved.status,
                done ? 'done' : 'draft',
                'saving Store reads its authored status',
              );
              assert.deepEqual(
                saved.points,
                [score],
                'saving Store reads its authored values',
              );
            } else {
              const response = await fetch(target, {
                method: 'PATCH',
                headers: {
                  Accept: 'application/vnd.card+json',
                  'Content-Type': 'application/vnd.card+json',
                  Authorization: `Bearer ${sessions[realmURL]}`,
                },
                body: JSON.stringify({
                  data: {
                    type: 'card',
                    attributes: {
                      status: done ? 'done' : 'draft',
                      ratings: [{ metric: 'focus', points: score }],
                    },
                    meta: {
                      adoptsFrom: { module: '../cards', name: 'Observation' },
                    },
                  },
                }),
                signal: AbortSignal.timeout(45_000),
              });
              trial.ackMs = Date.now() - started;
              assert.strictEqual(
                response.status,
                200,
                (await response.text()).slice(0, 300),
              );
            }
            const stamps = await Promise.all(observers);
            trial.clientMs = stamps.map((stamp) => Math.round(stamp - started));
            trial.bothMs = Math.round(Math.max(...stamps) - started);
            trial.nativeURLs = nativeURLs.slice(nativeStart);
            trial.browserURLs = browserURLs.slice(browserStart);
            const values = await Promise.all(
              pages.map((page) =>
                page.evaluate((id) => {
                  const card = (window as any)['@cardstack/host']
                    .lookup('service:store')
                    .peek(id);
                  const old = (window as any).freshnessIdentity;
                  return {
                    room: card.room,
                    cardTitle: card.cardTitle,
                    total: card.total,
                    postedCount: card.postedCount,
                    submittedIds: [...card.submittedIds].sort(),
                    selected: card.selected
                      .map((row: any) => ({
                        id: row.id,
                        room: row.room,
                        status: row.status,
                        score: row.score,
                      }))
                      .sort((a: any, b: any) => a.id.localeCompare(b.id)),
                    sameCard: old.card === card,
                    sameSection:
                      old.section ===
                      document.querySelector('[data-lattice-freshness]'),
                    draft: (
                      document.querySelector(
                        '[data-editor] input',
                      ) as HTMLInputElement
                    )?.value,
                  };
                }, owner),
              ),
            );
            trial.values = values;
            for (const value of values) {
              assert.strictEqual(value.postedCount, expected.count);
              assert.strictEqual(value.total, expected.total);
              assert.deepEqual(
                value.submittedIds,
                [
                  realmURL + 'Observation/one',
                  ...(done ? [target] : []),
                ].sort(),
              );
              assert.true(value.sameCard);
              assert.true(value.sameSection);
            }
            assert.strictEqual(
              values[0].draft,
              draftBefore,
              'delegated draft preserved',
            );
            assert.ok(
              nativeURLs.slice(nativeStart).includes(target + '.json'),
              'source ran on the admitted Node path',
            );
            assert.ok(
              nativeURLs.slice(nativeStart).includes(owner + '.json'),
              'owner ran on the admitted Node path',
            );
            console.log(
              'LATTICE_FRESHNESS',
              JSON.stringify({ mode, ...trial }),
            );
          } catch (error) {
            trial.error = String(error);
            failures.push(String(error));
            await Promise.allSettled(observers);
            throw error;
          }
        }
        for (const [i, page] of pages.entries())
          await page.screenshot({
            path: `${evidencePath}.client-${i + 1}.png`,
            fullPage: true,
          });
        assert.deepEqual(failures, [], 'no client errors');
        await idle();
      },
    );
  });
}
