import { module, test } from 'qunit';
import { basename } from 'path';

import type { PgAdapter } from '@cardstack/postgres';
import {
  IndexQueryEngine,
  param,
  query,
  type DefinitionLookup,
} from '@cardstack/runtime-common';

import { setupDB } from './helpers';

const testRealmURL = 'http://matches-result-meta-test/';

const stubDefinitionLookup: DefinitionLookup = {
  async lookupDefinition() {
    throw new Error(
      'lookupDefinition should not be called for top-level meta tests',
    );
  },
  async lookupCachedDefinition() {
    return undefined;
  },
  async invalidate() {
    return [];
  },
  async clearRealmCache() {},
  async clearAllModules() {},
  registerRealm() {},
  async getModuleCacheEntry() {
    return undefined;
  },
  async getModuleCacheEntries() {
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
    pristineDoc,
  }: {
    url: string;
    markdown: string | null;
    pristineDoc?: Record<string, any>;
  },
) {
  let doc =
    pristineDoc ??
    ({
      id: url,
      type: 'card',
      attributes: {},
      meta: { adoptsFrom: { module: 'test/card', name: 'TestCard' } },
    } as Record<string, any>);
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
    param(doc as any),
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

module(basename(__filename), function () {
  module('MatchesFilter result meta (Postgres)', function (hooks) {
    let dbAdapter: PgAdapter;
    let engine: IndexQueryEngine;

    setupDB(hooks, {
      beforeEach: async (_dbAdapter) => {
        dbAdapter = _dbAdapter;
        engine = new IndexQueryEngine(dbAdapter, stubDefinitionLookup);

        // Three rows with varying density of "puppy":
        //   mango:   3 hits → highest rank
        //   vangogh: 1 hit  → lower rank
        //   ringo:   0 hits → excluded by filter
        await seedRow(dbAdapter, {
          url: `${testRealmURL}mango.json`,
          markdown:
            'Mango is a puppy. A playful puppy. Such a sweet puppy indeed.',
        });
        await seedRow(dbAdapter, {
          url: `${testRealmURL}vangogh.json`,
          markdown: 'Van Gogh is a puppy with a painterly coat.',
        });
        await seedRow(dbAdapter, {
          url: `${testRealmURL}ringo.json`,
          markdown: 'Ringo plays the drums and enjoys long naps.',
        });
      },
    });

    test('each matching row gets rank, snippet, matchedTerms on meta', async function (assert) {
      let { cards } = await engine.searchCards(new URL(testRealmURL), {
        filter: { matches: 'puppy' },
      });
      assert.strictEqual(cards.length, 2, 'two rows matched');
      for (let card of cards) {
        assert.strictEqual(
          typeof card.meta.rank,
          'number',
          `${card.id} has numeric rank`,
        );
        assert.ok(
          Number.isFinite(card.meta.rank!),
          `${card.id} rank is finite`,
        );
        assert.ok(
          card.meta.rank! > 0,
          `${card.id} rank is > 0 (matched rows rank above zero)`,
        );
        assert.strictEqual(
          typeof card.meta.snippet,
          'string',
          `${card.id} has string snippet`,
        );
        assert.ok(
          Array.isArray(card.meta.matchedTerms),
          `${card.id} matchedTerms is an array`,
        );
      }
    });

    test('snippet wraps matching term in <b>…</b>', async function (assert) {
      let { cards } = await engine.searchCards(new URL(testRealmURL), {
        filter: { matches: 'puppy' },
      });
      for (let card of cards) {
        let snippet = card.meta.snippet!;
        assert.ok(
          /<b>[^<]*<\/b>/i.test(snippet),
          `${card.id} snippet contains <b>…</b> markup; got: ${snippet}`,
        );
        // The stemmed "puppy" should still appear somewhere (case-insensitive).
        assert.ok(
          /puppy/i.test(snippet),
          `${card.id} snippet still contains the matching term; got: ${snippet}`,
        );
      }
    });

    test('rank orders denser matches above sparser ones', async function (assert) {
      // No explicit sort → rank-desc default fires (CS-10829).
      let { cards } = await engine.searchCards(new URL(testRealmURL), {
        filter: { matches: 'puppy' },
      });
      assert.deepEqual(
        cards.map((c) => c.id),
        [`${testRealmURL}mango.json`, `${testRealmURL}vangogh.json`],
        'mango (3 hits) ranks above vangogh (1 hit)',
      );
      let mangoRank = cards[0].meta.rank!;
      let vangoghRank = cards[1].meta.rank!;
      assert.ok(
        mangoRank > vangoghRank,
        `mango rank ${mangoRank} should exceed vangogh rank ${vangoghRank}`,
      );
    });

    test('matchedTerms includes present query terms, excludes stop-words', async function (assert) {
      // websearch_to_tsquery treats space as AND; use `or` so the query
      // matches vangogh even though "unicorn" is absent. "the" is an
      // English stop-word and must be excluded from matchedTerms; "puppy"
      // and "painterly" are present in vangogh's markdown; "unicorn" is not.
      let { cards } = await engine.searchCards(new URL(testRealmURL), {
        filter: { matches: 'puppy or painterly or unicorn or the' },
      });
      let vangogh = cards.find((c) => c.id === `${testRealmURL}vangogh.json`)!;
      assert.ok(vangogh, 'vangogh is in the results');
      assert.deepEqual(
        [...vangogh.meta.matchedTerms!].sort(),
        ['painterly', 'puppy'],
        'matchedTerms contains only present, non-stop-word tokens',
      );
    });

    test('no meta is added when the filter has no matches node', async function (assert) {
      let { cards } = await engine.searchCards(new URL(testRealmURL), {});
      assert.ok(cards.length > 0, 'got some cards back');
      for (let card of cards) {
        assert.strictEqual(
          card.meta.rank,
          undefined,
          `${card.id} has no rank when filter has no matches`,
        );
        assert.strictEqual(
          card.meta.snippet,
          undefined,
          `${card.id} has no snippet when filter has no matches`,
        );
        assert.strictEqual(
          card.meta.matchedTerms,
          undefined,
          `${card.id} has no matchedTerms when filter has no matches`,
        );
      }
    });

    test('meta is synthesized even when matches is nested inside any/every', async function (assert) {
      let { cards } = await engine.searchCards(new URL(testRealmURL), {
        filter: {
          any: [{ matches: 'puppy' }, { matches: 'drums' }],
        },
      });
      assert.strictEqual(cards.length, 3, 'all three rows match the any');
      for (let card of cards) {
        assert.strictEqual(
          typeof card.meta.rank,
          'number',
          `${card.id} has rank from the nested matches`,
        );
        assert.ok(
          Array.isArray(card.meta.matchedTerms),
          `${card.id} has matchedTerms`,
        );
      }
    });
  });
});
