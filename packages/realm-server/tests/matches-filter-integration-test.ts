import { module, test } from 'qunit';
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
    `INSERT INTO boxel_index (url, file_alias, realm_url, realm_version, type, pristine_doc, search_doc, deps, types, is_deleted, has_error, indexed_at, markdown)`,
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
    `,`,
    param(markdown),
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

    test('planner uses boxel_index_markdown_fts_idx for matches queries', async function (assert) {
      // The filter emits `to_tsvector('english', coalesce(i.markdown, ''))`
      // which must match the GIN index expression exactly. With only a handful
      // of seeded rows PG will ordinarily prefer a seqscan; disabling seqscan
      // forces the planner to reveal whether the GIN index is a viable
      // candidate at all — which is the property we actually care about.
      //
      // SET LOCAL is bound to a transaction, so we run SET/EXPLAIN/COMMIT on
      // the same pooled connection via withConnection. Each inner query is
      // its own round-trip, so EXPLAIN's result is returned cleanly.
      let plan = await dbAdapter.withConnection(async (run) => {
        await run(['BEGIN']);
        await run(['SET LOCAL enable_seqscan = OFF']);
        let rows = await run([
          `EXPLAIN (FORMAT JSON)
           SELECT url FROM boxel_index
           WHERE to_tsvector('english', coalesce(markdown, ''))
                 @@ websearch_to_tsquery('english', 'mango')`,
        ]);
        await run(['COMMIT']);
        return rows;
      });

      let planText = JSON.stringify(plan);
      assert.ok(
        planText.includes('boxel_index_markdown_fts_idx'),
        `plan should reference the GIN index; got: ${planText}`,
      );
    });
  });
});
