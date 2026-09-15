import QUnit from 'qunit';
import { basename } from 'node:path';
import type { PgAdapter } from '@cardstack/postgres';
import {
  internalKeyFor,
  isResolvedCodeRef,
  maybeRelativeReference,
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
  localBaseRealm,
  getPrerendererForTesting,
  setupPermissionedRealm,
  testCreatePrerenderAuth,
  waitUntil,
} from './helpers/index.ts';
import { installRealmServerAssertOwnRealmServerBypassPatch } from './helpers/prerender-page-patches.ts';
import {
  CLINICAL_OWNER_TYPES,
  clinicalFixtures,
  clinicalModuleRef,
  clinicalTypeOf,
  expectedAttributes,
  generateClinical,
  latticeClinicalSource,
  type ClinicalType,
} from './helpers/lattice-clinical-fixture.ts';

const { module, test } = QUnit;
const origin = 'http://127.0.0.1:4456/';
const realmURL = origin + 'lattice-clinical-native/';
const actor = '@lattice-clinical-native:localhost';
const { records } = generateClinical({ realmURL });
const fixtures = clinicalFixtures(records);
const ref = (name: ClinicalType) => clinicalModuleRef(realmURL, name);

// Native placement parity on the clinical workload. The parity fixture the
// execution plan uses covers five cards and a handful of jq. The clinical
// formulas use sort_by with a compound key, max_by, unique, if/elif, string
// building, booleans, and a projected link two hops deep, across a
// three-level chain of materialized owners. Chrome captures the real
// definitions and indexes every card; Node then consumes the frozen
// definitions and the actual PostgreSQL inputs. Every serialized attribute,
// relationship, search document, type and display name must agree, and the
// owners must also equal the raw-document oracle so parity is never vacuous.
module(basename(import.meta.filename), function (hooks) {
  let db: PgAdapter;
  let network: VirtualNetwork;
  let browser: Prerenderer;
  let worker: LatticeBxlWorker;
  let nativeActive = false;
  let browserCalls = 0;
  const snapshots = new Map<string, LatticeDefinitionSnapshot>();
  const modules = new Map<string, ModuleRenderResponse>();
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
          'Lattice clinical parity Chrome failure',
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
    fileSystem: { 'cards.gts': latticeClinicalSource, ...fixtures },
    prerenderer: renderer,
    assetsURL: new URL(process.env.HOST_URL ?? 'http://localhost:4200/'),
    onRealmSetup({ dbAdapter, virtualNetwork }) {
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

  const key = (codeRef: CodeRef) => internalKeyFor(codeRef, undefined, network);
  async function capture(codeRef: CodeRef): Promise<void> {
    if (snapshots.has(key(codeRef))) return;
    if (!isResolvedCodeRef(codeRef))
      throw new Error('Fixture must export its contained definitions');
    let captured = modules.get(codeRef.module);
    if (!captured) {
      const resolved = network.resolveURL(codeRef.module, realmURL);
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
          field.type === 'linksTo' ||
          field.type === 'linksToMany' ||
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

  test('every clinical card computes identically in Node and Chrome, and owners equal the oracle', async (assert) => {
    assert.timeout(900_000);
    await waitUntil(
      async () => {
        const jobs = await db.execute(
          "SELECT 1 FROM jobs WHERE status='unfulfilled' LIMIT 1",
        );
        if (jobs.length) return false;
        const dirty = await db.execute(
          'SELECT 1 FROM lattice_owners WHERE realm_url=$1 AND retired=FALSE AND (published_generation IS NULL OR dirty_generation > published_generation) LIMIT 1',
          { bind: [realmURL] },
        );
        return dirty.length === 0;
      },
      {
        timeout: 600_000,
        interval: 250,
        timeoutMessage: 'The clinical fixture did not finish boot indexing',
      },
    );
    await db.execute(
      'INSERT INTO realm_metadata(url) VALUES($1) ON CONFLICT DO NOTHING',
      { bind: [realmURL] },
    );
    for (const name of [
      'Principal',
      'PatientRecord',
      'VitalsReading',
      'DoseEvent',
      'ShiftNote',
      'PatientDaySummary',
      'WardBoard',
      'FacilityCensus',
    ] as ClinicalType[])
      await capture(ref(name));
    assert.true(
      browserCalls > 0,
      'real Chrome indexing supplied the definition metadata',
    );
    for (const name of CLINICAL_OWNER_TYPES) {
      const root = snapshot(ref(name)).definition;
      assert.true(
        root.nativeIndex?.materialized,
        `${name}: real definition capture retained owner classification`,
      );
    }
    assert.deepEqual(
      snapshot(ref('PatientDaySummary')).definition.nativeQueryInputs,
      {
        patients: { links: { attending: { many: false, projection: {} } } },
        vitals: {},
        doses: {},
        notes: {},
      },
      'the summary declares its projected link input',
    );

    const frozenLookup: Pick<DefinitionLookup, 'lookupDefinition'> = {
      lookupDefinition: async (codeRef: CodeRef): Promise<Definition> =>
        snapshot(codeRef).definition,
    };
    const index = createLatticeNativeCardIndexer({
      worker,
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
        runtimeRevision: 'repository-clinical-parity-fixture',
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

    // Sources first, then the chain bottom-up, so a failure names the lowest
    // level that diverges.
    const height = (path: string) =>
      ['PatientDaySummary', 'WardBoard', 'FacilityCensus'].indexOf(
        clinicalTypeOf(records, path),
      );
    const paths = [...records.keys()].sort(
      (a, b) => height(a) - height(b) || a.localeCompare(b),
    );
    let compared = 0;
    for (const path of paths) {
      const input = fixtures[path];
      const isOwner = height(path) >= 0;
      const [generation] = await db.execute(
        'SELECT current_generation,loader_epoch FROM realm_generations WHERE realm_url=$1',
        { bind: [realmURL] },
      );
      const inputSnapshot = isOwner
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
      } catch (error) {
        assert.true(false, `${path}: Node execution failed: ${String(error)}`);
        continue;
      } finally {
        nativeActive = false;
      }
      if (!candidate || !chrome.serialized) {
        assert.true(false, `${path}: missing engine output`);
        continue;
      }
      compared++;
      const expected = expectedAttributes(records, path);
      const derived = Object.fromEntries(
        Object.keys(expected)
          .filter((field) => !(field in (input.data.attributes ?? {})))
          .map((field) => [
            field,
            candidate.card.serialized?.data.attributes?.[field],
          ]),
      );
      const oracle = Object.fromEntries(
        Object.keys(derived).map((field) => [field, expected[field]]),
      );
      if (Object.keys(derived).length)
        assert.deepEqual(
          derived,
          oracle,
          `${path}: Node's derived values equal the raw-document oracle`,
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
    assert.strictEqual(
      compared,
      records.size,
      `all ${records.size} clinical cards were compared`,
    );
  });
});
