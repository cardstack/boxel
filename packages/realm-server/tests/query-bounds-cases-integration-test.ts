import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import type { PgAdapter } from '@cardstack/postgres';
import {
  hasWarning,
  IndexQueryEngine,
  IndexWriter,
  VirtualNetwork,
  applySearchPageBound,
  applyServerSearchPageBound,
  assertQuery,
  backfillFacetValues,
  facetFieldSpecsOf,
  internalKeyFor,
  SEARCH_TEXT_KEY,
  normalizeQueryDefinition,
  param,
  parseSearchEntryQueryFromPayload,
  query,
  resetSearchBoundsForTests,
  rri,
  runWithSearchTimeBudget,
  setSearchBoundsForTests,
  type Definition,
  type DefinitionLookup,
  type FieldDefinition,
  type Query,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';
import { lowerQuery } from '@cardstack/runtime-common/query-syntax';

import {
  closeTestPgAdapter,
  createTestPgAdapter,
  prepareTestDB,
  setupDB,
} from './helpers/index.ts';

// The limits every search runs under, each checked against an answer worked
// out here: what a search returns at a limit and one past it, whether the
// response says an answer was cut, what a search sees while the index is
// being rewritten, and whether a cancelled search really stops.
//
// The numbers a limit is checked against come from docs/search.md
// ("Pagination" and "Bounds every query runs under"), not from the engine:
// a total counts to 1,000 in the newer spelling unless asked to be exact
// (the older spelling counts exactly, as it always did), a broad short title
// substring matches at most the candidate cap of the realm's cards, a blend
// takes 8 signals, a query 4 bindings, a binding 10,000 rows and 10,000 values,
// a window (an expression sort entry with top) 500 rows, a collapse 10 of a group, a facet 50 values unless it
// names a size, a request 500 rows unless it names a size and 2,000 at most.

function ref(module: string, name: string): ResolvedCodeRef {
  return { module: module as ResolvedCodeRef['module'], name };
}

const realm = 'http://query-bounds-test/';
const stringRef = ref('@cardstack/base/string', 'default');
const numberRef = ref('@cardstack/base/number', 'default');
const cardDefRef = ref('@cardstack/base/card-api', 'CardDef');
const Note = ref(`${realm}note`, 'Note');
const Other = ref(`${realm}other`, 'Other');

// Every field here is a facet: these cases test the bounds a search runs
// under, not which fields declare one.
const text = {
  type: 'contains',
  isPrimitive: true,
  isComputed: false,
  fieldOrCard: stringRef,
  search: { facet: true },
};
const noteDef = {
  type: 'card-def',
  codeRef: Note,
  displayName: 'Note',
  fields: {
    label: 'f0',
    bucket: 'f0',
    cardTitle: 'f0',
    level: 'f1',
    codes: 'f2',
    marks: 'f2',
  },
  fieldDefs: {
    f0: text,
    f1: { ...text, fieldOrCard: numberRef, serializerName: 'number' },
    f2: { ...text, type: 'containsMany' },
  },
} as unknown as Definition;
const otherDef = {
  type: 'card-def',
  codeRef: Other,
  displayName: 'Other',
  fields: { label: 'f0' },
  fieldDefs: { f0: text },
} as unknown as Definition;
const cardDef = {
  type: 'card-def',
  codeRef: cardDefRef,
  displayName: 'Card',
  fields: {},
  fieldDefs: {},
} as unknown as Definition;

function makeDefinitionLookup(): DefinitionLookup {
  let definitions = [noteDef, otherDef, cardDef];
  const lookup: DefinitionLookup = {
    async lookupDefinition(codeRef: ResolvedCodeRef): Promise<Definition> {
      let found = definitions.find(
        (d) =>
          (d.codeRef as ResolvedCodeRef).module === codeRef.module &&
          (d.codeRef as ResolvedCodeRef).name === codeRef.name,
      );
      if (!found) {
        throw new Error(
          `unexpected definition lookup: ${codeRef.module}/${codeRef.name}`,
        );
      }
      return found;
    },
    async lookupDefinitionEntry(): Promise<never> {
      throw new Error('lookupDefinitionEntry is not used by these tests');
    },
    async lookupCachedDefinition() {
      return undefined;
    },
    async invalidate() {
      return [];
    },
    async clearRealmDefinitions() {},
    async clearAllDefinitions() {},
    registerRealm() {},
    async getCachedDefinitions() {
      return undefined;
    },
    async populateDefinitionCacheEntry() {
      return undefined;
    },
    async getCachedDefinitionsBatch() {
      return {};
    },
    forRealm() {
      return lookup;
    },
  };
  return lookup;
}

// --- the fixture -------------------------------------------------------------

// 2,105 Notes with levels 0 to 2,104: enough to pass the 1,000-match count and
// the 2,000-row page. Each is in one of three
// buckets (its level modulo 3), and holds one mark and two codes of its own.
const BULK = 2105;
const bulkUrl = (level: number) =>
  `${realm}Note/b${String(level).padStart(4, '0')}`;
const levelsBelow = (n: number) => Array.from({ length: n }, (_, i) => i);

// A realm of its own for a binding's limits, 10,000 rows and 10,000 values:
// 10,005 Notes with levels 0 to 10,004, each holding one mark and two codes
// of its own, apart from the realm the other bounds count.
const letRealm = 'http://query-bounds-let-test/';
const LET_BULK = 10_005;
const letUrl = (level: number) =>
  `${letRealm}Note/l${String(level).padStart(5, '0')}`;
const letLevelOf = (url: string) =>
  Number(url.slice(`${letRealm}Note/l`.length));

// A handful of rows with titles, for the short-substring cap. Each needle is
// two letters that no other title holds.
interface Small {
  url: string;
  kind: 'note' | 'other' | 'file';
  title: string;
  level: number;
}
function titled(
  kind: Small['kind'],
  needle: string,
  count: number,
  from: number,
): Small[] {
  return Array.from({ length: count }, (_, i) => ({
    url: `${realm}${kind}/${needle}-${i}`,
    kind,
    title: `${needle} ${kind} ${i}`,
    level: from + i,
  }));
}
// Rows are inserted in this order: the files and the Other cards that hold a
// needle come before the Notes that hold it.
const SMALL: Small[] = [
  ...titled('file', 'xj', 8, 9000),
  ...titled('other', 'kv', 8, 9100),
  ...titled('note', 'zq', 8, 5000),
  ...titled('note', 'wy', 5, 5100),
  ...titled('note', 'qx', 6, 5200),
  ...titled('note', 'xj', 3, 5300),
  ...titled('note', 'kv', 3, 5400),
  // no needle at all
  ...Array.from({ length: 4 }, (_, i) => ({
    url: `${realm}note/plain-${i}`,
    kind: 'note' as const,
    title: `plain ${i}`,
    level: 5500 + i,
  })),
];
const notesHolding = (needle: string) =>
  SMALL.filter((r) => r.kind === 'note' && r.title.includes(needle))
    .sort((a, b) => a.level - b.level)
    .map((r) => r.url);
const smallNotes = SMALL.filter((r) => r.kind === 'note');

async function seedFixture(dbAdapter: PgAdapter, vn: VirtualNetwork) {
  let noteKey = JSON.stringify([internalKeyFor(Note, undefined, vn)]);
  let otherKey = JSON.stringify([internalKeyFor(Other, undefined, vn)]);
  await query(dbAdapter, [
    `INSERT INTO boxel_index (url, file_alias, realm_url, generation, type, pristine_doc, search_doc, deps, types, is_deleted, has_error, indexed_at, last_modified)
     SELECT u.url, u.url,`,
    param(realm),
    `, 1, 'instance', jsonb_build_object('id', u.url, 'type', 'card'),
       jsonb_build_object('level', n, 'bucket', 'g' || (n % 3), 'label', 'bulk', 'marks', jsonb_build_array('m' || n), 'codes', jsonb_build_array('c' || (2 * n), 'c' || (2 * n + 1))),
       '[]'::jsonb,`,
    param(noteKey),
    `::jsonb, FALSE, FALSE, 1000, 1000
     FROM generate_series(0,`,
    param(BULK - 1),
    `) AS n, LATERAL (SELECT`,
    param(`${realm}Note/b`),
    `|| lpad(n::text, 4, '0') AS url) AS u`,
  ]);
  await query(dbAdapter, [
    `INSERT INTO boxel_index (url, file_alias, realm_url, generation, type, pristine_doc, search_doc, deps, types, is_deleted, has_error, indexed_at, last_modified)
     SELECT u.url, u.url,`,
    param(letRealm),
    `, 1, 'instance', jsonb_build_object('id', u.url, 'type', 'card'),
       jsonb_build_object('level', n, 'marks', jsonb_build_array('m' || n), 'codes', jsonb_build_array('c' || (2 * n), 'c' || (2 * n + 1))),
       '[]'::jsonb,`,
    param(noteKey),
    `::jsonb, FALSE, FALSE, 1000, 1000
     FROM generate_series(0,`,
    param(LET_BULK - 1),
    `) AS n, LATERAL (SELECT`,
    param(`${letRealm}Note/l`),
    `|| lpad(n::text, 5, '0') AS url) AS u`,
  ]);
  for (let row of SMALL) {
    let doc =
      row.kind === 'file'
        ? { _title: row.title }
        : {
            _title: row.title,
            cardTitle: row.title,
            label: row.title,
            bucket: 'small',
            level: row.level,
            codes: [],
          };
    await query(dbAdapter, [
      `INSERT INTO boxel_index (url, file_alias, realm_url, generation, type, pristine_doc, search_doc, deps, types, is_deleted, has_error, indexed_at, last_modified) VALUES (`,
      param(row.url),
      `,`,
      param(row.url),
      `,`,
      param(realm),
      `, 1,`,
      param(row.kind === 'file' ? 'file' : 'instance'),
      `,`,
      param(JSON.stringify({ id: row.url, type: 'card' })),
      `::jsonb,`,
      param(JSON.stringify(doc)),
      `::jsonb, '[]'::jsonb,`,
      param(
        row.kind === 'note' ? noteKey : row.kind === 'other' ? otherKey : '[]',
      ),
      `::jsonb, FALSE, FALSE, 1000, 1000)`,
    ]);
  }
  // The rows went straight into boxel_index: their facet rows are written
  // from their search docs, as a declaration change does.
  let noLookup = async () => undefined;
  for (let r of [realm, letRealm]) {
    await backfillFacetValues(
      dbAdapter,
      r,
      internalKeyFor(Note, undefined, vn),
      await facetFieldSpecsOf(noteDef, noLookup),
    );
    await backfillFacetValues(
      dbAdapter,
      r,
      internalKeyFor(Other, undefined, vn),
      await facetFieldSpecsOf(otherDef, noLookup),
    );
  }
}

type Meta = Record<string, any>;

// A total a caller can trust: exact when it carries no flag, and never more
// than the true count when it is flagged as a lower bound.
function assertHonestTotal(
  assert: Assert,
  meta: Meta,
  trueCount: number,
  label: string,
) {
  if (hasWarning(meta, 'total-estimated')) {
    assert.true(
      meta.page.total <= trueCount,
      `${label}: a flagged total (${meta.page.total}) is a lower bound of ${trueCount}`,
    );
  } else {
    assert.strictEqual(
      meta.page.total,
      trueCount,
      `${label}: a total with no flag is the count`,
    );
  }
}

function codeOf(run: () => unknown): string {
  try {
    run();
    return 'accepted';
  } catch (e: any) {
    return `refused: ${e?.queryCode ?? e?.code ?? e?.message}`;
  }
}

module(basename(import.meta.filename), function () {
  module('the bounds a search runs under', function (hooks) {
    let engine: IndexQueryEngine;
    let adapter: PgAdapter;

    setupDB(hooks, {
      before: async (dbAdapter) => {
        adapter = dbAdapter;
        let vn = new VirtualNetwork();
        engine = new IndexQueryEngine(dbAdapter, makeDefinitionLookup(), vn);
        await seedFixture(dbAdapter, vn);
      },
    });

    async function search(
      q: Record<string, any>,
      opts: object = {},
      inRealm = realm,
    ) {
      let { cards, meta } = await engine.searchCards(
        new URL(inRealm),
        q as Query,
        opts,
      );
      return { urls: cards.map((c) => String(c.id)), meta: meta as Meta };
    }
    const lowered = (q: Record<string, any>) => lowerQuery(q).query;
    const byLevel = [{ by: 'level', on: Note }];
    const levelBelow = (n: number) => ({
      on: Note,
      range: { level: { lt: n } },
    });

    // Every page of a query, laid end to end.
    async function everyPage(q: Record<string, any>, size: number) {
      let urls: string[] = [];
      let metas: Meta[] = [];
      for (let number = 0; number < 50; number++) {
        let page = await search({ ...q, page: { ...q.page, size, number } });
        urls.push(...page.urls);
        metas.push(page.meta);
        if (!page.meta.page.hasMore) {
          break;
        }
      }
      return { urls, metas };
    }

    // ---- 1. the short title substring cap -------------------------------------

    module('a one- or two-letter title substring', function (hooks) {
      hooks.beforeEach(function () {
        setSearchBoundsForTests({ matchCandidateCap: 5 });
      });
      hooks.afterEach(function () {
        resetSearchBoundsForTests();
      });

      const holding = (needle: string) => ({ contains: { _title: needle } });
      const zq = notesHolding('zq');

      test('with no page, every card holding it is returned', async function (assert) {
        let { urls, meta } = await search({
          filter: holding('zq'),
          sort: byLevel,
        });
        assert.deepEqual(urls, zq, 'all 8, in order');
        assert.strictEqual(meta.page.total, 8);
        assert.notOk(hasWarning(meta, 'total-estimated'), 'no flag');
      });

      for (let [spelling, page] of [
        ["total: 'exact'", { total: 'exact' }],
        ['exactTotal: true', { exactTotal: true }],
      ] as const) {
        test(`with ${spelling}, every card holding it is returned and counted, past the cap`, async function (assert) {
          let { urls, metas } = await everyPage(
            { filter: holding('zq'), sort: byLevel, page },
            3,
          );
          assert.deepEqual(urls, zq, 'the pages hold all 8, in order');
          for (let meta of metas) {
            assert.strictEqual(meta.page.total, 8, 'every page counts 8');
            assert.notOk(hasWarning(meta, 'total-estimated'), 'no flag');
          }
        });
      }

      test("a paged search past the cap returns the cap's worth, in the query's order, and flags its total", async function (assert) {
        // 8 cards hold "zq" and the cap is 5: the documented answer is at
        // most 5 of them, with the total a flagged lower bound.
        let first = await search({
          filter: holding('zq'),
          sort: byLevel,
          page: { size: 3 },
        });
        assert.true(
          hasWarning(first.meta, 'total-estimated'),
          'the total is flagged',
        );
        assert.strictEqual(first.meta.page.total, 5, 'the candidates counted');
        assert.true(first.meta.page.hasMore, '3 of 5: another page follows');
        let { urls, metas } = await everyPage(
          { filter: holding('zq'), sort: byLevel },
          3,
        );
        assert.strictEqual(urls.length, 5, 'the pages hold 5 rows');
        assert.strictEqual(new Set(urls).size, 5, 'each once');
        assert.true(
          urls.every((u) => zq.includes(u)),
          'each of them holds the substring',
        );
        assert.deepEqual(
          urls,
          [...urls].sort((a, b) => zq.indexOf(a) - zq.indexOf(b)),
          "in the query's own order",
        );
        assert.true(
          metas.every((m) => hasWarning(m, 'total-estimated')),
          'every page is flagged',
        );
        assert.false(metas[metas.length - 1].page.hasMore, 'the last page');
      });

      test('exactly as many cards as the cap: nothing is cut and nothing is flagged', async function (assert) {
        let { urls, meta } = await search({
          filter: holding('wy'),
          sort: byLevel,
          page: { size: 10 },
        });
        assert.deepEqual(urls, notesHolding('wy'), 'all 5');
        assert.strictEqual(meta.page.total, 5);
        assert.notOk(hasWarning(meta, 'total-estimated'), 'no flag');
        assert.false(meta.page.hasMore);
      });

      test('one card more than the cap: the answer is cut to the cap and flagged', async function (assert) {
        let { urls, meta } = await search({
          filter: holding('qx'),
          sort: byLevel,
          page: { size: 10 },
        });
        assert.strictEqual(urls.length, 5, 'the cap, not all 6');
        assert.true(urls.every((u) => notesHolding('qx').includes(u)));
        assert.strictEqual(meta.page.total, 5);
        assert.true(hasWarning(meta, 'total-estimated'), 'flagged');
      });

      test('the cap applies to the newer spelling too (a top-level type)', async function (assert) {
        let { urls, meta } = await search(
          lowered({
            type: Note,
            filter: holding('zq'),
            sort: [{ by: 'level' }],
            page: { size: 10 },
          }),
        );
        assert.strictEqual(urls.length, 5, 'the cap, not all 8');
        assert.true(urls.every((u) => zq.includes(u)));
        assert.true(hasWarning(meta, 'total-estimated'), 'flagged');
      });

      test('under `not`, the substring is never capped', async function (assert) {
        // The small Notes that do not hold "zq": every one of them, however
        // many hold it.
        let expected = smallNotes
          .filter((r) => !r.title.includes('zq'))
          .sort((a, b) => a.level - b.level)
          .map((r) => r.url);
        let { urls, meta } = await search({
          filter: {
            every: [
              { on: Note, eq: { bucket: 'small' } },
              { not: holding('zq') },
            ],
          },
          sort: byLevel,
          page: { size: 50 },
        });
        assert.deepEqual(urls, expected);
        assert.strictEqual(meta.page.total, expected.length);
        assert.notOk(hasWarning(meta, 'total-estimated'), 'no flag');
      });

      test('a cut answer is never passed off as whole, whichever spelling asks', async function (assert) {
        // pins current behavior; rule not yet decided: the docs give the cap
        // for "a contains on _title or cardTitle", and a saved query writes
        // it with an `on` anchor on cardTitle. Whether that spelling is cut
        // is left open here; what must hold is that a total with no flag is
        // the whole answer.
        let { urls, meta } = await search({
          filter: { on: Note, contains: { cardTitle: 'zq' } },
          sort: byLevel,
          page: { size: 10 },
        });
        assertHonestTotal(assert, meta, 8, 'anchored cardTitle');
        assert.true(urls.every((u) => zq.includes(u)));
        if (!hasWarning(meta, 'total-estimated')) {
          assert.deepEqual(urls, zq, 'unflagged, so all 8');
        }
      });

      test('files holding the substring do not use up the cap of a card search', async function (assert) {
        // The docs bound the substring by how many of the realm's CARDS hold
        // it. Three cards hold "xj" (under the cap of 5); eight files do too.
        let { urls, meta } = await search({
          filter: holding('xj'),
          sort: byLevel,
          page: { size: 10 },
        });
        assert.deepEqual(urls, notesHolding('xj'), 'the 3 cards');
        assert.strictEqual(meta.page.total, 3);
        assert.notOk(
          hasWarning(meta, 'total-estimated'),
          'no flag: nothing was cut',
        );
      });

      test('cards of another type holding the substring: a cut answer is flagged, never silent', async function (assert) {
        // pins current behavior; rule not yet decided: 3 Notes and 8 Other
        // cards hold "kv". The docs count the realm's cards, so the query is
        // past the cap although its own type has 3 matches. Whatever rows
        // come back, an incomplete answer must carry the flag.
        let expected = notesHolding('kv');
        let { urls, meta } = await search(
          lowered({
            type: Note,
            filter: holding('kv'),
            sort: [{ by: 'level' }],
            page: { size: 10 },
          }),
        );
        assert.true(urls.every((u) => expected.includes(u)));
        assertHonestTotal(assert, meta, 3, 'typed query');
        if (urls.length < expected.length) {
          assert.true(
            hasWarning(meta, 'total-estimated'),
            `${urls.length} of 3 rows came back, so the answer is flagged`,
          );
        }
      });

      test('which callers are cut: a request and a card search are, a query-backed field is not', async function (assert) {
        let filter = holding('zq');
        // A _search request and a card's search both get a page with no
        // total mode from their page bound, so both run under the cap.
        for (let [caller, bounded] of [
          ['a server request', applyServerSearchPageBound({ filter } as Query)],
          ['a card search', applySearchPageBound({ filter } as Query)],
        ] as const) {
          let { urls, meta } = await search(bounded);
          assert.strictEqual(urls.length, 5, `${caller}: cut to the cap`);
          assert.true(
            hasWarning(meta, 'total-estimated'),
            `${caller}: flagged`,
          );
        }
        // A query-backed field counts exactly unless it says otherwise.
        let field = normalizeQueryDefinition({
          fieldDefinition: {
            type: 'linksToMany',
            isPrimitive: false,
            isComputed: false,
            fieldOrCard: Note,
          } as unknown as FieldDefinition,
          queryDefinition: { filter } as any,
          realmURL: new URL(realm),
          fieldName: 'related',
          resolvePathValue: () => undefined,
          relativeTo: new URL(realm),
        });
        let { urls, meta } = await search(field!.query);
        assert.deepEqual([...urls].sort(), [...zq].sort(), 'a field: all 8');
        assert.strictEqual(meta.page.total, 8);
        assert.notOk(hasWarning(meta, 'total-estimated'), 'a field: no flag');
      });
    });

    // ---- 2. how far a total is counted ----------------------------------------

    module('page.total', function () {
      const first10 = levelsBelow(10).map(bulkUrl);
      const page10 = (filter: object, page: object = {}) => ({
        filter,
        sort: byLevel,
        page: { size: 10, ...page },
      });

      // The newer spelling's page counts to the cap unless it says
      // otherwise: its lowering names `capped`.
      const newer10 = (n: number, page: object = {}) =>
        lowered({
          type: Note,
          filter: { range: { level: { lt: n } } },
          sort: [{ by: 'level' }],
          page: { size: 10, ...page },
        });

      test("capped (the newer spelling's default) past 1,000 matches: the total is 1,000 and flagged, the rows and hasMore exact", async function (assert) {
        for (let q of [
          page10(levelBelow(1001), { total: 'capped' }),
          newer10(1001),
        ]) {
          let { urls, meta } = await search(q);
          assert.deepEqual(urls, first10, 'the first 10 by level');
          assert.strictEqual(meta.page.total, 1000, 'counted to the cap');
          assert.true(
            hasWarning(meta, 'total-estimated'),
            'flagged a lower bound',
          );
          assert.true(meta.page.hasMore);
        }
      });

      test('the older spelling counts exactly when it names no mode, as it always did', async function (assert) {
        let { urls, meta } = await search(page10(levelBelow(2000)));
        assert.deepEqual(urls, first10);
        assert.strictEqual(meta.page.total, 2000, 'the true count');
        assert.notOk(hasWarning(meta, 'total-estimated'), 'no flag');
        assert.true(meta.page.hasMore);
      });

      test('a counts-only page (size 0) naming no mode counts exactly, in either spelling', async function (assert) {
        for (let q of [
          { filter: levelBelow(2000), page: { size: 0 } },
          lowered({
            type: Note,
            filter: { range: { level: { lt: 2000 } } },
            page: { size: 0 },
          }),
        ]) {
          let { urls, meta } = await search(q);
          assert.deepEqual(urls, [], 'no rows');
          assert.strictEqual(meta.page.total, 2000, 'the true count');
          assert.notOk(hasWarning(meta, 'total-estimated'), 'no flag');
        }
      });

      test('a mode a query names wins in either spelling', async function (assert) {
        let { meta } = await search(newer10(1001, { total: 'exact' }));
        assert.strictEqual(meta.page.total, 1001, 'newer, exact');
        assert.notOk(hasWarning(meta, 'total-estimated'));
        ({ meta } = await search(
          page10(levelBelow(1001), { total: 'capped' }),
        ));
        assert.strictEqual(meta.page.total, 1000, 'older, capped');
        assert.true(hasWarning(meta, 'total-estimated'));
      });

      test('exact past 1,000 matches: the true count, with no flag', async function (assert) {
        let { urls, meta } = await search(
          page10(levelBelow(1001), { total: 'exact' }),
        );
        assert.deepEqual(urls, first10);
        assert.strictEqual(meta.page.total, 1001);
        assert.notOk(hasWarning(meta, 'total-estimated'));
        assert.true(meta.page.hasMore);
      });

      test('none: nothing is counted, the total is a flagged floor, the rows and hasMore exact', async function (assert) {
        let { urls, meta } = await search(
          page10(levelBelow(1001), { total: 'none' }),
        );
        assert.deepEqual(urls, first10);
        assert.true(meta.page.hasMore);
        assert.true(hasWarning(meta, 'total-estimated'), 'flagged');
        // "the rows seen so far": at least the page, and no count of the rest
        assert.true(meta.page.total >= 10, `at least the page`);
        assert.true(
          meta.page.total < 1001,
          `a floor, not a count (${meta.page.total})`,
        );
      });

      for (let [matches, total, flagged] of [
        [999, 999, false],
        [1000, 1000, false],
        [1001, 1000, true],
      ] as const) {
        test(`capped over ${matches} matches: total ${total}, ${flagged ? 'flagged' : 'not flagged'}`, async function (assert) {
          let { urls, meta } = await search(
            page10(levelBelow(matches), { total: 'capped' }),
          );
          assert.deepEqual(urls, first10);
          assert.strictEqual(meta.page.total, total);
          assert.strictEqual(hasWarning(meta, 'total-estimated'), flagged);
          assert.true(meta.page.hasMore);
        });
      }

      test('a page with no next page counts exactly, whatever the mode', async function (assert) {
        // 1,001 matches, pages of 10: page 100 holds the last one.
        for (let total of ['capped', 'none', 'exact']) {
          let { urls, meta } = await search(
            page10(levelBelow(1001), { number: 100, total }),
          );
          assert.deepEqual(urls, [bulkUrl(1000)], `${total}: the last row`);
          assert.strictEqual(meta.page.total, 1001, `${total}: exact`);
          assert.notOk(
            hasWarning(meta, 'total-estimated'),
            `${total}: no flag`,
          );
          assert.false(meta.page.hasMore, `${total}: no next page`);
        }
      });

      test('a capped page deep past the cap: exact rows, a flagged total no smaller than the rows passed', async function (assert) {
        // 2,000 matches; page 150 of 10 is levels 1,500 to 1,509.
        let { urls, meta } = await search(
          page10(levelBelow(2000), { number: 150, total: 'capped' }),
        );
        assert.deepEqual(
          urls,
          levelsBelow(10).map((i) => bulkUrl(1500 + i)),
        );
        assert.true(meta.page.hasMore);
        assert.true(hasWarning(meta, 'total-estimated'), 'flagged');
        assert.true(meta.page.total >= 1510, 'no smaller than the rows passed');
        assert.true(
          meta.page.total <= 2000,
          `no larger than the count (${meta.page.total})`,
        );
      });

      test('with a facet, every mode still reports an honest total and counts the facet over every match', async function (assert) {
        // 1,001 matches: levels 0 to 1,000, so bucket g0 holds 334 of them
        // (0, 3, ..., 999) and g1 and g2 hold 334 and 333.
        let counts = { g0: 0, g1: 0, g2: 0 } as Record<string, number>;
        for (let level of levelsBelow(1001)) {
          counts[`g${level % 3}`]++;
        }
        for (let total of ['capped', 'none', 'exact']) {
          let { urls, meta } = await search({
            ...page10(levelBelow(1001), { total }),
            facets: [{ by: 'bucket' }],
          });
          assert.deepEqual(urls, first10, `${total}: rows`);
          assert.true(meta.page.hasMore, `${total}: hasMore`);
          assertHonestTotal(assert, meta, 1001, total);
          assert.deepEqual(
            Object.fromEntries(
              meta.facets.bucket.map((f: any) => [f.value, f.count]),
            ),
            counts,
            `${total}: facet counts are not capped`,
          );
        }
      });

      // A filter the search doc's GIN index serves (an `eq` or a text `in`)
      // reads its page filter-first: the matches through the index, counted
      // up to the cap, the page taken from them; past the cap, off the order.
      // Whichever way it runs, its answers are the range filter's above,
      // which never takes that read: the same rows, total, flag and hasMore.
      test('a filter the GIN index serves answers as the walk does: rows, totals, flags and hasMore, at the cap and past it', async function (assert) {
        const served = [
          (n: number) => ({
            on: Note,
            every: [{ eq: { label: 'bulk' } }, { range: { level: { lt: n } } }],
          }),
          (n: number) => ({
            on: Note,
            every: [
              { in: { label: ['bulk', 'none such'] } },
              { range: { level: { lt: n } } },
            ],
          }),
        ];
        const answer = async (q: Record<string, any>) => {
          let { urls, meta } = await search(q);
          return {
            urls,
            total: meta.page.total,
            flagged: hasWarning(meta, 'total-estimated'),
            hasMore: meta.page.hasMore,
          };
        };
        for (let matches of [5, 999, 1000, 1001, 2000]) {
          for (let total of ['capped', 'none', 'exact', undefined]) {
            for (let number of [0, 99, 100, 150, 300]) {
              for (let sort of [byLevel, undefined]) {
                let page = {
                  number,
                  ...(total ? { total } : {}),
                };
                let shape = (filter: object) => ({
                  filter,
                  ...(sort ? { sort } : {}),
                  page: { size: 10, ...page },
                });
                let expected = await answer(shape(levelBelow(matches)));
                for (let [i, filter] of served.entries()) {
                  assert.deepEqual(
                    await answer(shape(filter(matches))),
                    expected,
                    `form ${i}, ${matches} matches, ${total ?? 'no mode'}, page ${number}, ${sort ? 'by level' : 'url order'}`,
                  );
                }
              }
            }
          }
        }
      });
    });

    // ---- 3. every documented limit ----------------------------------------------

    module('a limit: at it accepted, one past it refused', function () {
      const many = <T>(n: number, of: (i: number) => T) =>
        Array.from({ length: n }, (_, i) => of(i));
      const bindings = (n: number) => ({
        type: Note,
        let: Object.fromEntries(
          many(n, (i) => [`$b${i}`, { from: { type: Note }, select: 'level' }]),
        ),
        filter: { in: { level: '$b0' } },
      });
      // The docs' Refusals table: more of something than a query may have is
      // `limit-exceeded`; a number out of its range is `invalid-value`.
      // prettier-ignore
      const LIMITS: [string, number, (n: number) => Record<string, any>, string][] = [
        ['signals in a blend', 8, (n) => ({ type: Note, sort: [{ blend: many(n, () => ({ by: 'level' })) }] }), 'limit-exceeded'],
        ['let bindings', 4, bindings, 'limit-exceeded'],
        ['rows a binding asks for', 10_000, (n) => ({ type: Note, let: { $b: { from: { type: Note, page: { size: n } }, select: 'level' } }, filter: { in: { level: '$b' } } }), 'invalid-value'],
        ['rows a window takes', 500, (n) => ({ type: Note, sort: [{ expression: 'level', top: n }, { by: 'level' }] }), 'invalid-value'],
        ['cards a collapse keeps of a group', 10, (n) => ({ type: Note, collapse: { by: 'bucket', keep: n } }), 'invalid-value'],
        ['buckets in a facet\'s ranges', 50, (n) => ({ type: Note, facets: [{ by: 'level', ranges: many(n, (i) => ({ from: i, to: i + 1 })) }] }), 'limit-exceeded'],
        ['components of a near target', 2000, (n) => ({ type: Note, sort: [{ by: 'embedding', near: many(n, () => 0.5) }] }), 'limit-exceeded'],
        ['look-alikes a window compares with', 100, (n) => ({ type: Note, sort: [{ expression: 'level', compare: { near: 'embedding', k: n } }] }), 'invalid-value'],
        ['fields a matches term names', 8, (n) => ({ type: Note, filter: { matches: 'bulk', fields: many(n, (i) => `f${i}`) } }), 'limit-exceeded'],
      ];
      for (let [what, limit, make, code] of LIMITS) {
        test(`${what}: ${limit} accepted, ${limit + 1} refused (${code})`, function (assert) {
          assert.strictEqual(
            codeOf(() => assertQuery(make(limit))),
            'accepted',
            `${limit}`,
          );
          assert.strictEqual(
            codeOf(() => assertQuery(make(limit + 1))),
            `refused: ${code}`,
            `${limit + 1}`,
          );
        });
      }

      test('columns in a select: 64 accepted, 65 refused (limit-exceeded)', function (assert) {
        let request = (n: number) => ({
          type: Note,
          select: many(n, (i) => ({ [`c${i}`]: 'level' })),
        });
        assert.strictEqual(
          codeOf(() => parseSearchEntryQueryFromPayload(request(64))),
          'accepted',
        );
        assert.strictEqual(
          codeOf(() => parseSearchEntryQueryFromPayload(request(65))),
          'refused: limit-exceeded',
        );
      });
    });

    module('a limit: what the answer is at it', function () {
      test('a blend of 8 signals ranks the matches', async function (assert) {
        // Eight copies of one signal: highest level first.
        let { urls } = await search(
          lowered({
            type: Note,
            filter: { range: { level: { lt: 20 } } },
            sort: [
              { blend: Array.from({ length: 8 }, () => ({ by: 'level' })) },
            ],
            page: { size: 20 },
          }),
        );
        assert.deepEqual(urls, levelsBelow(20).reverse().map(bulkUrl));
      });

      test('a collapse keeping 10 of each group returns the first 10 of each', async function (assert) {
        // Levels 0 to 59 in three buckets of 20: the first 10 of each bucket
        // by level are the levels 0 to 29.
        let { urls, meta } = await search(
          lowered({
            type: Note,
            filter: { range: { level: { lt: 60 } } },
            sort: [{ by: 'level' }],
            collapse: { by: 'bucket', keep: 10 },
            page: { size: 100 },
          }),
        );
        assert.deepEqual(urls, levelsBelow(30).map(bulkUrl));
        assert.strictEqual(
          meta.page.total,
          30,
          'the total counts what remains',
        );
      });

      test('a window of 500 over more matches re-orders the first 500 and says the rest kept their order', async function (assert) {
        // The query orders by level, lowest first; the window orders its
        // window (levels 0 to 499) highest first; levels 500 to 599 follow in
        // the query's order.
        let { urls, meta } = await search(
          lowered({
            type: Note,
            filter: { range: { level: { lt: 2000 } } },
            sort: [{ expression: 'level', top: 500 }, { by: 'level' }],
            page: { size: 600 },
          }),
        );
        assert.deepEqual(urls, [
          ...levelsBelow(500).reverse().map(bulkUrl),
          ...levelsBelow(100).map((i) => bulkUrl(500 + i)),
        ]);
        assert.true(
          Boolean(meta.window?.truncated),
          'meta.window.truncated says the query matched more than the window',
        );
      });

      // A binding's limits, over a realm of 10,005 Notes: 10,000 rows a
      // binding reads and 10,000 values its list holds.
      const viaBinding = async (n: number, select: 'marks' | 'codes') =>
        await search(
          lowered({
            type: Note,
            let: {
              $picked: {
                from: {
                  type: Note,
                  filter: { range: { level: { lt: n } } },
                  sort: [{ by: 'level' }],
                },
                select,
              },
            },
            filter: { in: { [select]: '$picked' } },
            sort: [{ by: 'level' }],
            page: { size: 2000, total: 'exact' },
          }),
          {},
          letRealm,
        );
      const truncationWarned = (meta: Meta) =>
        (meta.warnings ?? []).some((w: any) => w.code === 'binding-truncated');

      test('a binding over exactly 10,000 rows is whole and says nothing', async function (assert) {
        let { urls, meta } = await viaBinding(10_000, 'marks');
        assert.deepEqual(urls.map(letLevelOf), levelsBelow(2000));
        assert.strictEqual(
          meta.page.total,
          10_000,
          'every row the list reaches',
        );
        assert.strictEqual(meta.lets.$picked.values, 10_000);
        assert.false(truncationWarned(meta), 'no warning');
      });

      test('a binding over 10,001 rows reads the first 10,000 and the response says so', async function (assert) {
        let { urls, meta } = await viaBinding(10_001, 'marks');
        assert.deepEqual(urls.map(letLevelOf), levelsBelow(2000));
        assert.strictEqual(
          meta.page.total,
          10_000,
          "the first 10,000 by the binding's own sort",
        );
        assert.false(
          urls.includes(letUrl(10_000)),
          'the row past the limit is not read',
        );
        assert.false(
          'truncated' in meta.lets.$picked,
          'a caveat is a warning, not a flag on meta.lets',
        );
        assert.true(
          truncationWarned(meta),
          'meta.warnings holds binding-truncated',
        );
      });

      test('a binding with exactly 10,000 values is whole and says nothing', async function (assert) {
        // 5,000 rows, two codes each.
        let { meta } = await viaBinding(5000, 'codes');
        assert.strictEqual(meta.page.total, 5000);
        assert.strictEqual(meta.lets.$picked.values, 10_000);
        assert.false(truncationWarned(meta), 'no warning');
      });

      test('a binding with more than 10,000 values keeps 10,000 and the response says so', async function (assert) {
        // 6,000 rows, two codes each: 12,000 values.
        let { urls, meta } = await viaBinding(6000, 'codes');
        assert.strictEqual(
          meta.lets.$picked.values,
          10_000,
          '10,000 values kept',
        );
        assert.false(
          'truncated' in meta.lets.$picked,
          'a caveat is a warning, not a flag on meta.lets',
        );
        assert.true(
          truncationWarned(meta),
          'meta.warnings holds binding-truncated',
        );
        // Each row has two codes of its own, so 10,000 values reach at least
        // 5,000 rows, and no row outside the binding's 6,000.
        assert.true(
          meta.page.total >= 5000,
          `at least 5,000 rows (${meta.page.total})`,
        );
        assert.true(
          meta.page.total < 6000,
          `fewer rows than the whole list would find (${meta.page.total})`,
        );
        assert.true(urls.every((u) => letLevelOf(u) < 6000));
      });

      test('a facet returns 50 values unless it names a size, and up to 1,000 when it does', async function (assert) {
        let facet = async (size?: number) =>
          (
            await search({
              filter: { type: Note },
              // counted by value: a number facet with `stats`
              facets: [{ by: 'level', stats: true, ...(size ? { size } : {}) }],
              page: { size: 1 },
            })
          ).meta.facets.level as { value: string; count: number }[];
        // 2,134 Notes, each with a level of its own.
        assert.strictEqual((await facet()).length, 50, 'the default');
        assert.strictEqual((await facet(1000)).length, 1000, 'the most');
        assert.strictEqual((await facet(60)).length, 60, 'a named size');
      });

      test('a request naming no page gets 500 rows, and is told more follow', async function (assert) {
        let { urls, meta } = await search(
          applyServerSearchPageBound({
            filter: { type: Note },
            sort: byLevel,
          } as Query),
        );
        assert.deepEqual(urls, levelsBelow(500).map(bulkUrl));
        assert.true(meta.page.hasMore);
      });

      test('a request for 2,000 rows gets them; one for 2,001 gets 2,000 and is told more follow', async function (assert) {
        for (let size of [2000, 2001]) {
          let { urls, meta } = await search(
            applyServerSearchPageBound({
              filter: { type: Note },
              sort: byLevel,
              page: { size },
            } as Query),
          );
          assert.deepEqual(
            urls,
            levelsBelow(2000).map(bulkUrl),
            `asked for ${size}`,
          );
          // The engine's answer marks the short page with hasMore; the
          // request's answer adds a page-size-clamped notice to
          // meta.warnings (search-bounds-test.ts).
          assert.true(meta.page.hasMore, `asked for ${size}: hasMore`);
        }
      });

      test('a card search naming no page gets 100 rows; 100 is the most it may ask for', async function (assert) {
        let { urls, meta } = await search(
          applySearchPageBound({
            filter: { type: Note },
            sort: byLevel,
          } as Query),
        );
        assert.deepEqual(urls, levelsBelow(100).map(bulkUrl));
        assert.true(meta.page.hasMore);
        let ask = (size: number) => () =>
          applySearchPageBound({
            filter: { type: Note },
            page: { size },
          } as Query);
        assert.strictEqual(codeOf(ask(100)), 'accepted');
        assert.throws(ask(101), (e: any) => e.status === 400, 'refused: 400');
      });
    });

    // ---- 5. cancellation, end to end -------------------------------------------

    module('a search that is cancelled', function () {
      // A search made slow on purpose: another session holds an exclusive lock
      // on the index table, so the search's statement waits in Postgres until
      // it is cancelled or the lock is released. A waiting statement shows in
      // pg_locks as a lock not yet granted.
      async function waiting(): Promise<number> {
        let [row] = (await adapter.execute(
          `SELECT COUNT(*)::int AS n FROM pg_locks WHERE NOT granted AND relation = 'boxel_index'::regclass`,
        )) as { n: number }[];
        return row.n;
      }
      async function until(condition: () => Promise<boolean>) {
        let deadline = Date.now() + 10_000;
        while (!(await condition()) && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
      }
      async function withIndexLocked(run: () => Promise<void>) {
        let release!: () => void;
        let released = new Promise<void>((resolve) => (release = resolve));
        let locked!: () => void;
        let isLocked = new Promise<void>((resolve) => (locked = resolve));
        let holder = adapter.withConnection(async (q) => {
          await q(['BEGIN']);
          await q(['LOCK TABLE boxel_index IN ACCESS EXCLUSIVE MODE']);
          locked();
          await released;
          await q(['ROLLBACK']);
        });
        await isLocked;
        try {
          await run();
        } finally {
          release();
          await holder;
        }
      }
      const q = { filter: levelBelow(5), sort: byLevel, page: { size: 10 } };
      const expected = levelsBelow(5).map(bulkUrl);

      async function assertUsable(assert: Assert) {
        let answers = await Promise.all(
          Array.from({ length: 12 }, () => search(q)),
        );
        assert.true(
          answers.every(
            (a) => JSON.stringify(a.urls) === JSON.stringify(expected),
          ),
          'a dozen searches at once all answer: no connection was lost',
        );
      }

      test('an abort rejects the search with the reason, stops its statement in Postgres, and leaves the pool usable', async function (assert) {
        let reason = new Error('the client went away');
        await withIndexLocked(async () => {
          let controller = new AbortController();
          let running = search(q, { signal: controller.signal });
          running.catch(() => {});
          await until(async () => (await waiting()) > 0);
          assert.true((await waiting()) > 0, 'the search is running');
          controller.abort(reason);
          await assert.rejects(running, (e: unknown) => e === reason);
          await until(async () => (await waiting()) === 0);
          assert.strictEqual(
            await waiting(),
            0,
            'nothing of the search is left running, with the lock still held',
          );
        });
        await assertUsable(assert);
      });

      test('a search already aborted runs nothing', async function (assert) {
        let reason = new Error('gone before it started');
        await withIndexLocked(async () => {
          let controller = new AbortController();
          controller.abort(reason);
          await assert.rejects(
            search(q, { signal: controller.signal }),
            (e: unknown) => e === reason,
          );
          assert.strictEqual(await waiting(), 0, 'no statement was started');
        });
        await assertUsable(assert);
      });

      test('a search past its time budget is refused with a 408, stops in Postgres, and leaves the pool usable', async function (assert) {
        await withIndexLocked(async () => {
          let running = runWithSearchTimeBudget(
            (signal) => search(q, { signal }),
            300,
          );
          await assert.rejects(
            running,
            (e: any) =>
              e?.name === 'SearchBoundError' &&
              e.status === 408 &&
              /time limit/.test(e.message),
          );
          await until(async () => (await waiting()) === 0);
          assert.strictEqual(
            await waiting(),
            0,
            'nothing of the search is left running, with the lock still held',
          );
        });
        await assertUsable(assert);
      });
    });
  });

  // ---- 4. a search while the index is being rewritten ---------------------------

  module('a search while the index is rewritten', function (hooks) {
    let adapter: PgAdapter;
    let indexWriter: IndexWriter;
    let engine: IndexQueryEngine;
    let vn: VirtualNetwork;
    let noteKey: string;

    hooks.beforeEach(async function () {
      prepareTestDB();
      adapter = await createTestPgAdapter();
      indexWriter = new IndexWriter(adapter);
      vn = new VirtualNetwork();
      engine = new IndexQueryEngine(adapter, makeDefinitionLookup(), vn);
      noteKey = internalKeyFor(Note, undefined, vn);
    });
    hooks.afterEach(async function () {
      await closeTestPgAdapter(adapter);
    });

    const url = (name: string) => `${realm}Note/${name}`;
    const names = (urls: string[]) =>
      urls.map((u) => u.replace(`${realm}Note/`, '')).sort();

    type Card = { bucket: string; level: number };
    async function begin() {
      return await indexWriter.createBatch(new URL(realm), vn, undefined, {
        splitPrerenderHtml: false,
      });
    }
    type Batch = Awaited<ReturnType<typeof begin>>;
    async function put(batch: Batch, cards: Record<string, Card>) {
      for (let [name, card] of Object.entries(cards)) {
        let cardURL = new URL(url(name));
        await batch.updateEntry(cardURL, {
          type: 'instance',
          resource: {
            id: rri(cardURL.href),
            type: 'card',
            attributes: {},
            meta: { adoptsFrom: { module: rri(Note.module), name: 'Note' } },
          },
          lastModified: Date.now(),
          resourceCreatedAt: Date.now(),
          searchData: {
            ...card,
            label: name,
            _title: `zq ${name}`,
            // the declared facet fields, as a render stamps them
            [SEARCH_TEXT_KEY]: {
              facets: await facetFieldSpecsOf(noteDef, async () => undefined),
            },
          },
          deps: new Set(),
          displayNames: ['Note'],
          types: [noteKey],
          isolatedHtml: `<div>${name}</div>`,
        });
      }
    }
    async function remove(batch: Batch, removed: string[]) {
      await batch.invalidate(removed.map((name) => new URL(url(name))));
    }
    async function index(cards: Record<string, Card>, removed: string[] = []) {
      let batch = await begin();
      await put(batch, cards);
      if (removed.length) {
        await remove(batch, removed);
      }
      await batch.done();
    }
    async function fail(batch: Batch, name: string) {
      await batch.updateEntry(new URL(url(name)), {
        type: 'instance-error',
        error: {
          id: url(name),
          status: 500,
          title: 'broken',
          message: 'a render that failed',
          additionalErrors: null,
          deps: [],
        },
      } as any);
    }

    async function rows(q: Record<string, any>, opts: object = {}) {
      let { results, meta } = await engine.search(
        new URL(realm),
        q as Query,
        opts,
        { kind: 'dataOnly' },
      );
      return {
        names: names(results.map((r) => String(r.url))),
        ordered: results.map((r) => String(r.url).replace(`${realm}Note/`, '')),
        meta: meta as Meta,
      };
    }
    const all = { filter: { type: Note }, page: { size: 50, total: 'exact' } };
    const inBucket = (bucket: string) => ({
      filter: { on: Note, eq: { bucket } },
      page: { size: 50, total: 'exact' },
    });
    // What a search answers, as the facts a reader takes from it.
    async function snapshot() {
      let everything = await rows({ ...all, facets: [{ by: 'bucket' }] });
      return {
        names: everything.names,
        total: everything.meta.page.total,
        buckets: Object.fromEntries(
          (everything.meta.facets.bucket as any[]).map((f) => [
            f.value,
            f.count,
          ]),
        ),
        moved: (await rows(inBucket('new'))).names,
      };
    }

    const before = {
      a: { bucket: 'old', level: 10 },
      b: { bucket: 'old', level: 20 },
      c: { bucket: 'old', level: 30 },
    };
    const OLD = {
      names: ['a', 'b', 'c'],
      total: 3,
      buckets: { old: 3 },
      moved: [],
    };
    // a changed, c deleted, d added
    const NEW = {
      names: ['a', 'b', 'd'],
      total: 3,
      buckets: { old: 1, new: 2 },
      moved: ['a', 'd'],
    };
    async function stage() {
      let batch = await begin();
      await put(batch, {
        a: { bucket: 'new', level: 10 },
        d: { bucket: 'new', level: 40 },
      });
      await remove(batch, ['c']);
      return batch;
    }

    test('before a batch is done a search sees the old rows exactly, and after it the new rows exactly', async function (assert) {
      await index(before);
      assert.deepEqual(await snapshot(), OLD, 'the starting index');
      let batch = await stage();
      assert.deepEqual(
        await snapshot(),
        OLD,
        'with a change, a delete and an addition staged, nothing has moved',
      );
      await batch.done();
      assert.deepEqual(
        await snapshot(),
        NEW,
        'done: the new rows, all of them',
      );
    });

    // A race shows itself only now and then: QUERY_RACE_RUNS repeats it
    // (the nightly run sets 10).
    const raceRuns = Math.max(1, Number(process.env.QUERY_RACE_RUNS ?? 1) || 1);
    for (let run = 1; run <= raceRuns; run++) {
      test(`a search racing a batch as it finishes sees the old rows or the new, never a mix${raceRuns > 1 ? ` (run ${run})` : ''}`, async function (assert) {
        await index(before);
        let batch = await stage();
        let finished = false;
        let done = batch.done().then(() => (finished = true));
        let seen: string[] = [];
        while (!finished && seen.length < 500) {
          // one statement answers rows, total and facet together
          let answer = await rows({ ...all, facets: [{ by: 'bucket' }] });
          seen.push(
            JSON.stringify({
              names: answer.names,
              total: answer.meta.page.total,
              buckets: Object.fromEntries(
                (answer.meta.facets.bucket as any[]).map((f) => [
                  f.value,
                  f.count,
                ]),
              ),
            }),
          );
        }
        await done;
        let whole = [OLD, NEW].map(({ names, total, buckets }) =>
          JSON.stringify({ names, total, buckets }),
        );
        // buckets may list their keys in either order
        let normal = (s: string) => {
          let o = JSON.parse(s);
          return JSON.stringify({
            ...o,
            buckets: Object.fromEntries(Object.entries(o.buckets).sort()),
          });
        };
        let mixed = seen.filter((s) => !whole.map(normal).includes(normal(s)));
        assert.deepEqual(mixed, [], 'every answer was one state or the other');
        assert.deepEqual(await snapshot(), NEW);
      });
    }

    test('paging is not a snapshot: a row indexed ahead of the page read shifts the next page back by one', async function (assert) {
      // pins current behavior; rule not yet decided: the docs do not say
      // whether pages are read from one point in time. Pages are offsets
      // into the index as it stands at each read, so a row added before the
      // first page makes the next page start one row early.
      await index({
        p10: { bucket: 'x', level: 10 },
        p20: { bucket: 'x', level: 20 },
        p30: { bucket: 'x', level: 30 },
        p40: { bucket: 'x', level: 40 },
      });
      let page = async (number: number) =>
        (
          await rows({
            filter: { type: Note },
            sort: [{ by: 'level', on: Note }],
            page: { size: 2, number },
          })
        ).ordered;
      assert.deepEqual(await page(0), ['p10', 'p20']);
      await index({ p05: { bucket: 'x', level: 5 } });
      // With p05 first, the order is p05 p10 p20 p30 p40: rows 2 and 3 are
      // p20 and p30, so p20 is read twice and nothing is skipped.
      assert.deepEqual(await page(1), ['p20', 'p30'], 'p20 comes back again');
    });

    test('a deleted card is in no answer: rows, totals, facets, a title substring', async function (assert) {
      await index(before);
      await index({}, ['c']);
      let [row] = (await adapter.execute(
        `SELECT is_deleted FROM boxel_index WHERE url = $1 AND type = 'instance'`,
        { bind: [url('c')] },
      )) as { is_deleted: boolean }[];
      assert.true(row?.is_deleted, 'its row stays, marked deleted');
      for (let [what, q] of [
        ['every card of the type', all],
        ['a filter it matched', inBucket('old')],
        ['a title substring', { filter: { contains: { _title: 'zq' } } }],
        [
          'a paged title substring',
          { filter: { contains: { _title: 'zq' } }, page: { size: 10 } },
        ],
      ] as [string, Record<string, any>][]) {
        for (let opts of [{}, { includeErrors: true }]) {
          let answer = await rows({ ...q, facets: [{ by: 'bucket' }] }, opts);
          let label = `${what}${'includeErrors' in opts ? ', errors included' : ''}`;
          assert.deepEqual(answer.names, ['a', 'b'], `${label}: rows`);
          assert.strictEqual(answer.meta.page.total, 2, `${label}: total`);
          assert.deepEqual(
            answer.meta.facets.bucket,
            [{ value: 'old', count: 2 }],
            `${label}: facet`,
          );
        }
      }
    });

    test('a card whose last index failed is left out of a search, its count and its facets', async function (assert) {
      await index(before);
      let batch = await begin();
      await fail(batch, 'c');
      await batch.done();
      let [row] = (await adapter.execute(
        `SELECT has_error FROM boxel_index WHERE url = $1 AND type = 'instance'`,
        { bind: [url('c')] },
      )) as { has_error: boolean }[];
      assert.true(row?.has_error, 'its row is marked errored');
      for (let [what, q] of [
        ['every card of the type', all],
        ['a filter it matched', inBucket('old')],
      ] as [string, Record<string, any>][]) {
        let answer = await rows({ ...q, facets: [{ by: 'bucket' }] });
        assert.deepEqual(answer.names, ['a', 'b'], `${what}: rows`);
        assert.strictEqual(answer.meta.page.total, 2, `${what}: total`);
        assert.deepEqual(
          answer.meta.facets.bucket,
          [{ value: 'old', count: 2 }],
          `${what}: facet`,
        );
      }
    });

    test('a search that asks for errored cards gets the errored card of the type', async function (assert) {
      await index(before);
      let batch = await begin();
      await fail(batch, 'c');
      await batch.done();
      let answer = await rows(all, { includeErrors: true });
      assert.deepEqual(answer.names, ['a', 'b', 'c']);
      assert.strictEqual(answer.meta.page.total, 3);
    });
  });
});
