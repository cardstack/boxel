import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import type { PgAdapter } from '@cardstack/postgres';
import {
  IndexQueryEngine,
  param,
  query,
  rri,
  VirtualNetwork,
  type DefinitionLookup,
} from '@cardstack/runtime-common';

import { setupDB } from './helpers/index.ts';

const testRealmURL = 'http://matches-filter-test/';

const stubDefinitionLookup: DefinitionLookup = {
  async lookupDefinition() {
    throw new Error(
      'lookupDefinition should not be called for top-level matches filter tests',
    );
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
    return stubDefinitionLookup;
  },
};

async function seedRow(
  dbAdapter: PgAdapter,
  {
    url,
    markdown,
    searchDoc = {},
  }: {
    url: string;
    markdown: string | null;
    searchDoc?: Record<string, unknown>;
  },
) {
  await query(dbAdapter, [
    `INSERT INTO boxel_index (url, file_alias, realm_url, generation, type, pristine_doc, search_doc, deps, types, is_deleted, has_error, indexed_at)`,
    `VALUES (`,
    param(url),
    `,`,
    param(url),
    `,`,
    param(testRealmURL),
    `,`,
    param(1),
    `,`,
    param('instance'),
    `,`,
    `'{}'::jsonb`,
    `,`,
    param(JSON.stringify(searchDoc)),
    `::jsonb`,
    `,`,
    `'[]'::jsonb`,
    `,`,
    `'[]'::jsonb`,
    `,`,
    param(false),
    `,`,
    param(false),
    `,`,
    param(Date.now()),
    `)`,
  ]);
  // The full-text `matches` predicate reads `prerendered_html.markdown`, so
  // the rendering half of the row — the markdown — is seeded there.
  await query(dbAdapter, [
    `INSERT INTO prerendered_html (url, file_alias, realm_url, type, markdown, generation, is_deleted, rendered_at)`,
    `VALUES (`,
    param(url),
    `,`,
    param(url),
    `,`,
    param(testRealmURL),
    `,`,
    param('instance'),
    `,`,
    param(markdown),
    `,`,
    param(1),
    `,`,
    param(false),
    `,`,
    param(Date.now()),
    `)`,
  ]);
}

async function countBoxelIndexRows(dbAdapter: PgAdapter): Promise<number> {
  let rows = (await dbAdapter.execute(
    `SELECT COUNT(*)::int AS total FROM boxel_index`,
  )) as { total: number }[];
  return rows[0].total;
}

