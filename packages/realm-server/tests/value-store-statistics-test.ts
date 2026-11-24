import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import type { PgAdapter } from '@cardstack/postgres';
import {
  IndexQueryEngine,
  IndexWriter,
  VirtualNetwork,
  internalKeyFor,
  rri,
  type CodeRef,
  type Definition,
  type DefinitionLookup,
  type FieldDefinition,
  type Query,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';

import {
  closeTestPgAdapter,
  createTestPgAdapter,
  prepareTestDB,
} from './helpers/index.ts';

// The value store's statistics.
//
// The value tables analyze as the search tables do: at 2% changed rows
// (value-store-vacuum-and-statistics).
//
// The no-statistics gate. A realm whose value rows and index rows the
// planner has no statistics for (never analyzed: a new realm before its
// first analyze, a database restored without them) must still be searched
// by plans that read about what an analyzed one reads. For each demo-shaped
// search (the shop's counts-only facets, a range-filtered re-rank with
// facets, a sorted list page, a page of chosen ids), every statement's
// buffers (shared hits plus reads, from EXPLAIN (ANALYZE, BUFFERS)) with the
// statistics withheld stay within a budget of the same statement's buffers
// with them: ten times, plus a floor for the dictionaries' small reads (the
// 12,000-product shop bench measured 614 -> 4,344 blocks for the facets). Where a
// statement's shape is the point, the shape is asserted from its plan: the
// re-rank's comparison set nests no loop over a CTE scan (a fenced form did,
// for 8.3 s on the bench, without statistics). Times are reported, never
// asserted: they would flake on a loaded machine.

const A = 'http://value-stats.test/shop/';
const B = 'http://value-stats.test/notes/';

function ref(module: string, name: string): ResolvedCodeRef {
  return { module: module as ResolvedCodeRef['module'], name };
}
const stringRef = ref('@cardstack/base/string', 'default');
const numberRef = ref('@cardstack/base/number', 'default');
const booleanRef = ref('@cardstack/base/boolean', 'default');
const productRef = ref(`${A}product`, 'Product');
const noteRef = ref(`${B}note`, 'Note');

function field(
  fieldOrCard: ResolvedCodeRef,
  serializerName?: string,
): FieldDefinition {
  return {
    type: 'contains',
    isPrimitive: true,
    isComputed: false,
    fieldOrCard,
    ...(serializerName ? { serializerName } : {}),
    search: { facet: true },
  } as FieldDefinition;
}
function def(
  codeRef: ResolvedCodeRef,
  fields: Record<string, FieldDefinition>,
) {
  return {
    type: 'card-def',
    codeRef,
    displayName: codeRef.name,
    fields: Object.fromEntries(
      Object.keys(fields).map((name, i) => [name, `f${i}`]),
    ),
    fieldDefs: Object.fromEntries(
      Object.values(fields).map((f, i) => [`f${i}`, f]),
    ),
  } as Definition;
}
const productDef = def(productRef, {
  id: { ...field(stringRef), search: undefined } as FieldDefinition,
  cardTitle: field(stringRef),
  productType: field(stringRef),
  brand: field(stringRef),
  material: field(stringRef),
  color: field(stringRef),
  rating: field(numberRef, 'number'),
  reviewCount: field(numberRef, 'number'),
  priceMin: field(numberRef, 'number'),
  inStock: field(booleanRef, 'boolean'),
});
const noteDef = def(noteRef, {
  cardTitle: field(stringRef),
  topic: field(stringRef),
  score: field(numberRef, 'number'),
});

function makeDefinitionLookup(): DefinitionLookup {
  const lookup = {
    async lookupDefinition(codeRef: CodeRef) {
      if ('module' in codeRef && codeRef.module === productRef.module) {
        return productDef;
      }
      if ('module' in codeRef && codeRef.module === noteRef.module) {
        return noteDef;
      }
      throw new Error(
        `unexpected definition lookup: ${JSON.stringify(codeRef)}`,
      );
    },
    async lookupCachedDefinition() {
      return undefined;
    },
    forRealm() {
      return lookup;
    },
  } as unknown as DefinitionLookup;
  return lookup;
}

const PRODUCTS = 1500;
const NOTES = 1500;

const SEARCH_TABLES = [
  'boxel_index',
  'prerendered_html',
  'boxel_index_values',
  'boxel_index_value_cards',
  'boxel_index_value_types',
  'boxel_index_value_paths',
  'boxel_index_value_realms',
];

interface Measured {
  sql: string;
  buffers: number;
  ms: number;
  plan: PlanNode;
}
interface PlanNode {
  'Node Type': string;
  'Parent Relationship'?: string;
  'Shared Hit Blocks'?: number;
  'Shared Read Blocks'?: number;
  Plans?: PlanNode[];
}

module(basename(import.meta.filename), function (hooks) {
  let adapter: PgAdapter;
  let engine: IndexQueryEngine;
  let network: VirtualNetwork;

  async function seed() {
    let productKey = internalKeyFor(productRef, undefined, network);
    let noteKey = internalKeyFor(noteRef, undefined, network);
    let shop = await new IndexWriter(adapter).createBatch(
      new URL(A),
      network,
      undefined,
      { splitPrerenderHtml: false },
    );
    for (let i = 0; i < PRODUCTS; i++) {
      let url = `${A}Product/p${String(i).padStart(5, '0')}`;
      await shop.updateEntry(new URL(`${url}.json`), {
        type: 'instance',
        resource: {
          id: rri(url),
          type: 'card',
          attributes: {},
          meta: {
            adoptsFrom: { module: rri(productRef.module), name: 'Product' },
          },
        },
        lastModified: Date.now(),
        resourceCreatedAt: Date.now(),
        searchData: {
          cardTitle: `Product ${i}`,
          productType: `TYPE_${i % 40}`,
          brand: `Brand ${i % 120}`,
          material: ['oak', 'steel', 'glass', 'pine', 'cotton'][i % 5],
          color: ['red', 'blue', 'black', 'white', 'green', 'grey'][i % 6],
          ...(i % 11 === 10 ? {} : { rating: [3.5, 4, 4.5, 4.8, 5][i % 5] }),
          reviewCount: (i * 37) % 400,
          priceMin: (i * 53) % 900,
          inStock: i % 3 === 0,
        },
        deps: new Set(),
        displayNames: ['Product'],
        types: [productKey],
        isolatedHtml: `<div>${i}</div>`,
      });
    }
    await shop.done();
    let notes = await new IndexWriter(adapter).createBatch(
      new URL(B),
      network,
      undefined,
      { splitPrerenderHtml: false },
    );
    for (let i = 0; i < NOTES; i++) {
      let url = `${B}Note/n${String(i).padStart(5, '0')}`;
      await notes.updateEntry(new URL(`${url}.json`), {
        type: 'instance',
        resource: {
          id: rri(url),
          type: 'card',
          attributes: {},
          meta: { adoptsFrom: { module: rri(noteRef.module), name: 'Note' } },
        },
        lastModified: Date.now(),
        resourceCreatedAt: Date.now(),
        searchData: {
          cardTitle: `Note ${i}`,
          topic: `topic ${i % 30}`,
          score: i % 100,
        },
        deps: new Set(),
        displayNames: ['Note'],
        types: [noteKey],
        isolatedHtml: `<div>${i}</div>`,
      });
    }
    await notes.done();
  }

  // The tables vacuumed (their visibility maps set, as autovacuum's vacuum
  // after a bulk insert sets them), then analyzed.
  async function analyze() {
    for (let table of SEARCH_TABLES) {
      await adapter.execute(`VACUUM ${table}`);
      await adapter.execute(`ANALYZE ${table}`);
    }
  }

  // The planner's statistics for the realm's index and value rows withheld,
  // as on a database that never analyzed them: none gathered, row counts
  // unknown, and no autovacuum to gather them mid-test.
  async function withholdStatistics() {
    let list = SEARCH_TABLES.map((t) => `'${t}'`).join(', ');
    await adapter.execute(
      `DELETE FROM pg_statistic WHERE starelid IN (SELECT oid FROM pg_class WHERE relname IN (${list}))`,
    );
    await adapter.execute(
      `DELETE FROM pg_statistic_ext_data WHERE stxoid IN (SELECT oid FROM pg_statistic_ext WHERE stxrelid IN (SELECT oid FROM pg_class WHERE relname IN (${list})))`,
    );
    await adapter.execute(
      `UPDATE pg_class SET reltuples = -1 WHERE relname IN (${list}) OR oid IN (SELECT indexrelid FROM pg_index WHERE indrelid IN (SELECT oid FROM pg_class WHERE relname IN (${list})))`,
    );
  }

  hooks.beforeEach(async function () {
    prepareTestDB();
    adapter = await createTestPgAdapter();
    network = new VirtualNetwork();
    engine = new IndexQueryEngine(adapter, makeDefinitionLookup(), network);
    for (let table of SEARCH_TABLES) {
      await adapter.execute(
        `ALTER TABLE ${table} SET (autovacuum_enabled = false)`,
      );
    }
    await seed();
  });

  hooks.afterEach(async function () {
    await closeTestPgAdapter(adapter);
  });

  // Runs `search`, measuring every read statement it makes through EXPLAIN
  // (ANALYZE, BUFFERS) before running it.
  async function measured(search: () => Promise<unknown>) {
    let out: Measured[] = [];
    let execute = adapter.execute.bind(adapter);
    adapter.execute = (async (sql: string, opts?: any) => {
      if (/^\s*(SELECT|WITH)\b/i.test(sql)) {
        let [row] = (await execute(
          `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`,
          opts,
        )) as { 'QUERY PLAN': unknown }[];
        let raw = row['QUERY PLAN'];
        let [explained] = (typeof raw === 'string' ? JSON.parse(raw) : raw) as {
          Plan: PlanNode;
          'Execution Time': number;
        }[];
        out.push({
          sql,
          plan: explained.Plan,
          buffers:
            (explained.Plan['Shared Hit Blocks'] ?? 0) +
            (explained.Plan['Shared Read Blocks'] ?? 0),
          ms: explained['Execution Time'],
        });
      }
      return execute(sql, opts);
    }) as typeof adapter.execute;
    try {
      await search();
    } finally {
      adapter.execute = execute;
    }
    return out;
  }

  const searches: Record<string, Query> = {
    'the shop facets (counts only)': {
      type: productRef,
      page: { size: 0 },
      facets: [
        { by: 'productType', size: 1000 },
        { by: 'brand', size: 1000 },
        { by: 'material', size: 1000 },
        { by: 'color', size: 1000 },
      ],
    } as unknown as Query,
    'a range-filtered re-rank with facets (case 8)': {
      type: productRef,
      filter: {
        every: [
          { range: { rating: { gte: 4.5 } } },
          { range: { reviewCount: { gte: 100 } } },
        ],
      },
      sort: [
        {
          expression:
            'STANDARDIZE(rating, stats.rating.avg, stats.rating.stdev) * LOG10(reviewCount)',
          top: 200,
          compare: { by: 'productType', filter: { type: productRef } },
        },
        { expression: '(rating * reviewCount + 4 * 50) / (reviewCount + 50)' },
      ],
      facets: [
        { by: 'productType', size: 10 },
        {
          by: 'priceMin',
          own: 'ignore',
          stats: true,
          ranges: [
            { key: '0', from: 0, to: 100 },
            { key: '1', from: 100 },
          ],
        },
        { by: 'color', own: 'ignore', size: 200 },
        { by: 'inStock', own: 'ignore' },
      ],
      page: { size: 24 },
    } as unknown as Query,
    'a facet measure (count per brand with its average price)': {
      type: productRef,
      page: { size: 0 },
      facets: [{ by: 'brand', measure: { avg: 'priceMin' } }],
    } as unknown as Query,
    'a sorted list page': {
      type: productRef,
      sort: [{ by: 'priceMin', direction: 'asc' }],
      page: { size: 500 },
    } as unknown as Query,
    'a page of chosen cards': {
      type: productRef,
      filter: {
        in: {
          id: Array.from(
            { length: 30 },
            (_, i) => `${A}Product/p${String(i * 41).padStart(5, '0')}`,
          ),
        },
      },
      facets: [{ by: 'productType', size: 50 }],
      page: { size: 30 },
    } as unknown as Query,
  };

  const run = (q: Query) => () =>
    engine.search(new URL(A), q, {}, { kind: 'dataOnly' }, 'all');

  // A nested loop whose inner side is a scan of a CTE.
  function nestsOverCte(node: PlanNode): boolean {
    if (
      node['Node Type'] === 'Nested Loop' &&
      (node.Plans ?? []).some(
        (child) =>
          child['Parent Relationship'] === 'Inner' &&
          child['Node Type'] === 'CTE Scan',
      )
    ) {
      return true;
    }
    return (node.Plans ?? []).some(nestsOverCte);
  }

  test('the value tables analyze at 2% changed rows, as the search tables do', async function (assert) {
    let rows = (await adapter.execute(
      `SELECT relname, reloptions FROM pg_class WHERE relname IN ('boxel_index_values', 'boxel_index_value_cards', 'boxel_index_value_types', 'boxel_index_value_paths', 'boxel_index_value_realms') ORDER BY relname`,
    )) as { relname: string; reloptions: string[] }[];
    assert.strictEqual(rows.length, 5);
    for (let row of rows) {
      let options = row.reloptions ?? [];
      assert.true(
        options.includes('autovacuum_analyze_scale_factor=0.02'),
        `${row.relname} analyzes at 2%: ${JSON.stringify(options)}`,
      );
      assert.true(
        options.includes('autovacuum_vacuum_scale_factor=0.05'),
        `${row.relname} vacuums at 5%`,
      );
    }
  });

  for (let [name, q] of Object.entries(searches)) {
    test(`no-statistics gate: ${name}`, async function (assert) {
      await analyze();
      let warm = await measured(run(q)); // caches warm, plans with statistics
      let analyzed = await measured(run(q));
      await withholdStatistics();
      await measured(run(q));
      let withheld = await measured(run(q));
      assert.strictEqual(
        withheld.length,
        analyzed.length,
        'the same statements run either way',
      );
      assert.ok(warm.length > 0);
      withheld.forEach((w, i) => {
        let a = analyzed[i];
        let budget = 10 * a.buffers + 1000;
        console.log(
          `[no-statistics gate] ${name} #${i}: ${a.buffers} buffers (${a.ms.toFixed(1)} ms) analyzed, ${w.buffers} (${w.ms.toFixed(1)} ms) withheld, budget ${budget} :: ${w.sql.replace(/\s+/g, ' ').slice(0, 90)}`,
        );
        assert.true(
          w.buffers <= budget,
          `#${i}: ${w.buffers} buffers without statistics, budget ${budget} (${a.buffers} with): ${w.sql.replace(/\s+/g, ' ').slice(0, 120)}`,
        );
        if (
          /boxel_index_value_cards AS c WHERE c\.id IN \(SELECT card_id FROM k\)/.test(
            w.sql,
          )
        ) {
          assert.false(
            nestsOverCte(w.plan),
            `#${i}: the comparison set nests no loop over a CTE scan`,
          );
          assert.false(nestsOverCte(a.plan), `#${i}: nor with statistics`);
        }
      });
    });
  }
});
