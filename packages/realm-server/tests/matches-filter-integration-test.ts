import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import type { PgAdapter } from '@cardstack/postgres';
import {
  IndexQueryEngine,
  param,
  query,
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
  { url, markdown }: { url: string; markdown: string | null },
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
    `'{}'::jsonb`,
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

      assert.deepEqual(
        await relevanceUrls({
          filter: { matches: 'zebra' },
          sort: [{ by: '_matchRelevance', direction: 'desc' }],
        }),
        [`${testRealmURL}zebra-dense.json`, `${testRealmURL}zebra-sparse.json`],
        'the denser row ranks first',
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

    test('IndexQueryEngine emits the null-rejecting guard in its matches SQL', async function (assert) {
      // The join-shape test below proves the guard *would* reduce the join, but
      // it composes the predicate itself, so it can't catch IndexQueryEngine
      // dropping the guard. This test closes that gap: it captures the SQL the
      // engine actually emits for a `matches` search and asserts the guard is
      // present, so a regression in the engine fails here rather than passing on
      // a predicate the engine no longer produces.
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

      let guard = `ph.markdown IS NOT NULL AND to_tsvector('english', markdown_search_text(ph.markdown))`;
      let matchesSql = executed.filter((sql) =>
        sql.includes('markdown_search_text(ph.markdown)'),
      );
      assert.ok(
        matchesSql.length > 0,
        'the engine ran a full-text matches query',
      );
      for (let sql of matchesSql) {
        assert.ok(
          sql.includes(guard),
          `emitted matches SQL should include the null-rejecting guard; got: ${sql}`,
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
