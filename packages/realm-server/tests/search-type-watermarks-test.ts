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
import { IndexWriter } from '@cardstack/runtime-common';
import {
  fetchTypeScopedGenerations,
  resolveSearchGenerations,
  searchTypeWatermarkKeys,
} from '../search-type-watermarks.ts';
import { createVirtualNetwork, setupDB } from './helpers/index.ts';

const realmA = 'http://127.0.0.1:4444/a/';
const realmB = 'http://127.0.0.1:4444/b/';

const personRef = { module: rri(`${realmA}person`), name: 'Person' };
const petRef = { module: rri(`${realmA}pet`), name: 'Pet' };

module(basename(import.meta.filename), function () {
  module('the keys a query is scoped by', function (hooks) {
    let virtualNetwork: ReturnType<typeof createVirtualNetwork>;

    hooks.beforeEach(function () {
      virtualNetwork = createVirtualNetwork();
    });

    let keysFor = (filter: SearchEntryWireFilter | undefined) =>
      searchTypeWatermarkKeys(wireFilterTypeAnchors(filter), virtualNetwork);

    test('an anchored filter is scoped to its own type plus the catch-all', function (assert) {
      assert.deepEqual(keysFor({ 'item.on': personRef }), [
        internalKeyFor(personRef, undefined, virtualNetwork),
        ALL_TYPES_KEY,
      ]);
    });

    test("a filter's ancestors are deliberately not resolved", function (assert) {
      // The write side stamps the full adoption chain, so a `Person` write
      // moves `CardDef` too. Reading `CardDef` here as well would put a key
      // every write moves into every query, leaving no selectivity at all.
      assert.false(
        (keysFor({ 'item.on': personRef }) ?? []).includes(
          internalKeyFor(baseCardRef, undefined, virtualNetwork),
        ),
        'the anchor resolves to itself, not to what it adopts from',
      );
    });

    test('an `any` scopes to every branch it could match', function (assert) {
      assert.deepEqual(
        keysFor({
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

    test('a relative module spelling is not scoped', function (assert) {
      // The server resolves it against the document that issued the query,
      // which the watermark key has no access to — so it cannot be compared
      // with the spelling the indexer stamped.
      assert.strictEqual(
        keysFor({ 'item.on': { module: rri('./person'), name: 'Person' } }),
        undefined,
      );
    });
  });

  module('the watermarks a scoped query reads', function (hooks) {
    let dbAdapter: PgAdapter;
    let virtualNetwork: ReturnType<typeof createVirtualNetwork>;

    setupDB(hooks, {
      beforeEach: async (_dbAdapter) => {
        dbAdapter = _dbAdapter;
        virtualNetwork = createVirtualNetwork();
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
        { [realmA]: { index: 7, html: 5 } },
        'an anchored query reads its own type instead',
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
    async function indexPass(opts?: {
      splitPrerenderHtml?: boolean;
      // Skipping `invalidate()` is what a from-scratch rebuild does: it
      // writes rows without first reading what the realm held.
      scoped?: boolean;
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
      if (opts?.scoped !== false) {
        await batch.invalidate([url]);
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
      // A from-scratch rebuild names the types it wrote but not one whose
      // last row it dropped, so absence there has to read as "unknown".
      await indexPass({ scoped: false });

      assert.deepEqual(
        (await stampedRows()).find(({ typeKey }) => typeKey === ALL_TYPES_KEY),
        { typeKey: ALL_TYPES_KEY, index: 1, html: 0 },
      );
    });

    test('a query anchored elsewhere reads past the pass entirely', async function (assert) {
      await indexPass();

      let keys = searchTypeWatermarkKeys(
        [{ module: rri(`${realmA}person`), name: 'Person' }],
        virtualNetwork,
      );
      assert.deepEqual(
        await fetchTypeScopedGenerations(dbAdapter, [realmA], keys!),
        { [realmA]: { index: 0, html: 0 } },
        'the Pet pass moved nothing a Person-anchored query reads',
      );

      let petKeys = searchTypeWatermarkKeys([petRef], virtualNetwork);
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

    test('a render-only swap moves the HTML leg of the rows it published, and only that leg', async function (assert) {
      await indexPass();

      let htmlOnly = await new IndexWriter(dbAdapter).createBatch(
        realm(),
        virtualNetwork,
        { jobId: 99, reservationId: 1, priority: 0, queueWaitMs: null },
        { prerenderHtmlOnly: true, generation: 9 },
      );
      await htmlOnly.seedPrerenderedHtmlInvalidations([
        { url: `${realmA}pet-1.json`, operation: 'update' },
      ]);
      await htmlOnly.done();

      assert.deepEqual(await stampedRows(), [
        { typeKey: `${realmA}card-api/CardDef`, index: 1, html: 9 },
        { typeKey: `${realmA}pet/Pet`, index: 1, html: 9 },
      ]);
    });

    test('a stale render-only swap does not lower the HTML watermark', async function (assert) {
      await indexPass();
      for (let generation of [9, 3]) {
        let batch = await new IndexWriter(dbAdapter).createBatch(
          realm(),
          virtualNetwork,
          {
            jobId: generation,
            reservationId: 1,
            priority: 0,
            queueWaitMs: null,
          },
          { prerenderHtmlOnly: true, generation },
        );
        await batch.seedPrerenderedHtmlInvalidations([
          { url: `${realmA}pet-1.json`, operation: 'update' },
        ]);
        await batch.done();
      }

      assert.deepEqual(await stampedRows(), [
        { typeKey: `${realmA}card-api/CardDef`, index: 1, html: 9 },
        { typeKey: `${realmA}pet/Pet`, index: 1, html: 9 },
      ]);
    });
  });
});
