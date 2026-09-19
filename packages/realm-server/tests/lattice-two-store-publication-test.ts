import { LatticeRealmConfig } from '@cardstack/runtime-common/lattice-config';
import { LatticePublicationDispatcher } from '../lib/lattice-publication-dispatcher.ts';
import QUnit from 'qunit';
import puppeteer, {
  type Browser,
  type Page,
  type HTTPRequest,
} from 'puppeteer';
import {
  latticeDisplayBatchResults,
  type LatticeDisplayBatchRequest,
  type LatticeDisplayBatchResponse,
} from '@cardstack/runtime-common/lattice-display';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { PgAdapter } from '@cardstack/postgres';
import {
  Deferred,
  rri,
  type VirtualNetwork,
  type Realm,
  type Prerenderer as Renderer,
} from '@cardstack/runtime-common';
import type { LatticeNativeCardIndexer } from '@cardstack/runtime-common/lattice-native-index';
import { registerUser } from '../synapse.ts';
import { browse } from '../../boxel-cli/src/commands/browse.ts';
import { matrixLogin } from '../../boxel-cli/src/lib/auth.ts';
import { ProfileManager } from '../../boxel-cli/src/lib/profile-manager.ts';
import { LatticeBxlWorker } from '../lib/lattice-bxl-derivation.ts';
import { publishedNativeIndexer } from './helpers/lattice-captured-native-indexer.ts';
import type { Prerenderer } from '../prerender/prerenderer.ts';
import {
  localBaseRealm,
  getPrerendererForTesting,
  matrixRegistrationSecret,
  realmServerTestMatrix,
  setupPermissionedRealm,
  testCreatePrerenderAuth,
  waitUntil,
} from './helpers/index.ts';
import {
  latticeParitySource,
  latticeParityFixtures,
} from './helpers/lattice-parity-fixture.ts';
import { installRealmServerAssertOwnRealmServerBypassPatch } from './helpers/prerender-page-patches.ts';

const { module, test } = QUnit;
const origin = 'http://127.0.0.1:4454/';
const realmURL = origin + 'lattice-continuity/';
const owner = realmURL + 'Day/blue';
const username = `lattice-client-${process.pid}`;
const actor = `@${username}:localhost`;
const password = 'synthetic-client-password';
// Reuse the parity model and BXL computations. Only this test presentation adds
// complete output rows and a normal delegated editor for an unsaved card.
const source = latticeParitySource
  .replace('linksToMany }', 'linksToMany, getComponent }')
  .replace(
    '<template><output>{{@model.cardTitle}}: {{@model.postedCount}} / {{@model.total}}</output></template>',
    `draft = new Observation({ room: 'Unsaved local draft', status: 'draft', ratings: [] });
     Editor = getComponent(this.draft);
     <template>
       <section data-lattice-continuity data-state={{@model.publicationState}}>
         <output data-count>{{@model.postedCount}}</output>
         <output data-total>{{@model.total}}</output>
         {{#each @model.selected as |row|}}{{#if row}}
           <div data-row={{row.id}}>{{row.room}} / {{row.status}} / {{row.score}}</div>
         {{/if}}{{/each}}
         <div data-editor><this.Editor @format="edit" /></div>
       </section>
     </template>`,
  );

