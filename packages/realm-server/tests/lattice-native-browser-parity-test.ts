import {
  latticeParitySource,
  latticeParityFixtures,
} from './helpers/lattice-parity-fixture.ts';
import QUnit from 'qunit';
import type { PgAdapter } from '@cardstack/postgres';
import {
  internalKeyFor,
  isResolvedCodeRef,
  maybeRelativeReference,
  rri,
  type CodeRef,
  type Definition,
  type DefinitionLookup,
  type ModuleRenderResponse,
  type Prerenderer as PrerendererAPI,
  type VirtualNetwork,
} from '@cardstack/runtime-common';
import { LatticeBxlWorker } from '../lib/lattice-bxl-derivation.ts';
import type { LatticeDefinitionSnapshot } from '../lib/lattice-card-data.ts';
import { createLatticeNativeCardIndexer } from '../lib/lattice-native-card-indexer.ts';
import { LatticeMaterializationInputs } from '../lib/lattice-materialization-inputs.ts';
import { latticeDefinitionDigest } from '../lib/lattice-postgres-admission.ts';
import type { Prerenderer } from '../prerender/prerenderer.ts';
import {
  getPrerendererForTesting,
  setupPermissionedRealm,
  testCreatePrerenderAuth,
  waitUntil,
} from './helpers/index.ts';
import { installRealmServerAssertOwnRealmServerBypassPatch } from './helpers/prerender-page-patches.ts';

const { module, test } = QUnit;
const realmURL = 'http://127.0.0.1:4453/lattice-parity/';
const actor = '@lattice-parity:localhost';
const ref = (name: string) => ({ module: rri(realmURL + 'cards'), name });

const source = latticeParitySource;
const fixtures = latticeParityFixtures(realmURL);

const expectedValues: Record<string, Record<string, unknown>> = {
  'Observation/one.json': { score: 5 },
  'Observation/two.json': { score: 0 },
  'Observation/three.json': { score: 7 },
  'Day/blue.json': {
    postedCount: 1,
    total: 5,
    submittedIds: [realmURL + 'Observation/one'],
  },
  'Day/empty.json': { postedCount: 0, total: 0, submittedIds: [] },
};