module(basename(import.meta.filename), function () {
  module('MatchesFilter (Postgres integration)', function (hooks) {
    let dbAdapter: PgAdapter;
    let engine: IndexQueryEngine;

    setupDB(hooks, {
      beforeEach: async (_dbAdapter) => {
        dbAdapter = _dbAdapter;
        engine = new IndexQueryEngine(
          dbAdapter,
          stubDefinitionLookup,
          new VirtualNetwork(),
        );

        await seedRow(dbAdapter, {
          url: `${testRealmURL}mango.json`,
          markdown:
            'Mango is a friendly puppy who loves to play fetch in the park.',
        });
        await seedRow(dbAdapter, {
          url: `${testRealmURL}vangogh.json`,
          markdown: 'Van Gogh is a calm dog with a painterly coat.',
        });
        await seedRow(dbAdapter, {
          url: `${testRealmURL}ringo.json`,
          markdown: 'Ringo plays the drums and enjoys long naps.',
        });
        await seedRow(dbAdapter, {
          url: `${testRealmURL}empty.json`,
          markdown: null,
        });
      },
    });

    test('matches a single stemmed term in markdown', async function (assert) {
      let { cards, meta } = await engine.searchCards(new URL(testRealmURL), {
        filter: { matches: 'mango' },
      });
      assert.strictEqual(meta.page.total, 1, 'one row matched');
      assert.strictEqual(cards.length, 1, 'one card returned');
    });

    test('rejects a multi-operator filter at the engine, not just the wire', async function (assert) {
      // The wire surfaces reject this through `assertQuery`, but a query-backed
      // field is indexed straight through `searchCards` with no `assertQuery` in
      // the path. Without the engine's own backstop it would silently compile on
      // whichever operator `filterCondition` reaches first, diverging from the
      // host's live refresh, which rejects the same query.
      await assert.rejects(
        engine.searchCards(new URL(testRealmURL), {
          filter: {
            on: { module: `${testRealmURL}pet`, name: 'Pet' },
            eq: {},
            contains: {},
          } as unknown as Parameters<typeof engine.searchCards>[1]['filter'],
        }),
        /a filter may use only one operator, but found "eq", "contains"/,
      );
    });

    test('matches via stemming (plays / playing)', async function (assert) {
      let { meta } = await engine.searchCards(new URL(testRealmURL), {
        filter: { matches: 'playing' },
      });
      assert.strictEqual(
        meta.page.total,
        2,
        'both "plays" and "play" rows match via english stemming',
      );
    });

    test('returns no rows when no document matches the query', async function (assert) {
      let { meta } = await engine.searchCards(new URL(testRealmURL), {
        filter: { matches: 'xylophone' },
      });
      assert.strictEqual(meta.page.total, 0, 'no rows match');
    });

    test('supports websearch phrase syntax', async function (assert) {
      let { meta: phraseMeta } = await engine.searchCards(
        new URL(testRealmURL),
        {
          filter: { matches: '"friendly puppy"' },
        },
      );
      assert.strictEqual(
        phraseMeta.page.total,
        1,
        'exact phrase "friendly puppy" matches mango only',
      );

      let { meta: unorderedMeta } = await engine.searchCards(
        new URL(testRealmURL),
        {
          filter: { matches: '"puppy friendly"' },
        },
      );
      assert.strictEqual(
        unorderedMeta.page.total,
        0,
        'phrase order matters for phrase search',
      );
    });

    test('supports websearch OR syntax', async function (assert) {
      let { meta } = await engine.searchCards(new URL(testRealmURL), {
        filter: { matches: 'mango OR ringo' },
      });
      assert.strictEqual(meta.page.total, 2, 'either term matches');
    });

    test('supports websearch negation', async function (assert) {
      let { meta } = await engine.searchCards(new URL(testRealmURL), {
        filter: { matches: 'dog -painterly' },
      });
      assert.strictEqual(
        meta.page.total,
        0,
        'negation excludes the only "dog" row',
      );
    });

    test('null markdown does not match', async function (assert) {
      // Query a term that hits exactly one seeded row. If the null-markdown
      // row were accidentally included, total would be >1.
      let { meta } = await engine.searchCards(new URL(testRealmURL), {
        filter: { matches: 'mango' },
      });
      assert.strictEqual(
        meta.page.total,
        1,
        'only the mango row matches; the null-markdown row is excluded',
      );
    });

    test('empty query matches nothing', async function (assert) {
      let { meta: emptyMeta } = await engine.searchCards(
        new URL(testRealmURL),
        { filter: { matches: '' } },
      );
      assert.strictEqual(
        emptyMeta.page.total,
        0,
        'empty query does not match every row',
      );

      let { meta: wsMeta } = await engine.searchCards(new URL(testRealmURL), {
        filter: { matches: '   ' },
      });
      assert.strictEqual(
        wsMeta.page.total,
        0,
        'whitespace-only query does not match every row',
      );
    });

    test('composes with not at the top level', async function (assert) {
      let { meta } = await engine.searchCards(new URL(testRealmURL), {
        filter: { not: { matches: 'mango' } },
      });
      assert.strictEqual(
        meta.page.total,
        3,
        'all non-mango rows (including null markdown) are returned',
      );
    });

    test('composes with any at the top level', async function (assert) {
      let { meta } = await engine.searchCards(new URL(testRealmURL), {
        filter: {
          any: [{ matches: 'mango' }, { matches: 'ringo' }],
        },
      });
      assert.strictEqual(meta.page.total, 2, 'union of matches');
    });

    test('composes with every at the top level', async function (assert) {
      let { meta: bothMeta } = await engine.searchCards(new URL(testRealmURL), {
        filter: {
          every: [{ matches: 'friendly' }, { matches: 'puppy' }],
        },
      });
      assert.strictEqual(
        bothMeta.page.total,
        1,
        'intersection picks the one row containing both terms',
      );

      let { meta: noneMeta } = await engine.searchCards(new URL(testRealmURL), {
        filter: {
          every: [{ matches: 'friendly' }, { matches: 'drums' }],
        },
      });
      assert.strictEqual(
        noneMeta.page.total,
        0,
        'intersection is empty when no row contains both terms',
      );
    });

    test('parameterizes the query value safely', async function (assert) {
      let totalBefore = await countBoxelIndexRows(dbAdapter);

      let { meta } = await engine.searchCards(new URL(testRealmURL), {
        filter: { matches: `'; DROP TABLE boxel_index; --` },
      });

      assert.strictEqual(
        meta.page.total,
        0,
        'malicious input is treated as query text, not SQL',
      );

      let totalAfter = await countBoxelIndexRows(dbAdapter);
      assert.strictEqual(
        totalAfter,
        totalBefore,
        'boxel_index table was not dropped by injection attempt',
      );
    });

    test('tolerates unicode and special characters in the query string', async function (assert) {
      let { meta } = await engine.searchCards(new URL(testRealmURL), {
        filter: { matches: 'café 🦮 "$1 $2"' },
      });
      assert.strictEqual(
        meta.page.total,
        0,
        'special characters do not throw; no rows match',
      );
    });

    test('indexes base64-heavy markdown and keeps its prose searchable', async function (assert) {
      // Image cards embed base64 in their markdown — a single multi-megabyte
      // run of base64-alphabet characters. Fed raw to to_tsvector it tokenizes
      // (on the `+`/`/`) into enough distinct lexemes to blow past Postgres's
      // 1 MiB tsvector limit, and the INSERT below (which updates the GIN index)
      // would throw SQLSTATE 54000. markdown_search_text strips runs of >=255
      // base64-alphabet chars, so the row indexes cleanly and the surrounding
      // caption stays searchable while the blob itself is not.
      let base64Blob = Array.from({ length: 200000 }, (_, i) =>
        i.toString(36),
      ).join('/');
      await seedRow(dbAdapter, {
        url: `${testRealmURL}embedded-image.json`,
        markdown: `Embedded image caption text. data:image/png;base64,${base64Blob}`,
      });

      let { meta } = await engine.searchCards(new URL(testRealmURL), {
        filter: { matches: 'embedded image caption' },
      });
      assert.strictEqual(
        meta.page.total,
        1,
        'the base64-heavy row indexes and its caption is searchable',
      );

      let blobFragment = (100000).toString(36); // a token that lives only in the blob
      let { meta: blobMeta } = await engine.searchCards(new URL(testRealmURL), {
        filter: { matches: blobFragment },
      });
      assert.strictEqual(
        blobMeta.page.total,
        0,
        'the stripped base64 payload is not full-text indexed',
      );
    });

    // `search` (dataOnly) returns raw index rows with a real `url` column and the
    // computed `_matchRelevance`; the seed's `pristine_doc` is `{}`, so ordering
    // and score assertions read the row, not a reconstituted card.
    let relevanceUrls = async (query: Parameters<typeof engine.search>[1]) => {
      let { results } = await engine.search(
        new URL(testRealmURL),
        query,
        {},
        { kind: 'dataOnly' },
      );
      return results.map((r) => r.url as string);
    };

    test('sorts by ts_rank_cd relevance, best match first', async function (assert) {
      // Two fresh rows carrying a term absent from the beforeEach seed, at
      // different term frequency: the denser one must rank higher.
      await seedRow(dbAdapter, {
        url: `${testRealmURL}zebra-dense.json`,
        markdown: 'zebra zebra zebra — a whole herd of zebra on the plain.',
      });
      await seedRow(dbAdapter, {
        url: `${testRealmURL}zebra-sparse.json`,
        markdown: 'a single zebra grazing quietly.',
      });

      // No explicit direction: `_matchRelevance` defaults to `desc` (best
      // match first), unlike every other sort key.
      assert.deepEqual(
        await relevanceUrls({
          filter: { matches: 'zebra' },
          sort: [{ by: '_matchRelevance' }],
        }),
        [`${testRealmURL}zebra-dense.json`, `${testRealmURL}zebra-sparse.json`],
        'the denser row ranks first by default (desc)',
      );

      assert.deepEqual(
        await relevanceUrls({
          filter: { matches: 'zebra' },
          sort: [{ by: '_matchRelevance', direction: 'asc' }],
        }),
        [`${testRealmURL}zebra-sparse.json`, `${testRealmURL}zebra-dense.json`],
        'asc reverses the ranking',
      );
    });

    let prefixUrls = async (matches: string, prefix = true) =>
      (await relevanceUrls({ filter: { matches, prefix } })).sort();

    test('prefix matches the unfinished last word as a word prefix', async function (assert) {
      assert.deepEqual(
        await prefixUrls('pupp'),
        [`${testRealmURL}mango.json`],
        '"pupp" finds "puppy"',
      );
      assert.deepEqual(
        await prefixUrls('pupp', false),
        [],
        'without prefix, "pupp" is a whole word and finds nothing',
      );
      assert.deepEqual(
        await prefixUrls('PUPP'),
        [`${testRealmURL}mango.json`],
        'the prefix is case-insensitive',
      );
    });

    test('an unfinished word shorter than three letters on its own matches whole', async function (assert) {
      assert.deepEqual(await prefixUrls('pu'), [], '"pu" is not a prefix yet');
      assert.deepEqual(
        await prefixUrls('pup'),
        [`${testRealmURL}mango.json`],
        '"pup" is',
      );
      assert.deepEqual(
        await prefixUrls('friendly pu'),
        [`${testRealmURL}mango.json`],
        'after a finished word, a short partial word is a prefix',
      );
    });

    test('prefix finds a word whose stem is shorter than what was typed', async function (assert) {
      // "plays" and "play" index as the lexeme "play", which "playi" (on the
      // way to "playing") is not a prefix of.
      assert.deepEqual(
        await prefixUrls('playi'),
        [`${testRealmURL}mango.json`, `${testRealmURL}ringo.json`],
        '"playi" finds the "play" rows',
      );
      assert.deepEqual(
        await prefixUrls('painterl'),
        [`${testRealmURL}vangogh.json`],
        '"painterl" finds "painterly", indexed as "painter"',
      );
    });

    test('prefix matches the finished words as whole words, all of them', async function (assert) {
      assert.deepEqual(
        await prefixUrls('friendly pup'),
        [`${testRealmURL}mango.json`],
        'a finished word and a partial one, both present',
      );
      assert.deepEqual(
        await prefixUrls('calm pup'),
        [],
        'the finished word "calm" and the partial "pup" are never in one row',
      );
      assert.deepEqual(
        await prefixUrls('dog -painterl'),
        [],
        'a partial word under websearch negation stays negated',
      );
    });

    test('a prefix query that ends in whitespace has no unfinished word', async function (assert) {
      assert.deepEqual(await prefixUrls('pupp '), [], '"pupp " is a word');
      assert.deepEqual(
        await prefixUrls('puppy '),
        [`${testRealmURL}mango.json`],
        '"puppy " matches as without prefix',
      );
      assert.deepEqual(
        await prefixUrls('   '),
        [],
        'a blank query matches nothing',
      );
    });

    test('prefix matches rank by relevance', async function (assert) {
      await seedRow(dbAdapter, {
        url: `${testRealmURL}zebra-dense.json`,
        markdown: 'zebra zebra zebra — a whole herd of zebra on the plain.',
      });
      await seedRow(dbAdapter, {
        url: `${testRealmURL}zebra-sparse.json`,
        markdown: 'a single zebra grazing quietly.',
      });
      assert.deepEqual(
        await relevanceUrls({
          filter: { matches: 'zeb', prefix: true },
          sort: [{ by: '_matchRelevance' }],
        }),
        [`${testRealmURL}zebra-dense.json`, `${testRealmURL}zebra-sparse.json`],
        'the denser row ranks first',
      );
    });

    // The search sheet's term filter: full text OR either title key.
    let sheetTermFilter = (term: string) => ({
      any: [
        { matches: term },
        { contains: { _title: term } },
        { contains: { cardTitle: term } },
      ],
    });

    let seedTitledRows = async () => {
      await seedRow(dbAdapter, {
        url: `${testRealmURL}title-only.json`,
        markdown: 'A talk about logs and replicas.',
        searchDoc: {
          _title: 'Designing Data-Intensive Apps',
          cardTitle: 'Designing Data-Intensive Apps',
        },
      });
      await seedRow(dbAdapter, {
        url: `${testRealmURL}file-title.json`,
        markdown: null,
        searchDoc: { _title: 'intensive-notes.md' },
      });
    };

    test('a matches-or-title any returns the union of its branches', async function (assert) {
      await seedTitledRows();
      assert.deepEqual(
        (await relevanceUrls({ filter: sheetTermFilter('intensive') })).sort(),
        [`${testRealmURL}file-title.json`, `${testRealmURL}title-only.json`],
        'a substring of either title key matches (markdown has no "intensive")',
      );
      assert.deepEqual(
        (await relevanceUrls({ filter: sheetTermFilter('replicas') })).sort(),
        [`${testRealmURL}title-only.json`],
        'a markdown-only hit still matches',
      );
      assert.deepEqual(
        (await relevanceUrls({ filter: sheetTermFilter('DATA-INT') })).sort(),
        [`${testRealmURL}title-only.json`],
        'the title match is case-insensitive and spans punctuation',
      );
      assert.deepEqual(
        (
          await relevanceUrls({ filter: { not: sheetTermFilter('intensive') } })
        ).sort(),
        [
          `${testRealmURL}empty.json`,
          `${testRealmURL}mango.json`,
          `${testRealmURL}ringo.json`,
          `${testRealmURL}vangogh.json`,
        ],
        'negated, it keeps exactly the other rows',
      );
      assert.deepEqual(
        (
          await relevanceUrls({
            filter: {
              any: [
                { matches: 'kleppm', prefix: true },
                { contains: { _title: 'zzz' } },
              ],
            },
          })
        ).sort(),
        [],
        'a prefix matches branch compiles in the union too',
      );
    });

    test('a matches-or-title any compiles to one indexed union', async function (assert) {
      let captured: string[] = [];
      let originalExecute = dbAdapter.execute.bind(dbAdapter);
      (dbAdapter as any).execute = async (sql: string, opts?: any) => {
        captured.push(sql);
        return originalExecute(sql, opts);
      };
      try {
        await relevanceUrls({ filter: sheetTermFilter('intensive') });
      } finally {
        (dbAdapter as any).execute = originalExecute;
      }
      let dataQuery = captured.find((sql) => sql.includes('UNION'));
      assert.ok(dataQuery, 'the filter compiles to a UNION');
      assert.true(
        dataQuery!.includes(`ti.search_doc ->> '_title' ILIKE`),
        'the _title key is a literal, so its trigram index can match',
      );
      assert.true(
        dataQuery!.includes(`ti.search_doc ->> 'cardTitle' ILIKE`),
        'the cardTitle key is a literal, so its trigram index can match',
      );

      // A tiny table is cheapest to scan, so take scans off the table to see
      // that the trigram index can answer the title predicate at all.
      let planText = await dbAdapter.withConnection(async (run) => {
        await run([`SET enable_seqscan = off`]);
        let rows = (await run([
          `EXPLAIN SELECT url FROM boxel_index WHERE search_doc ->> '_title' ILIKE '%intensive%'`,
        ])) as { 'QUERY PLAN': string }[];
        await run([`RESET enable_seqscan`]);
        return rows.map((row) => row['QUERY PLAN']).join('\n');
      });
      assert.true(
        planText.includes('boxel_index_title_trgm_idx'),
        `the planner can use the title trigram index; got ${planText}`,
      );
      let indexes = (await dbAdapter.execute(
        `SELECT indexname FROM pg_indexes WHERE tablename = 'boxel_index' AND indexname LIKE '%trgm%' ORDER BY indexname`,
      )) as { indexname: string }[];
      assert.deepEqual(
        indexes.map((row) => row.indexname),
        ['boxel_index_card_title_trgm_idx', 'boxel_index_title_trgm_idx'],
        'both title trigram indexes are migrated',
      );
    });

    let seedTypeAheadRows = async () => {
      await seedRow(dbAdapter, {
        url: `${testRealmURL}crdt.json`,
        markdown:
          'Conflict-free replicated data types, as Martin Kleppmann explains them.',
        searchDoc: {
          _typeahead: 'Conflict-free Replicated Data Types\nCRDT',
        },
      });
      await seedRow(dbAdapter, {
        url: `${testRealmURL}kleppmann.json`,
        markdown: 'Martin Kleppmann',
        searchDoc: { _typeahead: 'Martin Kleppmann' },
      });
    };
    let typeAheadUrls = async (typeahead: string) =>
      (await relevanceUrls({ filter: { typeahead } })).sort();

    test('typeahead matches every word as a prefix of the type-ahead text', async function (assert) {
      await seedTypeAheadRows();
      assert.deepEqual(
        await typeAheadUrls('kleppm'),
        [`${testRealmURL}kleppmann.json`],
        'only the card whose type-ahead text has the word; never the markdown that mentions it',
      );
      assert.deepEqual(
        await typeAheadUrls('data repl'),
        [`${testRealmURL}crdt.json`],
        'words match in any order',
      );
      assert.deepEqual(
        await typeAheadUrls('crdt'),
        [`${testRealmURL}crdt.json`],
        'each line of the text counts (a synonym)',
      );
      assert.deepEqual(
        await typeAheadUrls('M'),
        [`${testRealmURL}kleppmann.json`],
        'one letter is a prefix too, and case is ignored',
      );
      assert.deepEqual(
        await typeAheadUrls('martin crdt'),
        [],
        'every word must match the same card',
      );
      assert.deepEqual(
        await typeAheadUrls('  -- '),
        [],
        'no words matches nothing',
      );
      assert.deepEqual(
        await typeAheadUrls('mango'),
        [],
        'a card with no type-ahead text never matches',
      );
    });

    test('typeahead composes in an indexed union', async function (assert) {
      await seedTypeAheadRows();
      assert.deepEqual(
        (
          await relevanceUrls({
            filter: { any: [{ typeahead: 'kleppm' }, { matches: 'puppy' }] },
          })
        ).sort(),
        [`${testRealmURL}kleppmann.json`, `${testRealmURL}mango.json`],
      );
      assert.deepEqual(
        (await relevanceUrls({ filter: { not: { typeahead: 'kleppm' } } }))
          .length,
        5,
        'negated, it keeps every other row',
      );
    });

    test('facets count a field over every match, list fields per element', async function (assert) {
      await seedRow(dbAdapter, {
        url: `${testRealmURL}talk-1.json`,
        markdown: 'a talk about clocks',
        searchDoc: { category: 'Systems', concepts: ['clocks', 'consensus'] },
      });
      await seedRow(dbAdapter, {
        url: `${testRealmURL}talk-2.json`,
        markdown: 'a talk about clocks and queues',
        searchDoc: { category: 'Systems', concepts: ['clocks', 'queues'] },
      });
      await seedRow(dbAdapter, {
        url: `${testRealmURL}talk-3.json`,
        markdown: 'a talk about voting',
        searchDoc: { category: 'Society', concepts: ['voting'] },
      });
      let { meta } = await engine.search(
        new URL(testRealmURL),
        {
          filter: { matches: 'talk' },
          facets: [{ by: 'category' }, { by: 'concepts', size: 2 }],
          page: { size: 1 },
        },
        {},
        { kind: 'dataOnly' },
      );
      assert.strictEqual(meta.page.total, 3, 'the page is one row of three');
      assert.deepEqual(meta.facets?.category, [
        { value: 'Systems', count: 2 },
        { value: 'Society', count: 1 },
      ]);
      assert.deepEqual(
        meta.facets?.concepts,
        [
          { value: 'clocks', count: 2 },
          { value: 'consensus', count: 1 },
        ],
        'each element of a list counts, capped at size, ties by value',
      );
    });

    let seedPassage = async (
      url: string,
      ordinal: number,
      start: number,
      text: string,
    ) => {
      await query(dbAdapter, [
        `INSERT INTO boxel_index_passages (realm_url, url, type, field_path, ordinal, start_at, end_at, body, tsv) VALUES (`,
        param(testRealmURL),
        `,`,
        param(url),
        `, 'instance', 'segments',`,
        param(ordinal),
        `,`,
        param(start),
        `,`,
        param(start + 60),
        `,`,
        param(text),
        `, to_tsvector('english',`,
        param(text),
        `))`,
      ]);
    };
    let seedTalks = async () => {
      for (let [slug, segments] of [
        [
          'clocks-talk',
          [
            'welcome everyone to the conference',
            'two machines never agree on what time it is',
            'so we order events with logical clocks instead',
          ],
        ],
        ['votes-talk', ['every ranked voting rule breaks a fairness rule']],
      ] as [string, string[]][]) {
        let url = `${testRealmURL}${slug}.json`;
        await seedRow(dbAdapter, {
          url,
          markdown: `# ${slug}`,
          searchDoc: { _passages: ['segments'] },
        });
        for (let [ordinal, text] of segments.entries()) {
          await seedPassage(url, ordinal, ordinal * 60, text);
        }
      }
    };

    test('matches within a passage list finds the card by any passage', async function (assert) {
      await seedTalks();
      assert.deepEqual(
        (
          await relevanceUrls({
            filter: { matches: 'logical clocks', within: 'segments' },
          })
        ).sort(),
        [`${testRealmURL}clocks-talk.json`],
      );
      assert.deepEqual(
        await relevanceUrls({
          filter: { matches: 'clocks-talk', within: 'segments' },
        }),
        [],
        'the markdown is not searched',
      );
      assert.deepEqual(
        await relevanceUrls({
          filter: { matches: 'machin', prefix: true, within: 'segments' },
        }),
        [`${testRealmURL}clocks-talk.json`],
        'prefix works within passages',
      );
      assert.deepEqual(
        (
          await relevanceUrls({
            filter: {
              any: [
                { matches: 'fairness', within: 'segments' },
                { matches: 'puppy' },
              ],
            },
          })
        ).sort(),
        [`${testRealmURL}mango.json`, `${testRealmURL}votes-talk.json`],
        'a passage branch joins the indexed union',
      );
    });

    test('a passage search reports which passages matched, and ranks by the best one', async function (assert) {
      await seedTalks();
      let { meta } = await engine.search(
        new URL(testRealmURL),
        {
          filter: { matches: 'clocks or time', within: 'segments' },
          sort: [{ by: '_matchRelevance' }],
        },
        {},
        { kind: 'dataOnly' },
      );
      let passages = meta.passages?.[`${testRealmURL}clocks-talk`];
      assert.deepEqual(
        passages?.map((p) => [p.field, p.ordinal, p.start]).sort(),
        [
          ['segments', 1, 60],
          ['segments', 2, 120],
        ],
        'both matching segments, with where they start',
      );
      assert.true(
        (passages?.[0].score ?? 0) > 0,
        'each carries a relevance score',
      );
    });

    test('a relevance sort carrying a type anchor ranks the same as one without', async function (assert) {
      await seedRow(dbAdapter, {
        url: `${testRealmURL}zebra-dense.json`,
        markdown: 'zebra zebra zebra — a whole herd of zebra on the plain.',
      });
      await seedRow(dbAdapter, {
        url: `${testRealmURL}zebra-sparse.json`,
        markdown: 'a single zebra grazing quietly.',
      });

      let petRef = { module: rri(`${testRealmURL}pet`), name: 'Pet' };
      // The stub definition lookup throws if consulted, so this also pins
      // that the anchor is never resolved as a field's owning type.
      assert.deepEqual(
        await relevanceUrls({
          filter: { matches: 'zebra' },
          sort: [
            {
              by: '_matchRelevance',
              on: petRef,
            },
          ],
        }),
        [`${testRealmURL}zebra-dense.json`, `${testRealmURL}zebra-sparse.json`],
        'the denser row ranks first, and the default direction is still desc',
      );
      await assert.rejects(
        engine.searchCards(new URL(testRealmURL), {
          filter: { not: { matches: 'zebra' } },
          sort: [
            {
              by: '_matchRelevance',
              on: petRef,
            },
          ],
        }),
        /requires at least one positive `matches` filter/,
        'the anchor does not exempt it from the engine backstop',
      );
    });

    test('exposes a bounded 0–1 relevance value on the row', async function (assert) {
      await seedRow(dbAdapter, {
        url: `${testRealmURL}zebra-dense.json`,
        markdown: 'zebra zebra zebra — a whole herd of zebra on the plain.',
      });
      await seedRow(dbAdapter, {
        url: `${testRealmURL}zebra-sparse.json`,
        markdown: 'a single zebra grazing quietly.',
      });

      let { results } = await engine.search(
        new URL(testRealmURL),
        {
          filter: { matches: 'zebra' },
          sort: [{ by: '_matchRelevance', direction: 'desc' }],
        },
        {},
        { kind: 'dataOnly' },
      );
      let scores = results.map((r) =>
        Number((r as Record<string, unknown>)['_matchRelevance']),
      );
      assert.strictEqual(scores.length, 2, 'both rows carry a score');
      for (let score of scores) {
        assert.ok(score > 0, `relevance is positive; got ${score}`);
        assert.ok(
          score <= 1,
          `ts_rank_cd flag 32 normalizes to at most 1; got ${score}`,
        );
      }
      assert.ok(
        scores[0] > scores[1],
        'the denser row carries the higher score',
      );
    });

    test('ranks a positive-polarity union of multiple matches terms', async function (assert) {
      // A row carrying both union terms out-ranks a row carrying one.
      await seedRow(dbAdapter, {
        url: `${testRealmURL}both.json`,
        markdown: 'a nimble zebra beside a bright quokka.',
      });
      await seedRow(dbAdapter, {
        url: `${testRealmURL}one.json`,
        markdown: 'a lone zebra on the plain.',
      });

      assert.deepEqual(
        await relevanceUrls({
          filter: { any: [{ matches: 'zebra' }, { matches: 'quokka' }] },
          sort: [{ by: '_matchRelevance', direction: 'desc' }],
        }),
        [`${testRealmURL}both.json`, `${testRealmURL}one.json`],
        'the row matching both union terms ranks ahead of the one-term row',
      );
    });

    test('rejects a relevance sort with no positive matches term', async function (assert) {
      await assert.rejects(
        engine.searchCards(new URL(testRealmURL), {
          filter: { not: { matches: 'mango' } },
          sort: [{ by: '_matchRelevance', direction: 'desc' }],
        }),
        /requires at least one positive `matches` filter/,
        'a negated-only tree has no positive term to rank by',
      );
    });

    test('IndexQueryEngine asks the markdown index once, through an indexed subquery', async function (assert) {
      // Every positive `matches` term compiles to an uncorrelated
      // `(url, realm_url, type) IN (SELECT … FROM prerendered_html AS phm …)`,
      // which Postgres runs as a hashed SubPlan over the markdown GIN index.
      // Inline beside a type anchor the planner misestimated some terms and
      // recomputed every typed row's tsvector (~2 s over 6k transcripts). The
      // subquery keeps the null-rejecting guard on its own rows. This captures
      // the SQL the engine actually emits, so a regression back to the inline
      // form fails here.
      let executed: string[] = [];
      let originalExecute = dbAdapter.execute.bind(dbAdapter);
      dbAdapter.execute = ((
        sql: string,
        opts?: Parameters<typeof originalExecute>[1],
      ) => {
        executed.push(sql);
        return originalExecute(sql, opts);
      }) as typeof dbAdapter.execute;
      try {
        await engine.searchCards(new URL(testRealmURL), {
          filter: { matches: 'mango' },
        });
      } finally {
        dbAdapter.execute = originalExecute;
      }

      let guard = `(i.url, i.realm_url, i.type) IN (SELECT phm.url, phm.realm_url, phm.type FROM prerendered_html AS phm WHERE phm.markdown IS NOT NULL AND to_tsvector('english', markdown_search_text(phm.markdown))`;
      let matchesSql = executed.filter((sql) =>
        sql.includes('markdown_search_text(phm.markdown)'),
      );
      assert.ok(
        matchesSql.length > 0,
        'the engine ran a full-text matches query',
      );
      for (let sql of matchesSql) {
        assert.ok(
          sql.includes(guard),
          `emitted matches SQL should use the indexed subquery; got: ${sql}`,
        );
      }
    });

    test('the null-rejecting guard reduces the prerendered_html LEFT JOIN to an inner join', async function (assert) {
      // The engine attaches prerendered_html to boxel_index through a LEFT JOIN
      // (see `prerenderedJoin`) and runs the `matches` predicate against the
      // joined `ph`. `markdown_search_text` coalesces null markdown to '', which
      // hides the predicate's null-rejection from the planner: without the
      // `ph.markdown IS NOT NULL` guard the planner cannot reduce the outer join,
      // so it drives the query from boxel_index and recomputes `to_tsvector` for
      // every joined row instead of reaching `prerendered_html_markdown_fts_idx`.
      // The guard restores the join reduction — and that reduction is exactly
      // what makes the markdown GIN index reachable at scale (on a realm with
      // thousands of rows the planner then BitmapAnds the realm B-tree with the
      // markdown GIN; with only a handful of seeded rows here it prefers the
      // realm B-tree plus a filter, so asserting the index name would be
      // dataset-dependent). The join type is the size-independent signal, so we
      // assert directly on it: the guarded predicate yields an inner join and the
      // unguarded predicate stays a left join. A build that drops the guard fails
      // here rather than silently reintroducing the slowdown.
      //
      // EXPLAIN's JSON output stringifies each join's planner-chosen strategy as
      // `"Join Type":"Inner"` / `"Join Type":"Left"`; this query has exactly one
      // join, so a substring check is unambiguous.
      //
      // The realm URL and query term are bound as parameters ($1/$2) rather than
      // interpolated, so the SQL stays quoting-safe whatever their contents; only
      // the predicate *shape* — which is test-controlled, not data — is composed
      // inline.
      let tsPredicate = `to_tsvector('english', markdown_search_text(ph.markdown)) @@ websearch_to_tsquery('english', $2)`;
      let joinShapeExplain = (predicate: string) =>
        `EXPLAIN (FORMAT JSON)
         SELECT i.url
         FROM boxel_index AS i
         LEFT JOIN prerendered_html AS ph
           ON ph.url = i.url AND ph.realm_url = i.realm_url AND ph.type = i.type
         WHERE i.realm_url = $1
           AND ${predicate}`;

      let explainJoinShape = async (predicate: string) =>
        JSON.stringify(
          await dbAdapter.execute(joinShapeExplain(predicate), {
            bind: [testRealmURL, 'mango'],
          }),
        );

      let guarded = await explainJoinShape(
        `ph.markdown IS NOT NULL AND ${tsPredicate}`,
      );
      let unguarded = await explainJoinShape(tsPredicate);

      assert.ok(
        guarded.includes('"Join Type":"Inner"'),
        `guarded predicate should reduce the outer join to an inner join; got: ${guarded}`,
      );
      assert.notOk(
        guarded.includes('"Join Type":"Left"'),
        `guarded predicate should leave no unreduced outer join; got: ${guarded}`,
      );
      assert.ok(
        unguarded.includes('"Join Type":"Left"'),
        `unguarded predicate should leave the outer join unreduced — the bug the guard fixes; got: ${unguarded}`,
      );
    });
  });
});
