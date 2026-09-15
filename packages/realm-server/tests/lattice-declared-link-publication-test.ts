import QUnit from 'qunit';
import type { PgAdapter } from '@cardstack/postgres';
import {
  rri,
  type Prerenderer as Renderer,
  type LooseSingleCardDocument,
  type Realm,
  type VirtualNetwork,
} from '@cardstack/runtime-common';
import type { LatticeNativeCardIndexer } from '@cardstack/runtime-common/lattice-native-index';
import { LatticeBxlWorker } from '../lib/lattice-bxl-derivation.ts';
import { publishedNativeIndexer } from './helpers/lattice-captured-native-indexer.ts';
import type { Prerenderer } from '../prerender/prerenderer.ts';
import {
  localBaseRealm,
  getPrerendererForTesting,
  setupPermissionedRealm,
  testCreatePrerenderAuth,
  waitUntil,
} from './helpers/index.ts';
import { installRealmServerAssertOwnRealmServerBypassPatch } from './helpers/prerender-page-patches.ts';

const { module, test } = QUnit;
const origin = 'http://127.0.0.1:4460/';
const realmURL = origin + 'lattice-direct-links/';
const actor = '@lattice-direct-links:localhost';
const source = `
  import { CardDef, field, contains, linksTo, linksToMany, Component } from '@cardstack/base/card-api';
  import StringField from '@cardstack/base/string';
  import NumberField from '@cardstack/base/number';
  import { bxl } from '@cardstack/bxl';
  export class Wall extends CardDef {
    @field room = contains(StringField);
    @field label = contains(StringField);
    static embedded = class extends Component<typeof this> {
      <template><output>{{@model.label}}</output></template>
    };
  }
  export class Plain extends CardDef {
    @field wall = linksTo(Wall, { searchable: true });
    static isolated = class extends Component<typeof this> {
      <template><div data-wall><@fields.wall /></div></template>
    };
  }
  export class Board extends Plain {
    static materialized = true;
    static queryInputs = { walls: {} };
    @field room = contains(StringField);
    @field walls = linksToMany(Wall, {
      query: { filter: { eq: { room: '$this.room' } }, page: { size: 10 } },
    });
    @field count = contains(NumberField, {
      computeVia: bxl('.walls | length', { libraries: ['core'], readableSyntax: false }),
    });
    static isolated = class extends Component<typeof this> {
      <template><output>{{@model.count}}</output><div data-wall><@fields.wall /></div></template>
    };
  }
  export class Room extends CardDef {
    @field room = contains(StringField);
    @field wall = linksTo(Wall);
  }
  export class Briefing extends CardDef {
    static materialized = true;
    static queryInputs = { rooms: { links: { wall: { many: false, projection: {} } } } };
    @field room = contains(StringField);
    @field rooms = linksToMany(Room, {
      query: { filter: { eq: { room: '$this.room' } }, page: { size: 10 } },
    });
    @field wallLabel = contains(StringField, {
      computeVia: bxl('.rooms[0].wall["label"] // ""', { libraries: ['core'], readableSyntax: false }),
    });
    static isolated = class extends Component<typeof this> {
      <template><output>{{@model.room}}: {{@model.wallLabel}}</output></template>
    };
  }
`;
function card(
  name: string,
  attributes: Record<string, unknown>,
  wall?: string,
): LooseSingleCardDocument {
  return {
    data: {
      type: 'card',
      attributes,
      ...(wall ? { relationships: { wall: { links: { self: wall } } } } : {}),
      meta: { adoptsFrom: { module: rri(realmURL + 'cards'), name } },
    },
  };
}
const fixtures = {
  'Wall/shared.json': card('Wall', { room: 'blue', label: 'Shared wall' }),
  'Plain/one.json': card('Plain', {}, '../Wall/shared'),
  'Board/one.json': card('Board', { room: 'blue' }, '../Wall/shared'),
  // Keep the fault target outside query membership, so the declared link
  // must use the input transport rather than an included search resource.
  'Wall/fault.json': card('Wall', { room: 'other', label: 'Failure target' }),
  'Board/faults.json': card('Board', { room: 'empty' }, '../Wall/fault'),
  'Room/one.json': card('Room', { room: 'violet' }, '../Wall/fault'),
  'Briefing/one.json': card('Briefing', { room: 'violet' }),
};