module('Lattice | automatic Node and Chrome data parity', (hooks) => {
  let db: PgAdapter;
  let network: VirtualNetwork;
  let browser: Prerenderer;
  let worker: LatticeBxlWorker;
  let nativeActive = false;
  let browserCalls = 0;
  let snapshots = new Map<string, LatticeDefinitionSnapshot>();
  let modules = new Map<string, ModuleRenderResponse>();
  let originPatch: ReturnType<
    typeof installRealmServerAssertOwnRealmServerBypassPatch
  >;
  const auth = () => {
    const sessions = JSON.parse(
      testCreatePrerenderAuth(actor, {
        [realmURL]: ['read', 'write', 'realm-owner'],
      }),
    );
    sessions[new URL(realmURL).origin + '/'] = sessions[realmURL];
    return JSON.stringify(sessions);
  };
  const renderer: PrerendererAPI = {
    async prerenderVisit(args) {
      if (nativeActive) throw new Error('Node data indexing called Chrome');
      browserCalls++;
      const result = (await browser.prerenderVisit(args)).response;
      if (result.card?.error)
        console.error(
          'Lattice parity Chrome failure',
          args.url,
          result.card.error.error.message,
        );
      return result;
    },
    async prerenderModule(args) {
      if (nativeActive) throw new Error('Node definition lookup called Chrome');
      browserCalls++;
      return (await browser.prerenderModule(args)).response;
    },
    async runCommand() {
      throw new Error('Unexpected command');
    },
    async releaseBatch(args) {
      await browser.releaseBatch(args);
    },
  };

  hooks.before(() => {
    // Reuse the ordinary query-prerender test adapter for a dynamic fixture
    // origin. Search execution and server authorization are unchanged.
    originPatch = installRealmServerAssertOwnRealmServerBypassPatch();
    browser = getPrerendererForTesting({
      serverURL: new URL(realmURL).origin,
      maxPages: 2,
    });
    worker = new LatticeBxlWorker();
  });
  hooks.after(async () => {
    await originPatch.restore();
    await worker.close();
    await browser.stop();
  });
  setupPermissionedRealm(hooks, {
    latticeEnabled: true,
    mode: 'before',
    realmURL: new URL(realmURL),
    permissions: { '*': ['read'], [actor]: ['read', 'write', 'realm-owner'] },
    fileSystem: { 'cards.gts': source, ...fixtures },
    prerenderer: renderer,
    onRealmSetup({ dbAdapter, virtualNetwork }) {
      db = dbAdapter;
      network = virtualNetwork;
    },
  });

  const key = (codeRef: CodeRef) => internalKeyFor(codeRef, undefined, network);
  async function capture(codeRef: CodeRef): Promise<void> {
    if (snapshots.has(key(codeRef))) return;
    if (!isResolvedCodeRef(codeRef))
      throw new Error('Fixture must export its contained definitions');
    let captured = modules.get(codeRef.module);
    if (!captured) {
      const resolved = network.resolveURL(codeRef.module, realmURL);
      // Base uses a virtual URL alias in both loaders. Retain it so a second
      // physical module URL cannot create a duplicate CardDef/FieldDef family.
      const url = network.mapURL(resolved, 'real-to-virtual') ?? resolved;
      captured = await renderer.prerenderModule({
        affinityType: 'realm',
        affinityValue: realmURL,
        realm: realmURL,
        url: url.href,
        auth: auth(),
      });
      modules.set(codeRef.module, captured);
    }
    const exported = Object.values(captured.definitions).find(
      (entry) =>
        entry.type === 'definition' &&
        isResolvedCodeRef(entry.definition.codeRef) &&
        entry.definition.codeRef.name === codeRef.name,
    );
    if (!exported || exported.type !== 'definition')
      throw new Error(
        `Chrome did not capture ${codeRef.name}: ${JSON.stringify(captured.error)}`,
      );
    const definition = exported.definition;
    snapshots.set(key(codeRef), {
      definition,
      revision: latticeDefinitionDigest(definition),
    });
    for (const field of Object.values(definition.fieldDefs)) {
      if (
        field.nativeCodec?.kind === 'compound' &&
        (field.type === 'contains' ||
          field.type === 'containsMany' ||
          field.query)
      ) {
        await capture(field.fieldOrCard);
      }
    }
  }
  const snapshot = (codeRef: CodeRef): LatticeDefinitionSnapshot => {
    const found = snapshots.get(key(codeRef));
    if (!found)
      throw new Error(
        `Definition was not captured before native execution: ${key(codeRef)}`,
      );
    return found;
  };

  test('complete computed attributes, query membership and search data agree', async (assert) => {
    assert.timeout(180_000);
    await waitUntil(
      async () => {
        const outstanding = await db.execute(
          "SELECT 1 FROM jobs WHERE status='unfulfilled' LIMIT 1",
        );
        return outstanding.length === 0;
      },
      {
        timeout: 60_000,
        timeoutMessage: 'The synthetic fixture did not finish indexing',
      },
    );
    // The ordinary fixture owns this realm locally; native input frames also
    // require its persisted metadata authority, as in production admission.
    await db.execute(
      'INSERT INTO realm_metadata(url) VALUES($1) ON CONFLICT DO NOTHING',
      { bind: [realmURL] },
    );
    await capture(ref('Observation'));
    await capture(ref('Day'));
    assert.true(
      browserCalls > 0,
      'real Chrome indexing supplied the definition metadata',
    );
    const root = snapshot(ref('Day')).definition;
    assert.true(
      root.nativeIndex?.materialized,
      'real definition capture retained owner classification',
    );
    assert.deepEqual(root.nativeQueryInputs, {
      observations: {},
      selected: {},
    });

    const frozenLookup: Pick<DefinitionLookup, 'lookupDefinition'> = {
      lookupDefinition: async (codeRef: CodeRef): Promise<Definition> =>
        snapshot(codeRef).definition,
    };
    const index = createLatticeNativeCardIndexer({
      worker,
      // Admission policy and guarded publication have their own transaction
      // tests. Here authority is restricted to this immutable synthetic module;
      // definitions are real captured artifacts, never hand-written stand-ins.
      admit: async (request) => ({
        root: snapshot(JSON.parse(request.sourceJSON).data.meta.adoptsFrom),
        lookup: async (codeRef) => snapshot(codeRef),
        resolve: (reference, relativeTo) =>
          network.resolveURL(reference, relativeTo).href,
        relative: (reference, id) =>
          reference.startsWith('@')
            ? reference
            : maybeRelativeReference(
                network.resolveURL(reference, id),
                network.toURL(id),
                new URL(realmURL),
              ),
        typeKey: key,
        deps: [realmURL + 'cards'],
        runtimeRevision: 'repository-parity-fixture',
        inputActor: actor,
        assertCurrent: async () => {
          throw new Error('This parity test must not publish a candidate');
        },
      }),
      openInputs: (request) =>
        LatticeMaterializationInputs.open({
          db,
          network,
          realmURL,
          actor,
          generation: request.inputSnapshot!.generation,
          loaderEpoch: request.loaderEpoch,
          lookup: frozenLookup,
        }),
    });
    for (const [path, input] of Object.entries(fixtures)) {
      const [generation] = await db.execute(
        'SELECT current_generation,loader_epoch FROM realm_generations WHERE realm_url=$1',
        { bind: [realmURL] },
      );
      const inputSnapshot = path.startsWith('Day/')
        ? { realmURL, generation: Number(generation.current_generation) }
        : undefined;
      const { card: chrome } = await renderer.prerenderVisit({
        affinityType: 'realm',
        affinityValue: realmURL,
        realm: realmURL,
        url: realmURL + path,
        auth: auth(),
        visitType: 'index',
        inputSnapshot: inputSnapshot,
        renderOptions: { clearCache: true, cardRender: true },
      });
      if (!chrome) throw new Error(`${path}: Chrome returned no card data`);
      assert.strictEqual(
        chrome.error,
        undefined,
        `${path}: Chrome computed successfully`,
      );
      const callsBefore = browserCalls;
      nativeActive = true;
      let candidate;
      try {
        candidate = await index({
          url: realmURL + path,
          realmURL,
          sourceJSON: JSON.stringify(input),
          generation: Number(generation.current_generation) + 1,
          loaderEpoch: generation.loader_epoch as string,
          lastModified: 1,
          resourceCreatedAt: 1,
          ...(inputSnapshot ? { inputSnapshot } : {}),
        });
      } finally {
        nativeActive = false;
      }
      if (!candidate || !chrome.serialized)
        throw new Error(`${path}: missing engine output`);
      for (const [field, expected] of Object.entries(expectedValues[path])) {
        assert.deepEqual(
          candidate.card.serialized?.data.attributes?.[field],
          expected,
          `${path}: ${field} has the expected fixture value`,
        );
      }
      assert.strictEqual(
        candidate.card.serialized?.data.id,
        chrome.serialized.data.id,
        `${path}: card identity`,
      );
      assert.strictEqual(
        candidate.card.serialized?.data.type,
        chrome.serialized.data.type,
        `${path}: resource kind`,
      );
      assert.strictEqual(
        browserCalls,
        callsBefore,
        `${path}: Node used no browser`,
      );
      assert.deepEqual(
        candidate.card.serialized?.data.attributes,
        chrome.serialized.data.attributes,
        `${path}: all serialized attributes`,
      );
      assert.deepEqual(
        candidate.card.serialized?.data.relationships,
        chrome.serialized.data.relationships,
        `${path}: complete relationship membership`,
      );
      // Chrome's response and the index writer both cross a JSON boundary.
      // Undefined properties are not persisted; retain all other keys/values.
      assert.deepEqual(
        JSON.parse(JSON.stringify(candidate.card.searchDoc)),
        chrome.searchDoc,
        `${path}: complete search document`,
      );
      assert.deepEqual(
        candidate.card.types,
        chrome.types,
        `${path}: type ancestry`,
      );
      assert.deepEqual(
        candidate.card.displayNames,
        chrome.displayNames,
        `${path}: display names`,
      );
      assert.deepEqual(
        candidate.card.serialized?.data.meta.adoptsFrom,
        chrome.serialized.data.meta.adoptsFrom,
        `${path}: definition identity`,
      );
    }
  });
});
