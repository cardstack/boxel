import QUnit from 'qunit';
import { basename } from 'node:path';
import type { PgAdapter } from '@cardstack/postgres';
import {
  rri,
  type LooseSingleCardDocument,
  type Realm,
  type Prerenderer as Renderer,
  type VirtualNetwork,
} from '@cardstack/runtime-common';
import { LatticeBxlWorker } from '../lib/lattice-bxl-derivation.ts';
import type { Prerenderer } from '../prerender/prerenderer.ts';
import {
  localBaseRealm,
  getPrerendererForTesting,
  setupPermissionedRealm,
  testCreatePrerenderAuth,
  waitUntil,
} from './helpers/index.ts';
import { installRealmServerAssertOwnRealmServerBypassPatch } from './helpers/prerender-page-patches.ts';
import {
  capturedNativeIndexer,
  publishedNativeIndexer,
} from './helpers/lattice-captured-native-indexer.ts';
import type { LatticeNativeCardIndexer } from '@cardstack/runtime-common/lattice-native-index';
import {
  CLINICAL_DATES,
  CLINICAL_OWNER_TYPES,
  clinicalFixtures,
  clinicalTypeOf,
  expectedAttributes,
  generateClinical,
  latticeClinicalSource,
} from './helpers/lattice-clinical-fixture.ts';

const { module, test } = QUnit;
const origin = 'http://127.0.0.1:4459/';
const realmURL = origin + 'lattice-links/';
const actor = '@lattice-links:localhost';
const { records, ids } = generateClinical({ realmURL, scale: 8 });
// One date is enough to exercise all three owner heights and nine consumers.
// Keep the generator, formulas and raw-document oracle unchanged.
for (const [path, doc] of records) {
  if (doc.data.attributes?.date === CLINICAL_DATES[1]) records.delete(path);
}
const attending = ids.attendingOf(ids.admitted.cardiology[0]) + '.json';
const patients = [...records.keys()].filter(
  (path) =>
    clinicalTypeOf(records, path) === 'PatientRecord' &&
    ids.attendingOf(path.replace(/\.json$/, '')) + '.json' === attending,
);
const clinicalOwners = [...records.keys()].filter((path) =>
  CLINICAL_OWNER_TYPES.includes(clinicalTypeOf(records, path)),
);
const source =
  latticeClinicalSource.replace(
    '<template><output>{{@model.cardTitle}}: {{@model.status}}</output></template>',
    '<template><output>{{@model.cardTitle}}: {{@model.status}}</output><div data-attending><@fields.attending /></div></template>',
  ) +
  `
  export class ResourceWall extends CardDef {
    @field label = contains(StringField);
    static embedded = class extends Component<typeof this> {
      <template><output>{{@model.label}}</output></template>
    };
  }
  export class Classroom extends CardDef {
    @field room = contains(StringField);
    @field wall = linksTo(ResourceWall);
    static isolated = class extends Component<typeof this> {
      <template><output>{{@model.room}}</output><div data-wall><@fields.wall /></div></template>
    };
  }
  export class RoomBriefing extends CardDef {
    static materialized = true;
    static queryInputs = { rooms: { links: { wall: { many: false, projection: {} } } } };
    @field room = contains(StringField);
    @field rooms = linksToMany(Classroom, { query: { filter: { eq: { room: '$this.room' } }, page: { size: 5 } } });
    @field wallLabel = contains(StringField, { computeVia: formula('.rooms[0].wall["label"] // ""') });
    static isolated = class extends Component<typeof this> {
      <template><output>{{@model.room}}: {{@model.wallLabel}}</output></template>
    };
  }
`;
const ref = (name: string) => ({ module: rri(realmURL + 'cards'), name });
const card = (
  name: string,
  attributes: Record<string, unknown>,
  relationships?: LooseSingleCardDocument['data']['relationships'],
): LooseSingleCardDocument => ({
  data: {
    type: 'card',
    attributes,
    ...(relationships ? { relationships } : {}),
    meta: { adoptsFrom: ref(name) },
  },
});
const wall = 'ResourceWall/shared.json';
const classrooms = ['Classroom/blue.json', 'Classroom/green.json'];
const briefings = ['RoomBriefing/blue.json', 'RoomBriefing/green.json'];
const fixtures: Record<string, LooseSingleCardDocument> = {
  ...clinicalFixtures(records),
  [wall]: card('ResourceWall', { label: 'Shared synthetic resource wall' }),
};
for (const room of ['blue', 'green']) {
  fixtures[`Classroom/${room}.json`] = card(
    'Classroom',
    { room },
    { wall: { links: { self: '../ResourceWall/shared' } } },
  );
  fixtures[`RoomBriefing/${room}.json`] = card('RoomBriefing', { room });
}