module('Lattice | direct declared-link publication', (hooks) => {
  let db: PgAdapter;
  let network: VirtualNetwork;
  let fixtureRealm: Realm;
  let browser: Prerenderer;
  let worker: LatticeBxlWorker;
  let publisher: LatticeNativeCardIndexer | undefined;
  let nativeDeclines = 0;
  let chromeBriefingVisits = 0;
  let ownerComputations = 0;
  let targetFailure:
    | { status: number; message: string; perInput?: boolean }
    | undefined;
  let failureTarget = realmURL + 'Wall/fault';
  let failedTargetReads = 0;
  let restore: ReturnType<
    typeof installRealmServerAssertOwnRealmServerBypassPatch
  >;
  const sessions = JSON.parse(
    testCreatePrerenderAuth(actor, {
      [realmURL]: ['read', 'write', 'realm-owner'],
    }),
  );
  sessions[origin] = sessions[realmURL];
  const headers = {
    Accept: 'application/vnd.card+json',
    Authorization: `Bearer ${sessions[realmURL]}`,
  };
  const renderer: Renderer = {
    async prerenderVisit(args) {
      if (
        publisher &&
        args.batchId &&
        args.inputSnapshot &&
        args.renderOptions?.cardRender &&
        args.url === realmURL + 'Briefing/one.json'
      )
        chromeBriefingVisits++;
      if (
        args.inputSnapshot &&
        args.renderOptions?.cardRender &&
        args.url === realmURL + 'Board/one.json'
      )
        ownerComputations++;
      const response = (await browser.prerenderVisit(args)).response;
      if (args.inputSnapshot && response.card?.error)
        console.log(
          'LATTICE_DIRECT owner render rejected',
          response.card.error.error.message,
        );
      return response;
    },
    async prerenderModule(args) {
      return (await browser.prerenderModule(args)).response;
    },
    async releaseBatch(args) {
      await browser.releaseBatch(args);
    },
    async runCommand() {
      throw new Error('Unexpected fixture command');
    },
  };
  hooks.before((assert) => {
    assert.timeout(300_000);
    restore = installRealmServerAssertOwnRealmServerBypassPatch();
    browser = getPrerendererForTesting({ serverURL: origin, maxPages: 2 });
    worker = new LatticeBxlWorker();
  });
  hooks.after(async () => {
    await restore?.restore();
    await worker?.close();
    await browser?.stop();
  });
  setupPermissionedRealm(hooks, {
    latticeEnabled: true,
    mode: 'before',
    realmURL: new URL(realmURL),
    permissions: { '*': ['read'], [actor]: ['read', 'write', 'realm-owner'] },
    fileSystem: { 'cards.gts': source, ...fixtures },
    prerenderer: renderer,
    async nativeCardIndexer(request) {
      const result = await publisher?.(request);
      if (
        publisher &&
        request.inputSnapshot &&
        request.url === realmURL + 'Briefing/one.json' &&
        !result
      )
        nativeDeclines++;
      return result;
    },
    assetsURL: new URL(process.env.HOST_URL ?? 'http://localhost:4200/'),
    onRealmSetup({ dbAdapter, virtualNetwork, testRealm }) {
      db = dbAdapter;
      network = virtualNetwork;
      fixtureRealm = testRealm;
      virtualNetwork.mount(
        async (request) => {
          if (!targetFailure || request.url !== realmURL + '_lattice-inputs')
            return null;
          const payload = await request.clone().json();
          if (!payload.urls?.includes(failureTarget)) return null;
          failedTargetReads++;
          if (targetFailure.perInput) {
            return Response.json({
              results: payload.urls.map((url: string) => ({
                url,
                error: {
                  status: targetFailure!.status,
                  message: targetFailure!.message,
                  additionalErrors: null,
                },
              })),
            });
          }
          return new Response(
            JSON.stringify({
              errors: [
                {
                  ...targetFailure,
                  additionalErrors: null,
                },
              ],
            }),
            {
              status: targetFailure.status,
              headers: { 'Content-Type': 'application/vnd.card+json' },
            },
          );
        },
        { prepend: true },
      );
      virtualNetwork.mount(async (request) => {
        if (!request.url.startsWith(origin + 'base/')) return null;
        if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method))
          return new Response(null, { status: 405 });
        const forwarded = new Headers(request.headers);
        forwarded.delete('authorization');
        return fetch(
          request.url.replace(origin + 'base/', localBaseRealm + '/'),
          {
            method: request.method,
            headers: forwarded,
            signal: request.signal,
          },
        );
      });
    },
  });
  async function request(path: string, init?: RequestInit) {
    return fetch(realmURL + path, {
      ...init,
      headers: { ...headers, ...init?.headers },
    });
  }
  async function idle() {
    await waitUntil(
      async () =>
        !(
          await db.execute(
            "SELECT 1 FROM jobs WHERE status='unfulfilled' LIMIT 1",
          )
        ).length,
      { timeout: 120_000, interval: 250 },
    );
  }
  async function verify(assert: Assert, phase: string, missing: boolean) {
    console.log('LATTICE_DIRECT verify', phase);
    const search = await request('_search', {
      method: 'QUERY',
      body: JSON.stringify({
        filter: { 'item.on': fixtures['Board/one.json'].data.meta.adoptsFrom },
        fields: { entry: ['item'] },
      }),
    });
    assert.strictEqual(search.status, 200, `${phase}: owner search succeeds`);
    const found = await search.json();
    assert.true(
      found.data?.some(
        (row: { id: string }) => row.id === realmURL + 'Board/one',
      ),
      `${phase}: owner remains searchable`,
    );
    const diagnostics = await request('_indexing-errors', {
      headers: { Accept: 'application/vnd.api+json' },
    });
    assert.strictEqual(
      diagnostics.status,
      200,
      `${phase}: diagnostics are readable`,
    );
    const findings = (await diagnostics.json()).data as Array<{
      type: string;
      attributes: {
        url: string;
        entryType: string;
        brokenLinks?: Array<{
          fieldName: string;
          reference: string;
          kind: string;
        }>;
      };
    }>;
    for (const path of ['Plain/one', 'Board/one']) {
      const response = await request(path);
      assert.strictEqual(
        response.status,
        200,
        `${phase}: ${path} GET succeeds`,
      );
      const doc = await response.json();
      if (path.startsWith('Board/')) {
        assert.strictEqual(
          doc.data?.attributes.count,
          missing ? 0 : 1,
          `${phase}: complete count`,
        );
        assert.strictEqual(
          doc.data?.meta.publication?.state,
          'ready',
          `${phase}: owner publication ready`,
        );
      }
      const [row] = await db.execute(
        "SELECT has_error FROM boxel_index WHERE realm_url=$1 AND url=$2 AND type='instance'",
        { bind: [realmURL, realmURL + path + '.json'] },
      );
      assert.false(
        Boolean(row?.has_error),
        `${phase}: ${path} is not an error row`,
      );
      // The public endpoint combines current data and HTML diagnostic captures.
      // The phase in which a delegated link settles must not affect this proof.
      const links = findings
        .filter(
          (entry) =>
            entry.type === 'broken-link' &&
            entry.attributes.url === realmURL + path + '.json' &&
            entry.attributes.entryType === 'instance',
        )
        .flatMap((entry) => entry.attributes.brokenLinks ?? []);
      assert.deepEqual(
        links
          .filter((entry) => entry.fieldName === 'wall')
          .map((entry) => ({
            kind: entry.kind,
            target: new URL(entry.reference, realmURL + path).href,
          })),
        missing
          ? [{ kind: 'not-found', target: realmURL + 'Wall/shared' }]
          : [],
        `${phase}: ${path} retains the confirmed missing target`,
      );
      const rendered = await renderer.prerenderVisit({
        affinityType: 'realm',
        affinityValue: realmURL,
        realm: realmURL,
        url: realmURL + path + '.json',
        auth: JSON.stringify(sessions),
        renderOptions: { clearCache: true, cardRender: true },
      });
      assert.notOk(rendered.card?.error, `${phase}: ${path} renders`);
      assert.strictEqual(
        rendered.card?.isolatedHTML?.includes('broken-link-template'),
        missing,
        `${phase}: ${path} uses the delegated placeholder`,
      );
      const stored = await request(path + '.json', {
        headers: { Accept: 'application/vnd.card+source' },
      });
      assert.deepEqual(
        await stored.json(),
        fixtures[(path + '.json') as keyof typeof fixtures],
        `${phase}: no consumer source rewrite`,
      );
    }
  }
  test('confirmed target deletion publishes the direct owner and restoration repairs its slot', async (assert) => {
    await idle();
    await verify(assert, 'initial', false);
    const before = ownerComputations;
    const deleted = await request('Wall/shared', { method: 'DELETE' });
    assert.true(deleted.ok, 'ordinary DELETE accepted');
    await deleted.arrayBuffer();
    await idle();
    await verify(assert, 'deleted', true);
    const restored = await request('Wall/shared.json', {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.card+source',
        'Content-Type': 'application/vnd.card+source',
      },
      body: JSON.stringify(fixtures['Wall/shared.json']),
    });
    assert.true(restored.ok, 'ordinary source restore accepted');
    await restored.arrayBuffer();
    await idle();
    await verify(assert, 'restored', false);
    assert.true(
      ownerComputations > before,
      'real Chrome owner computation ran after target changes',
    );
    const [generation] = await db.execute(
      'SELECT current_generation FROM realm_generations WHERE realm_url=$1',
      { bind: [realmURL] },
    );
    for (const failure of [
      { status: 403, message: 'Read permission denied' },
      { status: 503, message: 'Target temporarily unavailable' },
      { status: 500, message: 'Upstream service not found' },
    ]) {
      targetFailure = failure;
      failedTargetReads = 0;
      try {
        const rendered = await renderer.prerenderVisit({
          affinityType: 'realm',
          affinityValue: realmURL,
          realm: realmURL,
          url: realmURL + 'Board/faults.json',
          auth: JSON.stringify(sessions),
          visitType: 'index',
          inputSnapshot: {
            realmURL,
            generation: Number(generation.current_generation),
          },
          renderOptions: { clearCache: true, cardRender: true },
        });
        assert.true(
          failedTargetReads > 0,
          `${failure.status}: actual target request failed`,
        );
        assert.ok(
          rendered.card?.error,
          `${failure.status}: host refuses incomplete owner data`,
        );
        assert.notOk(
          rendered.card?.serialized,
          `${failure.status}: no publishable card value`,
        );
      } finally {
        targetFailure = undefined;
      }
    }
    await verify(assert, 'after temporary failures', false);
  });

  test('an unknown projected target falls back to Chrome and creation returns the owner to native publication', async (assert) => {
    await idle();
    const path = 'Briefing/one';
    const initial = await (await request(path)).json();
    assert.strictEqual(initial.data.attributes.wallLabel, 'Failure target');
    publisher = await publishedNativeIndexer({
      db,
      network,
      realm: fixtureRealm,
      actor,
      renderer,
      worker,
      refs: [fixtures['Briefing/one.json'].data.meta.adoptsFrom],
      sourcePaths: ['cards.gts', ...Object.keys(fixtures)],
      createPrerenderAuth: testCreatePrerenderAuth,
    });
    async function write(path: string, doc: LooseSingleCardDocument) {
      const response = await request(path, {
        method: 'POST',
        headers: {
          Accept: 'application/vnd.card+source',
          'Content-Type': 'application/vnd.card+source',
        },
        body: JSON.stringify(doc),
      });
      assert.true(response.ok, `${path}: ordinary source write accepted`);
      await response.arrayBuffer();
      await idle();
    }
    async function current(label: string) {
      const response = await request(path);
      assert.strictEqual(response.status, 200, 'owner GET succeeds');
      const doc = await response.json();
      assert.deepEqual(
        doc.data?.attributes,
        { ...initial.data.attributes, wallLabel: label },
        'complete attributes retain all values through fallback and recovery',
      );
      assert.strictEqual(doc.data?.meta.publication?.state, 'ready');
      const search = await request('_search', {
        method: 'QUERY',
        body: JSON.stringify({
          filter: {
            'item.on': fixtures['Briefing/one.json'].data.meta.adoptsFrom,
          },
          fields: { entry: ['item'] },
        }),
      });
      assert.strictEqual(search.status, 200, 'owner search succeeds');
      const found = (await search.json()).included?.find(
        (entry: { id: string; type: string }) =>
          entry.type === 'card' && entry.id === realmURL + path,
      );
      assert.deepEqual(
        found?.attributes,
        doc.data?.attributes,
        'search agrees with GET',
      );
      return db.execute(
        "SELECT has_error,deps,diagnostics FROM boxel_index WHERE realm_url=$1 AND url=$2 AND type='instance'",
        { bind: [realmURL, realmURL + path + '.json'] },
      );
    }
    const target = realmURL + 'Wall/never-indexed.json';
    assert.strictEqual(
      (
        await db.execute('SELECT url FROM boxel_index WHERE url=$1', {
          bind: [target],
        })
      ).length,
      0,
      'the linked target has no index row or tombstone',
    );
    await write(
      'Room/one.json',
      card('Room', { room: 'violet' }, '../Wall/never-indexed'),
    );
    const [missing] = await current('');
    assert.false(
      Boolean(missing?.has_error),
      'missing target does not turn owner into an error',
    );
    assert.true(
      nativeDeclines > 0,
      'reviewed native producer declines the unknown projection',
    );
    assert.true(
      chromeBriefingVisits > 0,
      'normal indexing invokes the Chrome fallback',
    );
    assert.true(
      (missing?.deps as string[]).some(
        (dep) => dep.replace(/\.json$/, '') === target.replace(/\.json$/, ''),
      ),
      'Chrome retains the unknown identity as a restoration dependency',
    );
    nativeDeclines = chromeBriefingVisits = 0;
    await write(
      'Wall/never-indexed.json',
      card('Wall', { room: 'other', label: 'Created after missing link' }),
    );
    const [created] = await current('Created after missing link');
    assert.false(Boolean(created?.has_error));
    assert.ok(
      (created?.diagnostics as { latticeNative?: unknown })?.latticeNative,
      'the updated owner was actually published natively',
    );
    assert.strictEqual(
      nativeDeclines,
      0,
      'indexed target no longer requires fallback',
    );
    assert.strictEqual(
      chromeBriefingVisits,
      0,
      'creation needs no Chrome owner data computation',
    );
    assert.deepEqual(
      await (
        await request(path + '.json', {
          headers: { Accept: 'application/vnd.card+source' },
        })
      ).json(),
      fixtures['Briefing/one.json'],
      'owner identity and authored source remain unchanged',
    );

    // A real source can exist before its index row. The native producer cannot
    // infer absence in that case; Chrome must also refuse a complete-looking
    // value after the batch input endpoint discovers that source is pending.
    await db.execute(
      "DELETE FROM boxel_index WHERE url=$1 AND type='instance'",
      {
        bind: [target],
      },
    );
    const [generation] = await db.execute(
      'SELECT current_generation FROM realm_generations WHERE realm_url=$1',
      { bind: [realmURL] },
    );
    const pending = await renderer.prerenderVisit({
      affinityType: 'realm',
      affinityValue: realmURL,
      realm: realmURL,
      url: realmURL + path + '.json',
      auth: JSON.stringify(sessions),
      visitType: 'index',
      inputSnapshot: {
        realmURL,
        generation: Number(generation.current_generation),
      },
      renderOptions: { clearCache: true, cardRender: true },
    });
    assert.ok(
      pending.card?.error,
      'existing unindexed projected source remains pending',
    );
    assert.notOk(
      pending.card?.serialized,
      'Chrome does not publish that source as missing',
    );

    // The missing index row forces this query-member projection through the
    // input endpoint. Otherwise the search can include a resident target and
    // a fault injection at the input transport would never be exercised.
    failureTarget = target.replace(/\.json$/, '');
    for (const failure of [
      { status: 403, message: 'Read authorization not found' },
      { status: 503, message: 'Upstream service not found' },
    ]) {
      targetFailure = { ...failure, perInput: true };
      failedTargetReads = 0;
      try {
        const rejected = await renderer.prerenderVisit({
          affinityType: 'realm',
          affinityValue: realmURL,
          realm: realmURL,
          url: realmURL + path + '.json',
          auth: JSON.stringify(sessions),
          visitType: 'index',
          inputSnapshot: {
            realmURL,
            generation: Number(generation.current_generation),
          },
          renderOptions: { clearCache: true, cardRender: true },
        });
        assert.true(
          failedTargetReads > 0,
          `${failure.status}: projected input failed at the transport`,
        );
        assert.ok(
          rejected.card?.error,
          `${failure.status}: failed projection rejects owner computation`,
        );
        assert.notOk(
          rejected.card?.serialized,
          `${failure.status}: no missing-looking publication`,
        );
      } finally {
        targetFailure = undefined;
      }
    }
    failureTarget = realmURL + 'Wall/fault';
    await write(
      'Wall/never-indexed.json',
      card('Wall', {
        room: 'other',
        label: 'Recovered after transport failure',
      }),
    );
    await current('Recovered after transport failure');
    const [recoveredGeneration] = await db.execute(
      'SELECT current_generation FROM realm_generations WHERE realm_url=$1',
      { bind: [realmURL] },
    );
    const recovered = await renderer.prerenderVisit({
      affinityType: 'realm',
      affinityValue: realmURL,
      realm: realmURL,
      url: realmURL + path + '.json',
      auth: JSON.stringify(sessions),
      visitType: 'index',
      inputSnapshot: {
        realmURL,
        generation: Number(recoveredGeneration.current_generation),
      },
      renderOptions: { clearCache: true, cardRender: true },
    });
    assert.notOk(
      recovered.card?.error,
      'the same Chrome owner producer recovers',
    );
    assert.deepEqual(
      recovered.card?.serialized?.data.attributes,
      {
        ...initial.data.attributes,
        wallLabel: 'Recovered after transport failure',
      },
      'recovery returns the full correct value, not the failed projection',
    );
  });
});
