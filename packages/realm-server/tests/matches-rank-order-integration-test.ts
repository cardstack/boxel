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

const testRealmURL = 'http://matches-rank-order-test/';

const stubDefinitionLookup: DefinitionLookup = {
  async lookupDefinition() {
    throw new Error(
      'lookupDefinition should not be called for top-level rank-order tests',
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
  { url, markdown }: { url: string; markdown: string | null },
) {
  let doc = {
    id: url,
    type: 'card',
    attributes: {},
    meta: { adoptsFrom: { module: 'test/card', name: 'TestCard' } },
  } as Record<string, any>;
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
  module('MatchesFilter rank-desc default order', function (hooks) {
    let dbAdapter: PgAdapter;
    let engine: IndexQueryEngine;

    setupDB(hooks, {
      beforeEach: async (_dbAdapter) => {
        dbAdapter = _dbAdapter;
        engine = new IndexQueryEngine(dbAdapter, stubDefinitionLookup);

        // mango mentions "puppy" three times → higher ts_rank_cd.
        // vangogh mentions it once → lower rank.
        // ringo has no "puppy" at all.
        // URL ordering alone would put mango before ringo before vangogh
        // (alphabetical by URL), so rank-desc and URL order disagree here
        // on whether vangogh or ringo leads, proving the rank clause fires.
        await seedRow(dbAdapter, {
          url: `${testRealmURL}mango.json`,
          markdown: 'Mango is a puppy. A playful puppy. Such a sweet puppy.',
        });
        await seedRow(dbAdapter, {
          url: `${testRealmURL}ringo.json`,
          markdown: 'Ringo is a dog who plays the drums.',
        });
        await seedRow(dbAdapter, {
          url: `${testRealmURL}vangogh.json`,
          markdown: 'Van Gogh is a puppy with a painterly coat.',
        });
      },
    });

    test('defaults to rank-desc when matches is present and no sort is supplied', async function (assert) {
      let { cards } = await engine.searchCards(new URL(testRealmURL), {
        filter: { matches: 'puppy' },
      });
      let urls = cards.map((c) => c.id);
      assert.deepEqual(
        urls,
        [`${testRealmURL}mango.json`, `${testRealmURL}vangogh.json`],
        'mango (3 hits) ranks above vangogh (1 hit); ringo excluded by filter',
      );
    });

    test('caller-supplied sort wins over rank-desc default', async function (assert) {
      // Sort by URL descending flips alphabetical order to vangogh, mango.
      // If rank-desc leaked in, mango (3 hits) would lead. Asserting
      // [vangogh, mango] proves the caller's sort is honored alone.
      let { cards } = await engine.searchCards(new URL(testRealmURL), {
        filter: { matches: 'puppy' },
        sort: [{ by: 'cardURL', direction: 'desc' }],
      });
      let urls = cards.map((c) => c.id);
      assert.deepEqual(
        urls,
        [`${testRealmURL}vangogh.json`, `${testRealmURL}mango.json`],
        'caller sort (cardURL desc) wins; rank-desc default does not apply',
      );
    });

    test('rank-desc fires when matches is nested inside any', async function (assert) {
      let { cards } = await engine.searchCards(new URL(testRealmURL), {
        filter: {
          any: [{ matches: 'puppy' }, { matches: 'drums' }],
        },
      });
      let urls = cards.map((c) => c.id);
      assert.strictEqual(urls.length, 3, 'all three rows match the any clause');
      assert.strictEqual(
        urls[0],
        `${testRealmURL}mango.json`,
        'mango (3 hits on "puppy") leads by rank-desc even though nested',
      );
    });

    test('rank-desc fires when matches is nested inside every', async function (assert) {
      let { cards } = await engine.searchCards(new URL(testRealmURL), {
        filter: {
          every: [{ matches: 'puppy' }],
        },
      });
      let urls = cards.map((c) => c.id);
      assert.deepEqual(
        urls,
        [`${testRealmURL}mango.json`, `${testRealmURL}vangogh.json`],
        'rank-desc applies through nested every',
      );
    });

    test('no matches in tree: URL ordering is preserved', async function (assert) {
      // With no `matches`, only URL-order applies. mango < ringo < vangogh
      // alphabetically. Use a filter that returns all rows so ordering is
      // observable.
      let { cards } = await engine.searchCards(new URL(testRealmURL), {});
      let urls = cards.map((c) => c.id);
      assert.deepEqual(
        urls,
        [
          `${testRealmURL}mango.json`,
          `${testRealmURL}ringo.json`,
          `${testRealmURL}vangogh.json`,
        ],
        'URL ordering (alphabetical POSIX) when no matches and no sort',
      );
    });

    test('empty matches query skips the rank clause (falls back to URL order)', async function (assert) {
      // Empty matches short-circuits to FALSE so no rows return. Verify
      // that the query still runs (doesn't crash constructing an empty
      // tsquery in ORDER BY).
      let { cards, meta } = await engine.searchCards(new URL(testRealmURL), {
        filter: { matches: '' },
      });
      assert.strictEqual(meta.page.total, 0, 'empty query matches nothing');
      assert.strictEqual(cards.length, 0);
    });
  });
});