module(basename(import.meta.filename), function (hooks) {
  let db: PgAdapter;
  let network: VirtualNetwork;
  let fixtureRealm: Realm;
  let render: Prerenderer;
  let chrome: Browser;
  let bxl: LatticeBxlWorker;
  let native: LatticeNativeCardIndexer | undefined;
  let nativeURLs: string[] = [];
  const nativeAttempts: Array<{
    url: string;
    inputGeneration?: number;
    generation: number;
  }> = [];
  let heldOwner:
    | { entered: Deferred<void>; release: Deferred<void> }
    | undefined;
  let restore: ReturnType<
    typeof installRealmServerAssertOwnRealmServerBypassPatch
  >;
  let profileDir: string;
  let dispatcher: LatticePublicationDispatcher | undefined;
  const exchanges: Array<{
    page: Page;
    request: LatticeDisplayBatchRequest;
    response: LatticeDisplayBatchResponse;
    status: number;
    authority: string | undefined;
  }> = [];
  const readingExchanges: Promise<void>[] = [];
  const exchangeErrors: string[] = [];
  const renderer: Renderer = {
    async prerenderVisit(args) {
      return (await render.prerenderVisit(args)).response;
    },
    async prerenderModule(args) {
      return (await render.prerenderModule(args)).response;
    },
    async releaseBatch(args) {
      await render.releaseBatch(args);
    },
    async runCommand() {
      throw new Error('Unexpected fixture command');
    },
  };
  hooks.before(async () => {
    await registerUser({
      matrixURL: realmServerTestMatrix.url,
      registrationSecret: matrixRegistrationSecret,
      username,
      password,
      displayname: 'Synthetic Lattice client',
    });
    restore = installRealmServerAssertOwnRealmServerBypassPatch();
    render = getPrerendererForTesting({ serverURL: origin, maxPages: 2 });
    bxl = new LatticeBxlWorker();
    profileDir = await mkdtemp(join(tmpdir(), 'lattice-continuity-profile-'));
    chrome = await puppeteer.launch({
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
      args: ['--no-sandbox'],
    });
  });
  hooks.after(async () => {
    await restore?.restore();
    await bxl?.close();
    await render?.stop();
    await rm(profileDir, { recursive: true, force: true });
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
      if (heldOwner && request.url === owner + '.json') {
        heldOwner.entered.fulfill();
        await heldOwner.release.promise;
      }
      const result = await native?.(request);
      if (result) {
        nativeURLs.push(request.url);
        nativeAttempts.push({
          url: request.url,
          inputGeneration: request.inputSnapshot?.generation,
          generation: request.generation,
        });
      }
      return result;
    },
    onRealmSetup({ dbAdapter, virtualNetwork, testRealm }) {
      fixtureRealm = testRealm;
      db = dbAdapter;
      network = virtualNetwork;
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

  hooks.after(async () => {
    heldOwner?.release.fulfill();
    await chrome?.close();
    await dispatcher?.shutDown();
  });

  async function idle() {
    await waitUntil(
      async () =>
        !(
          await db.execute(
            "SELECT 1 FROM jobs WHERE status='unfulfilled' LIMIT 1",
          )
        ).length,
      { timeout: 60_000, timeoutMessage: 'Fixture queue failed to settle' },
    );
  }

  async function enableNative() {
    native = await publishedNativeIndexer({
      db,
      network,
      realm: fixtureRealm,
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
  }

  async function openClient(
    profile: ProfileManager,
    userId: string,
    existing?: Page,
  ): Promise<Page> {
    const context = await chrome.createBrowserContext();
    const page = await context.newPage();
    await page.setViewport({ width: 1200, height: 900 });
    page.on('response', (response) => {
      if (
        response.url() !== realmURL + '_lattice-read' ||
        response.request().method() !== 'POST'
      )
        return;
      readingExchanges.push(
        (async () => {
          try {
            exchanges.push({
              page,
              request: JSON.parse((await response.request().fetchPostData())!),
              response: await response.json(),
              status: response.status(),
              authority: response.headers()['x-boxel-realm-url'],
            });
          } catch (error) {
            exchangeErrors.push(String(error));
          }
        })(),
      );
    });
    page.on('pageerror', (error) =>
      console.error('Lattice client error', String(error).slice(0, 500)),
    );
    if (existing) {
      const storage = await existing.evaluate(() =>
        Object.entries(localStorage),
      );
      await context.setCookie(...(await existing.browserContext().cookies()));
      await page.evaluateOnNewDocument((entries: [string, string][]) => {
        for (const [key, value] of entries) localStorage.setItem(key, value);
      }, storage);
      await page.goto(existing.url(), { waitUntil: 'domcontentloaded' });
    } else {
      await browse(owner, {
        profile: userId,
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
      await page.waitForSelector(
        '[data-lattice-continuity][data-state="ready"]',
        { timeout: 30_000 },
      );
    } catch (error) {
      console.error(
        'Lattice client startup state',
        await page.evaluate(() => ({
          text: document.body.innerText.slice(0, 1800),
          state: document
            .querySelector('[data-lattice-continuity]')
            ?.getAttribute('data-state'),
        })),
      );
      throw error;
    }
    return page;
  }

  test('a feeder write updates both mounted stores and keeps an unsaved delegated editor', async (assert) => {
    assert.timeout(180_000);
    console.log('LATTICE_G1C bootstrap');
    await idle();
    try {
      await enableNative();
    } catch (error) {
      console.log(
        'LATTICE_DEFINITION_ERRORS',
        JSON.stringify(
          await db.execute(
            "SELECT url,error_doc->'error'->>'message' AS message,error_doc->'error'->'additionalErrors' AS details FROM modules WHERE error_doc IS NOT NULL",
          ),
        ),
      );
      throw error;
    }
    dispatcher = new LatticePublicationDispatcher({
      lattice: new LatticeRealmConfig([realmURL]),
      dbAdapter: db,
      send: async (requestedRealm, roomId, event, signal) => {
        if (requestedRealm !== realmURL)
          throw new Error('Outside fixture realm');
        return fixtureRealm.deliverPublicationEvent(roomId, event, signal);
      },
    });
    await dispatcher.start();
    console.log(
      'LATTICE_G1C reviewed producer and normal dispatcher installed',
    );
    const auth = await matrixLogin(
      realmServerTestMatrix.url.href,
      username,
      password,
    );
    const profile = new ProfileManager(profileDir);
    await profile.addProfileWithAuth(auth.userId, auth, 'Lattice test', origin);
    const first = await openClient(profile, auth.userId);
    const pages = [first, await openClient(profile, auth.userId, first)];
    for (const page of pages) {
      assert.strictEqual(
        await page.$eval('[data-count]', (e) => e.textContent),
        '1',
      );
      assert.strictEqual(
        await page.$eval('[data-total]', (e) => e.textContent),
        '5',
      );
      await page.evaluate((id) => {
        const app = (window as any)['@cardstack/host'];
        (window as any).latticeContinuity = {
          card: app.lookup('service:store').peek(id),
          section: document.querySelector('[data-lattice-continuity]'),
        };
      }, owner);
    }
    const editing = pages[0];
    await editing.focus('[data-editor] input');
    await editing.keyboard.down('Meta');
    await editing.keyboard.press('a');
    await editing.keyboard.up('Meta');
    await editing.keyboard.type('Keep this exact unsaved draft');
    await editing.$eval('[data-editor] input', (node) => {
      const input = node as HTMLInputElement;
      input.setSelectionRange(5, 15);
      (window as any).latticeContinuity.editor = input;
    });
    const sessions = JSON.parse(
      testCreatePrerenderAuth(actor, {
        [realmURL]: ['read', 'write', 'realm-owner'],
      }),
    );
    const start = performance.now();
    const response = await fetch(realmURL + 'Observation/two', {
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
            status: 'done',
            ratings: [{ metric: 'focus', points: 8 }],
          },
          meta: { adoptsFrom: { module: '../cards', name: 'Observation' } },
        },
      }),
    });
    assert.strictEqual(
      response.status,
      200,
      (await response.text()).slice(0, 300),
    );
    // Each client has its own browser context. A background context may pause
    // animation frames while its Store/DOM still updates. Observe DOM mutations
    // rather than requiring a paint tick to prove publication completion.
    for (const page of pages) {
      try {
        await page.waitForFunction(
          () =>
            document
              .querySelector('[data-lattice-continuity]')
              ?.getAttribute('data-state') === 'ready' &&
            document.querySelector('[data-count]')?.textContent === '2' &&
            document.querySelector('[data-total]')?.textContent === '13' &&
            document.querySelectorAll('[data-row]').length === 2,
          { timeout: 20_000, polling: 'mutation' },
        );
      } catch (error) {
        console.error(
          'LATTICE_CONTINUITY_TIMEOUT',
          JSON.stringify({
            clients: await Promise.all(
              pages.map((client) =>
                client.evaluate(() => ({
                  state: document
                    .querySelector('[data-lattice-continuity]')
                    ?.getAttribute('data-state'),
                  count: document.querySelector('[data-count]')?.textContent,
                  total: document.querySelector('[data-total]')?.textContent,
                  rows: [...document.querySelectorAll('[data-row]')].map(
                    (row) => row.textContent,
                  ),
                })),
              ),
            ),
            owners: await db.execute(
              'SELECT owner_url,dirty_generation,published_generation,input_generation FROM lattice_owners WHERE realm_url=$1',
              { bind: [realmURL] },
            ),
            cards: await db.execute(
              "SELECT url,generation,has_error,pristine_doc->'attributes' AS attributes FROM boxel_index WHERE realm_url=$1 AND type='instance'",
              { bind: [realmURL] },
            ),
            jobs: await db.execute(
              'SELECT id,job_type,status,left(result::text,1000) AS result FROM jobs ORDER BY id DESC LIMIT 20',
            ),
            deliveries: await db.execute(
              'SELECT attempts,delivered_at,terminal_reason,last_error FROM lattice_publication_deliveries ORDER BY next_attempt_at DESC LIMIT 10',
            ),
            nativeURLs,
          }),
        );
        throw error;
      }
      assert.deepEqual(
        await page.$$eval('[data-row]', (rows) =>
          rows
            .map((row) => [
              row.getAttribute('data-row'),
              row.textContent?.trim(),
            ])
            .sort(),
        ),
        [
          [realmURL + 'Observation/one', 'blue / done / 5'],
          [realmURL + 'Observation/two', 'blue / done / 8'],
        ],
        'complete confirmed membership and values',
      );
      assert.true(
        await page.evaluate((id) => {
          const saved = (window as any).latticeContinuity;
          return (
            saved.section ===
              document.querySelector('[data-lattice-continuity]') &&
            saved.card ===
              (window as any)['@cardstack/host']
                .lookup('service:store')
                .peek(id)
          );
        }, owner),
        'existing card and section identities survive publication',
      );
    }
    const confirmedMs = performance.now() - start;
    const assertPublished = async () => {
      const [published] = await db.execute(
        "SELECT pristine_doc FROM boxel_index WHERE url=$1 AND type='instance'",
        { bind: [owner + '.json'] },
      );
      const resource = published.pristine_doc as any;
      // The publication carries query membership in JSON:API data arrays;
      // serializing a live card emits dotted relationship entries instead.
      // Check every identity in both encodings, plus the expected DOM rows.
      const read = await fetch(owner, {
        headers: {
          Accept: 'application/vnd.card+json',
          Authorization: `Bearer ${sessions[realmURL]}`,
        },
      });
      assert.strictEqual(read.status, 200);
      const served = (await read.json()).data;
      assert.deepEqual(
        served.attributes,
        resource.attributes,
        'serving preserves all published attributes',
      );

      for (const page of pages) {
        const data = await page.evaluate(async (id) => {
          const app = (window as any)['@cardstack/host'];
          const api = await app
            .lookup('service:loader-service')
            .loader.import('@cardstack/base/card-api');
          return api.serializeCard(app.lookup('service:store').peek(id), {
            includeComputeds: true,
            omitQueryFields: false,
            includeLinkedResources: false,
            useAbsoluteURL: true,
          }).data;
        }, owner);
        assert.deepEqual(
          data.attributes,
          resource.attributes,
          'all confirmed attributes equal the persisted publication',
        );
        const identities = (relationships: Record<string, any>) => {
          const result: Record<string, string | null> = {};
          const absolute = (value: string | undefined | null) =>
            value == null ? null : new URL(value, owner).href;
          const add = (name: string, value: string | null) => {
            if (name in result && result[name] !== value)
              throw new Error(`Conflicting relationship identity: ${name}`);
            result[name] = value;
          };
          for (const [name, value] of Object.entries(relationships ?? {})) {
            if (Array.isArray(value.data)) {
              if (!value.data.length) add(name, null);
              value.data.forEach((item: { id: string }, index: number) =>
                add(`${name}.${index}`, absolute(item.id)),
              );
            } else if (value.links?.self != null || value.data?.id != null) {
              add(name, absolute(value.data?.id ?? value.links.self));
            } else if (
              !Object.keys(relationships).some((key) =>
                key.startsWith(name + '.'),
              )
            ) {
              add(name, null);
            }
          }
          return result;
        };
        assert.deepEqual(
          identities(served.relationships),
          identities(resource.relationships),
          'serving preserves every persisted relationship identity',
        );
        assert.deepEqual(
          identities(data.relationships),
          identities(served.relationships),
          'all confirmed relationship identities equal the publication',
        );
      }
    };
    await assertPublished();
    assert.deepEqual(
      await editing.evaluate(() => {
        const input = document.querySelector(
          '[data-editor] input',
        ) as HTMLInputElement;
        return {
          same: input === (window as any).latticeContinuity.editor,
          text: input.value,
          focused: document.activeElement === input,
          selection: [input.selectionStart, input.selectionEnd],
        };
      }),
      {
        same: true,
        text: 'Keep this exact unsaved draft',
        focused: true,
        selection: [5, 15],
      },
    );
    assert.true(
      nativeURLs.includes(realmURL + 'Observation/two.json'),
      'feeder executed through Node',
    );
    assert.true(
      nativeURLs.includes(owner + '.json'),
      'owner executed through Node',
    );
    await Promise.all(readingExchanges);
    console.log(
      'LATTICE_BATCH_WIRE',
      JSON.stringify({
        exchanges: exchanges.map((entry) => ({
          request: entry.request,
          status: entry.status,
          results: entry.response.results?.map((item) => ({
            url: item.url,
            kind:
              'publication' in item
                ? 'lattice' in item.publication
                  ? 'reuse'
                  : 'full'
                : 'error',
          })),
        })),
        errors: exchangeErrors,
      }),
    );
    for (const page of pages) {
      const ownerExchanges = exchanges.filter(
        (entry) =>
          entry.page === page && entry.request.required.includes(owner),
      );
      assert.true(
        ownerExchanges.length > 0,
        'each actual Store refresh uses the real batch endpoint',
      );
      assert.true(
        ownerExchanges.some((entry) =>
          entry.response.results.some(
            (result) =>
              result.url === owner &&
              'publication' in result &&
              'data' in result.publication &&
              result.publication.data.attributes?.postedCount === 2,
          ),
        ),
        'changed publication reaches each client as a full body',
      );
      for (const entry of ownerExchanges) {
        assert.strictEqual(entry.status, 200);
        assert.strictEqual(entry.authority, realmURL);
        assert.strictEqual(
          latticeDisplayBatchResults(entry.response, entry.request).size,
          entry.request.required.length,
        );
      }
    }

    // Drive the real event/reload/read/apply path against stored server artifacts.
    // Only transport faults and inventory loss are injected; values still come
    // from the authorized server, and the visible card/editor stay mounted.
    await idle();
    const extra = realmURL + 'Day/empty';
    const loadExtra = async () => {
      await editing.evaluate(async (id) => {
        const store = (window as any)['@cardstack/host'].lookup(
          'service:store',
        );
        store.addReference(id);
        await store.get(id);
      }, extra);
    };
    await loadExtra();
    await editing.evaluate(async () => {
      const app = (window as any)['@cardstack/host'];
      const api = await app
        .lookup('service:loader-service')
        .loader.import('@cardstack/base/card-api');
      const probe = (window as any).latticeContinuity;
      probe.deliveryChanges = [];
      api.subscribeToChanges(probe.card, (_card: unknown, field: string) =>
        probe.deliveryChanges.push(field),
      );
    });
    const trigger = async () =>
      editing.evaluate(
        (args) => {
          const app = (window as any)['@cardstack/host'];
          app.lookup('service:message-service').relayRealmEvent({
            eventName: 'index',
            indexType: 'incremental',
            realmURL: args.realm,
            invalidations: args.ids,
          });
        },
        { realm: realmURL, ids: [owner, extra] },
      );
    const drained = async () => {
      await editing.waitForFunction(
        () => {
          const store = (window as any)['@cardstack/host'].lookup(
            'service:store',
          );
          return store.publicationReloadTask.isIdle && store.reloadTask.isIdle;
        },
        { timeout: 10_000, polling: 20 },
      );
      await Promise.all(readingExchanges);
    };
    const assertContinuity = async (
      state: 'pending' | 'ready',
      label: string,
    ) => {
      const current = await editing.evaluate((id) => {
        const probe = (window as any).latticeContinuity;
        const store = (window as any)['@cardstack/host'].lookup(
          'service:store',
        );
        const input = document.querySelector(
          '[data-editor] input',
        ) as HTMLInputElement | null;
        return {
          card: store.peek(id) === probe.card,
          section:
            document.querySelector('[data-lattice-continuity]') ===
            probe.section,
          state: probe.card.publicationState,
          count: document.querySelector('[data-count]')?.textContent,
          total: document.querySelector('[data-total]')?.textContent,
          editor: input === probe.editor,
          text: input?.value,
          focus: document.activeElement === input,
          selection: input ? [input.selectionStart, input.selectionEnd] : [],
        };
      }, owner);
      assert.deepEqual(
        current,
        {
          card: true,
          section: true,
          state,
          count: '2',
          total: '13',
          editor: true,
          text: 'Keep this exact unsaved draft',
          focus: true,
          selection: [5, 15],
        },
        label,
      );
      if (!current.card || !current.section || !current.editor)
        throw new Error('Display failure replaced a mounted card or draft');
    };
    await editing.evaluate(async (id) => {
      const app = (window as any)['@cardstack/host'];
      const api = await app
        .lookup('service:loader-service')
        .loader.import('@cardstack/base/card-api');
      delete app.lookup('service:store').peek(id)[api.meta].publication!.have;
    }, extra);
    let since = exchanges.length;
    await trigger();
    await drained();
    const partial = exchanges
      .slice(since)
      .find(
        (entry) =>
          entry.page === editing &&
          entry.request.required.includes(owner) &&
          entry.request.required.includes(extra),
      );
    assert.ok(partial, 'two resident card identities share a real request');
    assert.deepEqual(
      partial?.request.have.map((entry) => entry.url),
      [owner],
      'the real server receives partial inventory',
    );
    assert.true(
      partial?.response.results.some(
        (entry) =>
          entry.url === owner &&
          'publication' in entry &&
          'lattice' in entry.publication,
      ),
    );
    assert.true(
      partial?.response.results.some(
        (entry) =>
          entry.url === extra &&
          'publication' in entry &&
          'data' in entry.publication,
      ),
    );
    await assertContinuity(
      'ready',
      'partial inventory keeps the mounted dashboard and draft',
    );

    for (const fault of ['lost', 'evicted', 'omitted', 'failed'] as const) {
      let armed = true;
      const injected = new Deferred<void>();
      const intercept = async (request: HTTPRequest) => {
        if (
          !armed ||
          request.url() !== realmURL + '_lattice-read' ||
          request.method() !== 'POST'
        ) {
          await request.continue();
          return;
        }
        armed = false;
        try {
          const headers = request.headers();
          const upstream = await fetch(request.url(), {
            method: 'POST',
            body: await request.fetchPostData(),
            headers: {
              Accept: 'application/vnd.card+json',
              'Content-Type': 'application/json',
              'X-HTTP-Method-Override': 'QUERY',
              ...(headers.authorization
                ? { Authorization: headers.authorization }
                : {}),
            },
          });
          if (!upstream.ok)
            throw new Error(`Fixture upstream failed (${upstream.status})`);
          const value = (await upstream.json()) as LatticeDisplayBatchResponse;
          if (fault === 'lost' || fault === 'evicted') {
            await editing.evaluate(
              async (args) => {
                const app = (window as any)['@cardstack/host'];
                const api = await app
                  .lookup('service:loader-service')
                  .loader.import('@cardstack/base/card-api');
                const store = app.lookup('service:store');
                if (args.fault === 'evicted') store.store.delete(args.ids[1]);
                else
                  for (const id of args.ids)
                    delete store.peek(id)[api.meta].publication!.have;
              },
              { fault, ids: [owner, extra] },
            );
          }
          if (fault === 'omitted')
            value.results = value.results.filter(
              (entry) => entry.url !== owner,
            );
          if (fault === 'failed')
            value.results = value.results.map((entry) =>
              entry.url === owner
                ? {
                    url: owner,
                    error: {
                      status: 503,
                      message: 'injected transient publication read failure',
                    },
                  }
                : entry,
            );
          value.results.reverse();
          await request.respond({
            status: 200,
            headers: {
              'Content-Type': 'application/vnd.card+json',
              'x-boxel-realm-url': realmURL,
            },
            body: JSON.stringify(value),
          });
          injected.fulfill();
        } catch (error) {
          await request.abort();
          injected.reject(error);
        }
      };
      since = exchanges.length;
      await editing.setRequestInterception(true);
      editing.on('request', intercept);
      try {
        await trigger();
        await injected.promise;
        await drained();
        const reads = exchanges
          .slice(since)
          .filter((entry) => entry.page === editing);
        if (fault === 'lost') {
          assert.strictEqual(
            reads.length,
            2,
            'only one repair exchange after in-flight inventory loss',
          );
          assert.deepEqual(
            reads[1]?.request.required.slice().sort(),
            [owner, extra].sort(),
            'both actual misses share one bounded repair',
          );
          assert.deepEqual(
            reads[1]?.request.have,
            [],
            'repair requires bodies',
          );
          assert.true(
            reads[1]?.response.results.every(
              (entry) => 'publication' in entry && 'data' in entry.publication,
            ),
          );
        } else {
          assert.strictEqual(
            reads.length,
            1,
            `${fault}: no automatic read loop`,
          );
        }
        if (fault === 'evicted') {
          assert.true(
            await editing.evaluate(
              (id) =>
                !(window as any)['@cardstack/host']
                  .lookup('service:store')
                  .peek(id),
              extra,
            ),
            'late reply cannot resurrect the evicted peer',
          );
        }
        if (fault === 'omitted' || fault === 'failed') {
          assert.strictEqual(
            await editing.evaluate(
              (id) =>
                (window as any)['@cardstack/host']
                  .lookup('service:store')
                  .peek(id)?.publicationState,
              extra,
            ),
            fault === 'omitted' ? 'pending' : 'ready',
            'an incomplete envelope applies nothing; an explicit card failure preserves its successful peer',
          );
        }
        await assertContinuity(
          fault === 'omitted' || fault === 'failed' ? 'pending' : 'ready',
          `${fault}: preserves the displayed publication and unsaved editor`,
        );
      } finally {
        editing.off('request', intercept);
        await editing.setRequestInterception(false);
      }
      if (fault === 'evicted') await loadExtra();
      if (fault === 'omitted' || fault === 'failed') {
        await trigger();
        await drained();
        await assertContinuity(
          'ready',
          `${fault}: a later current notice repairs through the same Store`,
        );
      }
    }
    assert.deepEqual(
      await editing.evaluate(
        () => (window as any).latticeContinuity.deliveryChanges,
      ),
      [],
      'read faults, inventory repair and recovery never announce an authored edit',
    );
    assert.deepEqual(
      exchangeErrors,
      [],
      'all observed batch envelopes were captured',
    );

    // Reproduce the cleanup failure with a real remote deletion. Hold only
    // publication so the clients must process the source 404 while their last
    // complete snapshot is still current on screen. No wall-clock race against
    // an unusually fast owner recomputation can hide an accidental local edit.
    await idle();
    const sourceHeaders = {
      Accept: 'application/vnd.card+source',
      Authorization: `Bearer ${sessions[realmURL]}`,
    };
    const beforeSourceResponse = await fetch(owner + '.json', {
      headers: sourceHeaders,
    });
    assert.true(beforeSourceResponse.ok);
    const beforeSource = await beforeSourceResponse.text();
    const nativeOwnersBeforeDelete = nativeURLs.filter(
      (url) => url === owner + '.json',
    ).length;
    const recoveryRequests: { method: string; url: string }[] = [];
    for (const page of pages) {
      page.on('request', (request) => {
        if (
          request.url() === owner ||
          request.url().includes('/_federated-search') ||
          request.url().includes('/_search')
        )
          recoveryRequests.push({
            method: request.method(),
            url: request.url(),
          });
      });
      await page.evaluate(async () => {
        const app = (window as any)['@cardstack/host'];
        const api = await app
          .lookup('service:loader-service')
          .loader.import('@cardstack/base/card-api');
        const probe = (window as any).latticeContinuity;
        probe.changes = [];
        api.subscribeToChanges(probe.card, (_card: unknown, field: string) =>
          probe.changes.push(field),
        );
      });
    }
    heldOwner = {
      entered: new Deferred<void>(),
      release: new Deferred<void>(),
    };
    try {
      const deleted = await fetch(realmURL + 'Observation/two', {
        method: 'DELETE',
        headers: {
          Accept: 'application/vnd.card+json',
          Authorization: `Bearer ${sessions[realmURL]}`,
        },
      });
      assert.true(deleted.ok, await deleted.text());
      await heldOwner.entered.promise;
      for (const page of pages) {
        await page.waitForFunction(
          (id) =>
            !(window as any)['@cardstack/host']
              .lookup('service:store')
              .peek(id),
          { timeout: 10_000, polling: 50 },
          realmURL + 'Observation/two',
        );
        const pending = await page.evaluate((id) => {
          const probe = (window as any).latticeContinuity;
          return {
            changes: probe.changes,
            state: probe.card.publicationState,
            count: document.querySelector('[data-count]')?.textContent,
            total: document.querySelector('[data-total]')?.textContent,
            rows: [...document.querySelectorAll('[data-row]')].map((row) =>
              row.getAttribute('data-row'),
            ),
            sameCard:
              probe.card ===
              (window as any)['@cardstack/host']
                .lookup('service:store')
                .peek(id),
            sameSection:
              probe.section ===
              document.querySelector('[data-lattice-continuity]'),
          };
        }, owner);
        assert.deepEqual(
          pending,
          {
            changes: [],
            state: 'pending',
            count: '2',
            total: '13',
            rows: [realmURL + 'Observation/one', realmURL + 'Observation/two'],
            sameCard: true,
            sameSection: true,
          },
          'remote deletion keeps the last complete publication pending without a user edit',
        );
      }
      assert.deepEqual(
        recoveryRequests.filter((r) =>
          ['PATCH', 'QUERY', 'POST'].includes(r.method),
        ),
        [],
        'deletion neither autosaves the owner nor expands query inputs',
      );
    } finally {
      heldOwner.release.fulfill();
      heldOwner = undefined;
    }
    for (const page of pages) {
      await page.waitForFunction(
        () =>
          document
            .querySelector('[data-lattice-continuity]')
            ?.getAttribute('data-state') === 'ready' &&
          document.querySelector('[data-count]')?.textContent === '1' &&
          document.querySelector('[data-total]')?.textContent === '5' &&
          document.querySelectorAll('[data-row]').length === 1,
        { timeout: 20_000, polling: 'mutation' },
      );
      assert.deepEqual(
        await page.$$eval('[data-row]', (rows) =>
          rows.map((row) => [
            row.getAttribute('data-row'),
            row.textContent?.trim(),
          ]),
        ),
        [[realmURL + 'Observation/one', 'blue / done / 5']],
        'deletion publication removes the member and updates its aggregate together',
      );
      assert.deepEqual(
        await page.evaluate(() => (window as any).latticeContinuity.changes),
        [],
        'publication does not announce an authored edit',
      );
    }
    assert.deepEqual(
      await editing.evaluate(() => {
        const input = document.querySelector(
          '[data-editor] input',
        ) as HTMLInputElement;
        return {
          same: input === (window as any).latticeContinuity.editor,
          text: input.value,
          focused: document.activeElement === input,
          selection: [input.selectionStart, input.selectionEnd],
        };
      }),
      {
        same: true,
        text: 'Keep this exact unsaved draft',
        focused: true,
        selection: [5, 15],
      },
      'remote deletion and later publication preserve the delegated draft',
    );
    assert.deepEqual(
      recoveryRequests.filter((r) =>
        ['PATCH', 'QUERY', 'POST'].includes(r.method),
      ),
      [],
      'recovery finishes without an unsolicited owner write or query',
    );
    await assertPublished();
    const afterSourceResponse = await fetch(owner + '.json', {
      headers: sourceHeaders,
    });
    assert.true(afterSourceResponse.ok);
    assert.strictEqual(
      await afterSourceResponse.text(),
      beforeSource,
      'remote deletion never rewrites the dashboard source',
    );
    assert.strictEqual(
      nativeURLs.filter((url) => url === owner + '.json').length,
      nativeOwnersBeforeDelete + 1,
      `one native owner publication completes deletion recovery: ${JSON.stringify(nativeAttempts)}`,
    );
    console.log(
      'LATTICE_TWO_STORE_CONFIRMED',
      JSON.stringify({ elapsedMs: confirmedMs, nativeURLs }),
    );
  });
});