module(basename(import.meta.filename), function (hooks) {
  let db: PgAdapter;
  let network: VirtualNetwork;
  let browser: Prerenderer;
  let worker: LatticeBxlWorker;
  let native: Awaited<ReturnType<typeof capturedNativeIndexer>>;
  let publisher: LatticeNativeCardIndexer | undefined;
  let fixtureRealm: Realm;
  const chromeOwnerDataVisits: string[] = [];
  let browserCalls = 0;
  const previousOwnerValues = new Map<string, string>();
  let patch: ReturnType<
    typeof installRealmServerAssertOwnRealmServerBypassPatch
  >;
  const sessions = JSON.parse(
    testCreatePrerenderAuth(actor, {
      [realmURL]: ['read', 'write', 'realm-owner'],
    }),
  );
  sessions[origin] = sessions[realmURL];
  const auth = JSON.stringify(sessions);
  const headers = {
    Accept: 'application/vnd.card+json',
    Authorization: `Bearer ${sessions[realmURL]}`,
  };
  const renderer: Renderer = {
    async prerenderVisit(args) {
      if (
        publisher &&
        args.batchId &&
        args.visitType === 'index' &&
        args.renderOptions?.cardRender &&
        [...clinicalOwners, ...briefings].some(
          (path) => args.url === realmURL + path,
        )
      ) {
        chromeOwnerDataVisits.push(args.url);
      }
      browserCalls++;
      return (await browser.prerenderVisit(args)).response;
    },
    async prerenderModule(args) {
      browserCalls++;
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
    // The bound includes initial indexing, which runs before the test body.
    assert.timeout(1_800_000);
    console.log('LATTICE_L1B setup started');
    patch = installRealmServerAssertOwnRealmServerBypassPatch();
    browser = getPrerendererForTesting({ serverURL: origin, maxPages: 2 });
    worker = new LatticeBxlWorker();
  });
  hooks.after(async () => {
    await patch?.restore();
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
    nativeCardIndexer: (request) =>
      publisher ? publisher(request) : Promise.resolve(undefined),
    assetsURL: new URL(process.env.HOST_URL ?? 'http://localhost:4200/'),
    onRealmSetup({ dbAdapter, virtualNetwork, testRealm }) {
      db = dbAdapter;
      network = virtualNetwork;
      fixtureRealm = testRealm;
      console.log('LATTICE_L1B setup ready');
      network.mount(async (request) => {
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
  async function settled(label: string) {
    try {
      await waitUntil(
        async () => {
          const jobs = await db.execute(
            "SELECT 1 FROM jobs WHERE status='unfulfilled' LIMIT 1",
          );
          const dirty = await db.execute(
            'SELECT 1 FROM lattice_owners WHERE realm_url=$1 AND retired=FALSE AND (published_generation IS NULL OR dirty_generation > published_generation) LIMIT 1',
            { bind: [realmURL] },
          );
          return jobs.length === 0 && dirty.length === 0;
        },
        { timeout: 600_000, interval: 250 },
      );
      console.log(`LATTICE_L1B settled ${label}`);
    } catch (error) {
      const owners = await db.execute(
        'SELECT owner_url,dirty_generation,published_generation FROM lattice_owners WHERE realm_url=$1 AND retired=FALSE AND (published_generation IS NULL OR dirty_generation > published_generation)',
        { bind: [realmURL] },
      );
      const errors = await db.execute(
        "SELECT url,error_doc->>'message' AS message FROM boxel_index WHERE realm_url=$1 AND has_error=TRUE",
        { bind: [realmURL] },
      );
      throw new Error(
        `${label}: ${String(error)} ${JSON.stringify({ owners, errors })}`,
      );
    }
  }
  async function request(path: string, init?: RequestInit) {
    const result = await fetch(realmURL + path, {
      ...init,
      headers: { ...headers, ...init?.headers },
    });
    if (!result.ok)
      throw new Error(`${path}: ${result.status} ${await result.text()}`);
    return result;
  }
  async function mutate(path: string, restore: boolean) {
    const result = await request(
      restore ? path : path.replace(/\.json$/, ''),
      restore
        ? {
            method: 'POST',
            headers: {
              Accept: 'application/vnd.card+source',
              'Content-Type': 'application/vnd.card+source',
            },
            body: JSON.stringify(fixtures[path]),
          }
        : { method: 'DELETE' },
    );
    await result.arrayBuffer();
    await settled(`${restore ? 'restore' : 'delete'} ${path}`);
  }
  async function verifyOwners(
    assert: Assert,
    label: string,
    missingWall = false,
  ) {
    for (const path of [...clinicalOwners, ...briefings]) {
      const { data } = await (
        await request(path.replace(/\.json$/, ''))
      ).json();
      const expected = briefings.includes(path)
        ? { wallLabel: missingWall ? '' : 'Shared synthetic resource wall' }
        : expectedAttributes(records, path);
      assert.deepEqual(
        Object.fromEntries(
          Object.keys(expected).map((key) => [key, data.attributes[key]]),
        ),
        expected,
        `${label}: ${path} serves the complete oracle`,
      );
      assert.strictEqual(
        data.meta.publication.state,
        'ready',
        `${label}: ${path} is published`,
      );
      const previous = previousOwnerValues.get(path);
      const current = JSON.stringify(expected);
      if (previous !== undefined && previous !== current) {
        const [row] = await db.execute(
          "SELECT diagnostics FROM boxel_index WHERE realm_url=$1 AND url=$2 AND type='instance'",
          { bind: [realmURL, realmURL + path] },
        );
        const diagnostics = row.diagnostics as {
          latticeNative?: boolean;
          latticeNativeCompute?: {
            fields: { evaluator: string; status: string }[];
          };
        } | null;
        assert.true(
          diagnostics?.latticeNative,
          `${label}: ${path} published through the native producer`,
        );
        assert.true(
          diagnostics?.latticeNativeCompute?.fields.some(
            (field) =>
              field.evaluator === 'bxl' && field.status === 'fulfilled',
          ),
          `${label}: ${path} published an actual BXL computation`,
        );
      }
      previousOwnerValues.set(path, current);
    }
  }
  async function verifyConsumers(
    assert: Assert,
    paths: string[],
    field: string,
    target: string,
    missing: boolean,
  ) {
    const searched = await (
      await request('_search', {
        method: 'QUERY',
        body: JSON.stringify({
          filter: { 'item.on': fixtures[paths[0]].data.meta.adoptsFrom },
          fields: { entry: ['item'] },
          page: { size: 50 },
        }),
      })
    ).json();
    const findingsResponse = await request('_indexing-errors', {
      headers: { Accept: 'application/vnd.api+json' },
    });
    const findings = (await findingsResponse.json()).data;
    for (const path of paths) {
      const id = realmURL + path.replace(/\.json$/, '');
      const { data } = await (
        await request(path.replace(/\.json$/, ''))
      ).json();
      assert.strictEqual(data.id, id, `${path}: consumer GET survives`);
      assert.true(
        searched.data.some((row: { id: string }) => row.id === id),
        `${path}: search lists the consumer`,
      );
      const [row] = await db.execute(
        "SELECT i.has_error,h.diagnostics FROM boxel_index i LEFT JOIN prerendered_html h ON h.url=i.url AND h.realm_url=i.realm_url AND h.type=i.type WHERE i.url=$1 AND i.type='instance'",
        { bind: [realmURL + path] },
      );
      assert.false(Boolean(row.has_error), `${path}: no error row`);
      const diagnostics = row.diagnostics as {
        brokenLinks?: Array<{ fieldName: string; reference: string }>;
      } | null;
      const broken = (diagnostics?.brokenLinks ?? []).filter(
        (item) => item.fieldName === field,
      );
      assert.strictEqual(
        broken.length,
        missing ? 1 : 0,
        `${path}: persisted missing-slot diagnostic`,
      );
      const publicFindings = findings.filter(
        (entry: {
          type: string;
          attributes: { url: string; entryType: string };
        }) =>
          entry.type === 'broken-link' &&
          entry.attributes.url === realmURL + path &&
          entry.attributes.entryType === 'instance',
      );
      assert.strictEqual(
        publicFindings.length,
        missing ? 1 : 0,
        `${path}: public diagnostics follow deletion/restoration`,
      );
      if (missing)
        assert.deepEqual(
          publicFindings[0]?.attributes.brokenLinks,
          broken,
          `${path}: public diagnostic retains every captured slot`,
        );
      if (missing)
        assert.true(
          broken[0]?.reference.includes(target.replace(/\.json$/, '')),
          `${path}: diagnostic retains target identity`,
        );
    }
    // Actual Chrome renders the ordinary delegated slot, not a hand-made badge.
    const result = await renderer.prerenderVisit({
      affinityType: 'realm',
      affinityValue: realmURL,
      realm: realmURL,
      url: realmURL + paths[0],
      auth,
      renderOptions: { clearCache: true, cardRender: true },
    });
    assert.notOk(result.card?.error, 'delegated consumer renders successfully');
    assert.strictEqual(
      result.card?.isolatedHTML?.includes('broken-link-template'),
      missing,
      `${field}: existing missing-slot placeholder toggles`,
    );
  }
  async function parity(assert: Assert, paths: string[], label: string) {
    for (const path of paths) {
      const [generation] = await db.execute(
        'SELECT current_generation,loader_epoch FROM realm_generations WHERE realm_url=$1',
        { bind: [realmURL] },
      );
      const owner = clinicalOwners.includes(path) || briefings.includes(path);
      const inputSnapshot = owner
        ? { realmURL, generation: Number(generation.current_generation) }
        : undefined;
      const result = await renderer.prerenderVisit({
        affinityType: 'realm',
        affinityValue: realmURL,
        realm: realmURL,
        url: realmURL + path,
        auth,
        visitType: 'index',
        inputSnapshot: inputSnapshot,
        renderOptions: { clearCache: true, cardRender: true },
      });
      const before = browserCalls;
      const candidate = await native({
        url: realmURL + path,
        realmURL,
        sourceJSON: JSON.stringify(fixtures[path]),
        generation: Number(generation.current_generation) + 1,
        loaderEpoch: generation.loader_epoch as string,
        lastModified: 1,
        resourceCreatedAt: 1,
        ...(inputSnapshot ? { inputSnapshot } : {}),
      });
      assert.notOk(result.card?.error, `${label}: ${path} Chrome succeeded`);
      assert.ok(candidate, `${label}: ${path} Node accepted`);
      assert.strictEqual(
        browserCalls,
        before,
        `${path}: native computation did not call Chrome`,
      );
      assert.deepEqual(
        candidate?.card.serialized?.data.attributes,
        result.card?.serialized?.data.attributes,
        `${label}: ${path} attribute parity`,
      );
      assert.deepEqual(
        candidate?.card.serialized?.data.relationships,
        result.card?.serialized?.data.relationships,
        `${label}: ${path} relationship parity`,
      );
      assert.deepEqual(
        JSON.parse(JSON.stringify(candidate?.card.searchDoc)),
        result.card?.searchDoc,
        `${label}: ${path} complete search data parity`,
      );
    }
  }
  test('retiring and restoring shared targets preserves consumers, the dashboard chain and delegated slots', async (assert) => {
    assert.strictEqual(
      patients.length,
      9,
      'nine PatientRecords share the attending',
    );
    native = await capturedNativeIndexer({
      db,
      network,
      realmURL,
      actor,
      auth,
      renderer,
      worker,
      refs: Object.values(fixtures).map((doc) => doc.data.meta.adoptsFrom),
    });
    await settled('boot');
    publisher = await publishedNativeIndexer({
      db,
      network,
      realm: fixtureRealm,
      actor,
      renderer,
      worker,
      refs: Object.values(fixtures).map((doc) => doc.data.meta.adoptsFrom),
      sourcePaths: ['cards.gts', ...Object.keys(fixtures)],
      createPrerenderAuth: testCreatePrerenderAuth,
    });
    console.log('LATTICE_L1B reviewed native publication installed');
    await verifyOwners(assert, 'before');
    await verifyConsumers(assert, patients, 'attending', attending, false);
    const original = records.get(attending)!;
    await mutate(attending, false);
    records.delete(attending);
    await verifyOwners(assert, 'attending deleted');
    await verifyConsumers(assert, patients, 'attending', attending, true);
    await parity(assert, [patients[0], ...clinicalOwners], 'attending deleted');
    await mutate(attending, true);
    records.set(attending, original);
    await verifyOwners(assert, 'attending restored');
    await verifyConsumers(assert, patients, 'attending', attending, false);
    await parity(
      assert,
      [patients[0], ...clinicalOwners],
      'attending restored',
    );
    await mutate(wall, false);
    await verifyOwners(assert, 'wall deleted', true);
    await verifyConsumers(assert, classrooms, 'wall', wall, true);
    await parity(assert, [...classrooms, ...briefings], 'wall deleted');
    await mutate(wall, true);
    await verifyOwners(assert, 'wall restored');
    await verifyConsumers(assert, classrooms, 'wall', wall, false);
    await parity(assert, [...classrooms, ...briefings], 'wall restored');
    assert.deepEqual(
      chromeOwnerDataVisits,
      [],
      'automatic owner data publication never falls back to Chrome during the four mutations',
    );
    // Only the two targets were written: source consumers must be byte-identical.
    for (const path of [
      ...patients,
      ...clinicalOwners,
      ...classrooms,
      ...briefings,
    ]) {
      const source = await (
        await request(path, {
          headers: { Accept: 'application/vnd.card+source' },
        })
      ).json();
      assert.deepEqual(source, fixtures[path], `${path}: no consumer re-save`);
    }
  });
});
