import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { PgAdapter } from '@cardstack/postgres';
import {
  ALL_TYPES_KEY,
  baseCardRef,
  internalKeyFor,
  param,
  query,
  rri,
  wireFilterTypeAnchors,
  type Expression,
  type SearchEntryWireFilter,
} from '@cardstack/runtime-common';
import {
  IndexWriter,
  type CodeRef,
  type Realm,
} from '@cardstack/runtime-common';
import {
  fetchTypeScopedGenerations,
  resetAnchorKeysForTests,
  resolveSearchGenerations,
  searchTypeWatermarkKeys,
  warmSearchTypeWatermarkKeys,
} from '../search-type-watermarks.ts';
import { createVirtualNetwork, setupDB } from './helpers/index.ts';

// Stands in for the mounted realm the warm-up resolves through. The real one
// delegates to `IndexQueryEngine.typeKeysFor`, whose contract this mirrors:
// the ref's own spelling plus its canonical defining-module spelling.
function realmResolving(canonical: Record<string, string[]> = {}): () => Realm {
  return () =>
    ({
      realmIndexQueryEngine: {
        typeKeysFor: async (ref: CodeRef) => {
          let own = internalKeyFor(ref, undefined, createVirtualNetwork());
          return canonical[own] ?? [own];
        },
      },
    }) as unknown as Realm;
}

// The warm-up is fire-and-forget by design, so a test that depends on its
// result waits for the keys rather than for a promise it was never handed.
async function warmed(
  anchors: CodeRef[],
  virtualNetwork: ReturnType<typeof createVirtualNetwork>,
  mountedRealm: () => Realm | undefined,
): Promise<string[] | undefined> {
  for (let attempt = 0; attempt < 100; attempt++) {
    let keys = searchTypeWatermarkKeys(anchors, virtualNetwork);
    if (keys) {
      return keys;
    }
    warmSearchTypeWatermarkKeys({ anchors, virtualNetwork, mountedRealm });
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return searchTypeWatermarkKeys(anchors, virtualNetwork);
}

const realmA = 'http://127.0.0.1:4444/a/';
const realmB = 'http://127.0.0.1:4444/b/';

const personRef = { module: rri(`${realmA}person`), name: 'Person' };
const petRef = { module: rri(`${realmA}pet`), name: 'Pet' };
// A spelling that names `Pet` through a module that re-exports it, so its own
// key is not the one the indexer stamps on the rows it matches.
const reExportedRef = { module: rri(`${realmA}pets-index`), name: 'Pet' };

module(basename(import.meta.filename), function () {
  module('the keys a query is scoped by', function (hooks) {
    let virtualNetwork: ReturnType<typeof createVirtualNetwork>;

    hooks.beforeEach(function () {
      virtualNetwork = createVirtualNetwork();
      resetAnchorKeysForTests();
    });

    let anchorsOf = (filter: SearchEntryWireFilter | undefined) =>
      wireFilterTypeAnchors(filter);
    let keysFor = (filter: SearchEntryWireFilter | undefined) =>
      searchTypeWatermarkKeys(anchorsOf(filter), virtualNetwork);
    let warmKeysFor = (
      filter: SearchEntryWireFilter | undefined,
      canonical?: Record<string, string[]>,
    ) => warmed(anchorsOf(filter)!, virtualNetwork, realmResolving(canonical));

    test('an anchored filter is scoped to its own type plus the catch-all', async function (assert) {
      assert.deepEqual(await warmKeysFor({ 'item.on': personRef }), [
        internalKeyFor(personRef, undefined, virtualNetwork),
        ALL_TYPES_KEY,
      ]);
    });

    test('an anchor is unscoped until its keys are resolved', async function (assert) {
      // Resolving a `CodeRef` to the keys the indexer stamps can cost a
      // definition lookup, which must not land on the cache-hit path — so a
      // cold anchor reads the realm-wide generation and the resolution runs
      // behind it.
      assert.strictEqual(
        keysFor({ 'item.on': personRef }),
        undefined,
        'a cold anchor is unscoped',
      );
      assert.ok(
        await warmKeysFor({ 'item.on': personRef }),
        'and is scoped once its keys land',
      );
    });

    test('an anchor spelled through a re-exporting module is scoped by the key its rows carry', async function (assert) {
      // The indexer stamps a row with its defining module's spelling, so
      // scoping on the query's own spelling alone would address a row nothing
      // ever writes — a key no write could move.
      let ownKey = internalKeyFor(reExportedRef, undefined, virtualNetwork);
      let canonicalKey = internalKeyFor(petRef, undefined, virtualNetwork);

      assert.deepEqual(
        await warmKeysFor(
          { 'item.on': reExportedRef },
          {
            [ownKey]: [ownKey, canonicalKey],
          },
        ),
        [ownKey, canonicalKey, ALL_TYPES_KEY],
      );
    });

    test("a filter's ancestors are deliberately not resolved", async function (assert) {
      // The write side stamps the full adoption chain, so a `Person` write
      // moves `CardDef` too. Reading `CardDef` here as well would put a key
      // every write moves into every query, leaving no selectivity at all.
      assert.false(
        (await warmKeysFor({ 'item.on': personRef }))!.includes(
          internalKeyFor(baseCardRef, undefined, virtualNetwork),
        ),
        'the anchor resolves to itself, not to what it adopts from',
      );
    });

    test('an `any` scopes to every branch it could match', async function (assert) {
      assert.deepEqual(
        await warmKeysFor({
          any: [{ 'item.on': personRef }, { 'item.on': petRef }],
        }),
        [
          internalKeyFor(personRef, undefined, virtualNetwork),
          internalKeyFor(petRef, undefined, virtualNetwork),
          ALL_TYPES_KEY,
        ],
      );
    });

    test('a filter that admits an entry of any type is not scoped', function (assert) {
      assert.strictEqual(
        keysFor(undefined),
        undefined,
        'no filter takes the realm-wide generation',
      );
      assert.strictEqual(
        keysFor({ eq: { 'item.firstName': 'Mango' } }),
        undefined,
        'an unanchored value filter takes the realm-wide generation',
      );
      assert.strictEqual(
        keysFor({
          any: [{ 'item.on': personRef }, { eq: { 'item.firstName': 'Van' } }],
        }),
        undefined,
        'one unanchored branch admits any type, so the whole query is unscoped',
      );
    });

    test('a relative module spelling is not scoped', async function (assert) {
      // The server resolves it against the document that issued the query,
      // which the watermark key has no access to — so it cannot be compared
      // with the spelling the indexer stamped.
      let filter: SearchEntryWireFilter = {
        'item.on': { module: rri('./person'), name: 'Person' },
      };
      assert.strictEqual(await warmKeysFor(filter), undefined);
    });
  });

  module('the watermarks a scoped query reads', function (hooks) {
    let dbAdapter: PgAdapter;
    let virtualNetwork: ReturnType<typeof createVirtualNetwork>;

    setupDB(hooks, {
      beforeEach: async (_dbAdapter) => {
        dbAdapter = _dbAdapter;
        virtualNetwork = createVirtualNetwork();
        resetAnchorKeysForTests();
      },
    });

    async function stamp(
      realm: string,
      typeKey: string,
      generations: { index?: number; html?: number },
    ) {
      await query(dbAdapter, [
        `INSERT INTO realm_type_generations
           (realm_url, type_key, index_generation, html_generation) VALUES (`,
        param(realm),
        `,`,
        param(typeKey),
        `,`,
        param(generations.index ?? 0),
        `,`,
        param(generations.html ?? 0),
        `) ON CONFLICT ON CONSTRAINT realm_type_generations_pkey
           DO UPDATE SET index_generation=EXCLUDED.index_generation,
                         html_generation=EXCLUDED.html_generation`,
      ] as Expression);
    }

    async function setRealmGeneration(realm: string, generation: number) {
      await query(dbAdapter, [
        `INSERT INTO realm_generations (realm_url, current_generation) VALUES (`,
        param(realm),
        `,`,
        param(generation),
        `) ON CONFLICT ON CONSTRAINT realm_generations_pkey
           DO UPDATE SET current_generation=EXCLUDED.current_generation`,
      ] as Expression);
    }

    let personKey = () => internalKeyFor(personRef, undefined, virtualNetwork);

    test('a type nothing has stamped reads as generation 0 on both channels', async function (assert) {
      await stamp(realmA, personKey(), { index: 7, html: 5 });

      assert.deepEqual(
        await fetchTypeScopedGenerations(
          dbAdapter,
          [realmA, realmB],
          [personKey()],
        ),
        {
          [realmA]: { index: 7, html: 5 },
          // The first write that touches `Person` in realm B creates its row
          // and moves the key; until then it cannot have moved.
          [realmB]: { index: 0, html: 0 },
        },
      );
    });

    test('a write to a type the query does not select leaves its watermark alone', async function (assert) {
      await stamp(realmA, personKey(), { index: 7, html: 5 });
      let before = await fetchTypeScopedGenerations(
        dbAdapter,
        [realmA],
        [personKey(), ALL_TYPES_KEY],
      );

      await stamp(realmA, internalKeyFor(petRef, undefined, virtualNetwork), {
        index: 8,
        html: 8,
      });

      assert.deepEqual(
        await fetchTypeScopedGenerations(
          dbAdapter,
          [realmA],
          [personKey(), ALL_TYPES_KEY],
        ),
        before,
        'the Pet write is invisible to a Person-scoped key',
      );
    });

    test('the two channels move the key independently', async function (assert) {
      await stamp(realmA, personKey(), { index: 7, html: 5 });
      // A render landing after the index pass advances only the HTML leg.
      // Search excludes rows with an effective error and a render error lands
      // on that leg, so it has to ride the key on its own.
      await stamp(realmA, personKey(), { index: 7, html: 9 });

      assert.deepEqual(
        await fetchTypeScopedGenerations(dbAdapter, [realmA], [personKey()]),
        { [realmA]: { index: 7, html: 9 } },
      );
    });

    test('the catch-all key moves every scoped query', async function (assert) {
      await stamp(realmA, personKey(), { index: 7, html: 5 });
      await stamp(realmA, ALL_TYPES_KEY, { index: 11, html: 11 });

      assert.deepEqual(
        await fetchTypeScopedGenerations(
          dbAdapter,
          [realmA],
          [personKey(), ALL_TYPES_KEY],
        ),
        { [realmA]: { index: 11, html: 11 } },
        'a pass that could not name its types invalidates everything',
      );
    });

    test('an unscoped query falls back to the realm-wide generation', async function (assert) {
      await setRealmGeneration(realmA, 42);
      await stamp(realmA, personKey(), { index: 7, html: 5 });

      assert.deepEqual(
        await resolveSearchGenerations(
          dbAdapter,
          [realmA],
          undefined,
          virtualNetwork,
        ),
        { [realmA]: { index: 42, html: 0 } },
        'with no type anchor the key advances on every index batch, as before',
      );

      assert.deepEqual(
        await resolveSearchGenerations(
          dbAdapter,
          [realmA],
          [personRef],
          virtualNetwork,
        ),
        { [realmA]: { index: 42, html: 0 } },
        'an anchor whose keys are not resolved yet reads the realm-wide generation too',
      );

      await warmed([personRef], virtualNetwork, realmResolving());
      assert.deepEqual(
        await resolveSearchGenerations(
          dbAdapter,
          [realmA],
          [personRef],
          virtualNetwork,
        ),
        { [realmA]: { index: 7, html: 5 } },
        'once they land the query reads its own type instead',
      );
    });
  });

  // The write side, driven directly: a Batch's swap is what maintains these
  // rows, and the two channels are stamped by different passes once
  // prerendering is split off the indexing pass.
  module('the watermarks a pass stamps', function (hooks) {
    let dbAdapter: PgAdapter;
    let virtualNetwork: ReturnType<typeof createVirtualNetwork>;

    setupDB(hooks, {
      beforeEach: async (_dbAdapter) => {
        dbAdapter = _dbAdapter;
        virtualNetwork = createVirtualNetwork();
        resetAnchorKeysForTests();
      },
    });

    let realm = () => new URL(realmA);
    let petChain = [`${realmA}pet/Pet`, `${realmA}card-api/CardDef`];

    async function stampedRows(realmURL = realmA) {
      let rows = (await query(dbAdapter, [
        `SELECT type_key, index_generation, html_generation
           FROM realm_type_generations WHERE realm_url =`,
        param(realmURL),
        `ORDER BY type_key`,
      ] as Expression)) as {
        type_key: string;
        index_generation: number;
        html_generation: number;
      }[];
      return rows.map(({ type_key, index_generation, html_generation }) => ({
        typeKey: type_key,
        index: Number(index_generation),
        html: Number(html_generation),
      }));
    }

    // A minimal pass that writes one row carrying `types`.
    //
    // `invalidates` is what the pass reads before writing. Passing the URL it
    // goes on to write is the ordinary incremental shape; passing a different
    // URL, or none, is the shape a rebuild takes when its visit list is not
    // the set it tombstoned — the case where the pass cannot account for a
    // type its rows are leaving.
    async function indexPass(opts?: {
      splitPrerenderHtml?: boolean;
      invalidates?: 'the written url' | 'a different url' | 'nothing';
      realmURL?: URL;
      types?: string[];
    }) {
      let realmURL = opts?.realmURL ?? realm();
      let batch = await new IndexWriter(dbAdapter).createBatch(
        realmURL,
        virtualNetwork,
        undefined,
        opts?.splitPrerenderHtml === undefined
          ? undefined
          : { splitPrerenderHtml: opts.splitPrerenderHtml },
      );
      let url = new URL(`${realmURL.href}pet-1.json`);
      let invalidates = opts?.invalidates ?? 'the written url';
      if (invalidates === 'the written url') {
        await batch.invalidate([url]);
      } else if (invalidates === 'a different url') {
        await batch.invalidate([new URL(`${realmURL.href}gone.json`)]);
      }
      await batch.updateEntry(url, {
        type: 'file',
        deps: new Set<string>(),
        lastModified: Date.now(),
        resourceCreatedAt: Date.now(),
        types: opts?.types ?? petChain,
      });
      await batch.done();
    }

    test('an index pass stamps every chain member it wrote', async function (assert) {
      await indexPass();

      assert.deepEqual(await stampedRows(), [
        { typeKey: `${realmA}card-api/CardDef`, index: 1, html: 0 },
        { typeKey: `${realmA}pet/Pet`, index: 1, html: 0 },
      ]);
    });

    test('a pass that establishes its change set leaves the catch-all alone', async function (assert) {
      await indexPass();

      assert.false(
        (await stampedRows()).some(({ typeKey }) => typeKey === ALL_TYPES_KEY),
        'the catch-all is what costs every scoped query its entry, so a pass that can name its types must not move it',
      );
    });

    test('a pass that never read what the realm held moves the catch-all', async function (assert) {
      // A rebuild names the types it wrote but not one whose last row it
      // dropped, so absence there has to read as "unknown".
      await indexPass({ invalidates: 'nothing' });

      assert.deepEqual(
        (await stampedRows()).find(({ typeKey }) => typeKey === ALL_TYPES_KEY),
        { typeKey: ALL_TYPES_KEY, index: 1, html: 0 },
      );
    });

    test('a pass whose reads do not cover its writes moves the catch-all', async function (assert) {
      // Having called `invalidate()` at all is not the property: a rebuild
      // whose disk state matches nothing in the index invalidates only the
      // deleted URLs and then writes every file in the realm. Those rows are
      // written without their prior chain ever being read, so a card that
      // changed what it adopts from would leave the type it departed
      // unstamped and reachable.
      await indexPass({ invalidates: 'a different url' });

      assert.deepEqual(
        (await stampedRows()).find(({ typeKey }) => typeKey === ALL_TYPES_KEY),
        { typeKey: ALL_TYPES_KEY, index: 1, html: 0 },
      );
    });

    test('a departed type is stamped when the pass read the row it overwrote', async function (assert) {
      await indexPass({ types: [`${realmA}pet/Pet`] });
      await indexPass({ types: [`${realmA}dog/Dog`] });

      let rows = await stampedRows();
      assert.deepEqual(
        rows.find(({ typeKey }) => typeKey === `${realmA}pet/Pet`),
        { typeKey: `${realmA}pet/Pet`, index: 2, html: 0 },
        'the type the row left moves, so a search anchored on it recomputes',
      );
      assert.deepEqual(
        rows.find(({ typeKey }) => typeKey === `${realmA}dog/Dog`),
        { typeKey: `${realmA}dog/Dog`, index: 2, html: 0 },
        'and so does the type it joined',
      );
      assert.false(
        rows.some(({ typeKey }) => typeKey === ALL_TYPES_KEY),
        'a pass that can account for both needs no catch-all',
      );
    });

    test('a query anchored elsewhere reads past the pass entirely', async function (assert) {
      await indexPass();

      let keys = await warmed(
        [{ module: rri(`${realmA}person`), name: 'Person' }],
        virtualNetwork,
        realmResolving(),
      );
      assert.deepEqual(
        await fetchTypeScopedGenerations(dbAdapter, [realmA], keys!),
        { [realmA]: { index: 0, html: 0 } },
        'the Pet pass moved nothing a Person-anchored query reads',
      );

      let petKeys = await warmed([petRef], virtualNetwork, realmResolving());
      assert.deepEqual(
        await fetchTypeScopedGenerations(dbAdapter, [realmA], petKeys!),
        { [realmA]: { index: 1, html: 0 } },
        'the same pass does move the key of a query that selects Pet',
      );
    });

    test('a fused pass publishes both channels in one swap', async function (assert) {
      // Where prerendering is not split off the indexing pass, the same swap
      // lands the HTML, so both legs carry the pass's generation.
      await indexPass({ splitPrerenderHtml: false });

      assert.deepEqual(await stampedRows(), [
        { typeKey: `${realmA}card-api/CardDef`, index: 1, html: 1 },
        { typeKey: `${realmA}pet/Pet`, index: 1, html: 1 },
      ]);
    });

    // A prerender-html job's swap, from a job that read the realm's committed
    // generation as `generation` when its visits were released — the value
    // its type watermarks carry.
    async function renderOnlySwap({
      generation,
      jobId,
    }: {
      generation: number;
      jobId: number;
    }) {
      await dbAdapter.execute(
        `UPDATE realm_generations SET current_generation = $1 WHERE realm_url = $2`,
        { bind: [generation, realmA] },
      );
      let batch = await new IndexWriter(dbAdapter).createBatch(
        realm(),
        virtualNetwork,
        {
          jobId,
          reservationId: 1,
          priority: 0,
          queueWaitMs: null,
          concurrencyGroup: null,
          laneFamily: null,
        },
        { prerenderHtmlOnly: true },
      );
      await batch.adoptIndexGenerations([`${realmA}pet-1.json`]);
      await batch.seedPrerenderedHtmlInvalidations([
        { url: `${realmA}pet-1.json`, operation: 'update' },
      ]);
      await batch.done();
    }

    test('a render-only swap moves the HTML leg of the rows it published, and only that leg', async function (assert) {
      await indexPass();

      await renderOnlySwap({ generation: 9, jobId: 99 });

      assert.deepEqual(await stampedRows(), [
        { typeKey: `${realmA}card-api/CardDef`, index: 1, html: 9 },
        { typeKey: `${realmA}pet/Pet`, index: 1, html: 9 },
      ]);
    });

    test('a stale render-only swap does not lower the HTML watermark', async function (assert) {
      await indexPass();
      for (let generation of [9, 3]) {
        await renderOnlySwap({ generation, jobId: generation });
      }

      assert.deepEqual(await stampedRows(), [
        { typeKey: `${realmA}card-api/CardDef`, index: 1, html: 9 },
        { typeKey: `${realmA}pet/Pet`, index: 1, html: 9 },
      ]);
    });
  });
});
