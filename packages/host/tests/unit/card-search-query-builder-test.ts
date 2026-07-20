import { module, test } from 'qunit';

import {
  baseCardRef,
  baseRef,
  excludeCardInstanceFileRows,
  specRef,
  type Filter,
  type RealmResourceIdentifier,
  type Sort,
} from '@cardstack/runtime-common';

import type { SortOption } from '@cardstack/host/components/card-search/constants';

import {
  buildRecentsQuery,
  buildSearchQuery,
  searchScopeForOptions,
  shouldSkipSearchQuery,
} from '@cardstack/host/utils/card-search/query-builder';

const SORT_AZ: SortOption = {
  displayName: 'A-Z',
  sort: [{ by: 'cardTitle', direction: 'asc' }] as Sort,
};

// The mixed-search (`scope: 'all'`) dedup: drops a card `.json`'s dual-indexed
// file row while keeping cards and plain files. Restricting to a single kind is
// a wire-`scope` concern (see searchScopeForOptions), not a filter.
const DEDUP_FILTER: Filter = excludeCardInstanceFileRows();

// A title term matches `_title` plus the legacy `cardTitle` backward-compat
// fallback (present until every realm is reindexed — see buildTitleTermFilters).
function titleBranches(term: string): Filter[] {
  return [{ contains: { _title: term } }, { contains: { cardTitle: term } }];
}

module('Unit | card-search/query-builder', function () {
  module('buildSearchQuery', function () {
    test('empty search key with no baseFilter combines not-spec with the card-json dedup', function (assert) {
      let query = buildSearchQuery('', SORT_AZ);
      assert.deepEqual(query, {
        filter: { every: [{ not: { type: specRef } }, DEDUP_FILTER] },
        sort: SORT_AZ.sort,
      });
    });

    test('non-empty search key with no baseFilter OR-combines matches with a _title substring', function (assert) {
      let query = buildSearchQuery('xylophone', SORT_AZ);
      assert.deepEqual(query, {
        filter: {
          every: [
            { not: { type: specRef } },
            {
              any: [{ matches: 'xylophone' }, ...titleBranches('xylophone')],
            },
            DEDUP_FILTER,
          ],
        },
        sort: SORT_AZ.sort,
      });
    });

    test('whitespace-only search key is treated as empty', function (assert) {
      let query = buildSearchQuery('   ', SORT_AZ);
      assert.deepEqual(query, {
        filter: { every: [{ not: { type: specRef } }, DEDUP_FILTER] },
        sort: SORT_AZ.sort,
      });
    });

    test('a narrowing-typed baseFilter passes through alone — the picked type already selects one kind', function (assert) {
      let baseFilter: Filter = {
        type: {
          module: 'http://test-realm/test/author' as RealmResourceIdentifier,
          name: 'Author',
        },
      };
      let query = buildSearchQuery('', SORT_AZ, baseFilter);
      assert.deepEqual(query, {
        filter: baseFilter,
        sort: SORT_AZ.sort,
      });
    });

    test('narrowing baseFilter with non-empty search wraps in every and OR-combines matches + _title', function (assert) {
      let baseFilter: Filter = {
        type: {
          module: 'http://test-realm/test/author' as RealmResourceIdentifier,
          name: 'Author',
        },
      };
      let query = buildSearchQuery('puppy', SORT_AZ, baseFilter);
      assert.deepEqual(query, {
        filter: {
          every: [
            baseFilter,
            {
              any: [{ matches: 'puppy' }, ...titleBranches('puppy')],
            },
          ],
        },
        sort: SORT_AZ.sort,
      });
    });

    test('a kind-spanning root baseFilter keeps the card-json dedup', function (assert) {
      // The search sheet's base filter: BaseDef spans cards and files, so a
      // card's dual-indexed `.json` file row matches it too and must still be
      // deduped — unlike a narrowing type, a root ref doesn't select one kind.
      let baseFilter: Filter = { type: baseRef };
      let query = buildSearchQuery('mango', SORT_AZ, baseFilter);
      assert.deepEqual(query, {
        filter: {
          every: [
            baseFilter,
            {
              any: [{ matches: 'mango' }, ...titleBranches('mango')],
            },
            DEDUP_FILTER,
          ],
        },
        sort: SORT_AZ.sort,
      });
    });

    test('root refs inside a compound baseFilter also keep the dedup', function (assert) {
      let baseFilter: Filter = {
        any: [{ type: baseCardRef }, { type: baseRef }],
      };
      let query = buildSearchQuery('', SORT_AZ, baseFilter);
      assert.deepEqual(query, {
        filter: { every: [baseFilter, DEDUP_FILTER] },
        sort: SORT_AZ.sort,
      });
    });

    test('a picked type strips the root baseFilter and skips the dedup', function (assert) {
      let markdownRef = {
        module:
          'https://cardstack.com/base/markdown-file-def' as RealmResourceIdentifier,
        name: 'MarkdownDef',
      };
      let typeKey = `${markdownRef.module}/${markdownRef.name}`;
      let query = buildSearchQuery('', SORT_AZ, { type: baseRef }, [typeKey]);
      assert.deepEqual(
        query,
        {
          filter: { type: markdownRef },
          sort: SORT_AZ.sort,
        },
        'the picked file type must stay free to surface card .json file rows',
      );
    });

    test('a picked ROOT type keeps the card-json dedup', function (assert) {
      // The chooser seeds the type picker from its base filter, so a root base
      // filter (BaseDef) becomes a *selected* root type. A root selection still
      // spans both kinds, so — unlike a narrowing type pick — the card-`.json`
      // dedup must remain. Regression: treating any selected type as narrowing
      // dropped the dedup here, leaking a card's `.json` file row into the
      // mixed chooser (a duplicate of the card's instance row).
      let typeKey = `${baseRef.module}/${baseRef.name}`;
      let query = buildSearchQuery('', SORT_AZ, { type: baseRef }, [typeKey]);
      assert.deepEqual(query, {
        filter: { every: [{ type: baseRef }, DEDUP_FILTER] },
        sort: SORT_AZ.sort,
      });
    });

    test('search with a selected type produces a type filter alongside the search-term filter', function (assert) {
      let authorRef = {
        module: 'http://test-realm/test/author' as RealmResourceIdentifier,
        name: 'Author',
      };
      let typeKey = `${authorRef.module}/${authorRef.name}`;
      let query = buildSearchQuery('droid', SORT_AZ, undefined, [typeKey]);
      assert.deepEqual(query, {
        filter: {
          every: [
            { not: { type: specRef } },
            { type: authorRef },
            {
              any: [{ matches: 'droid' }, ...titleBranches('droid')],
            },
          ],
        },
        sort: SORT_AZ.sort,
      });
    });

    test('cardsOnly adds no filter anchor — the card scope is pinned on the wire', function (assert) {
      let query = buildSearchQuery('', SORT_AZ, undefined, undefined, {
        cardsOnly: true,
      });
      assert.deepEqual(
        query,
        {
          filter: { not: { type: specRef } },
          sort: SORT_AZ.sort,
        },
        'no baseCardRef anchor and no dedup filter — scope: cards handles it',
      );
    });

    test('cardsOnly with a positively-typed baseFilter passes the filter through unchanged', function (assert) {
      let authorRef = {
        module: 'http://test-realm/test/author' as RealmResourceIdentifier,
        name: 'Author',
      };
      let baseFilter: Filter = { type: authorRef };
      let query = buildSearchQuery('', SORT_AZ, baseFilter, undefined, {
        cardsOnly: true,
      });
      assert.deepEqual(query, {
        filter: baseFilter,
        sort: SORT_AZ.sort,
      });
    });
  });

  module('buildRecentsQuery', function () {
    test('no term with no baseFilter combines not-spec with the card-json dedup', function (assert) {
      let query = buildRecentsQuery(undefined, SORT_AZ);
      assert.deepEqual(query, {
        filter: { every: [{ not: { type: specRef } }, DEDUP_FILTER] },
        sort: SORT_AZ.sort,
      });
    });

    test('a term filters recents by title substring only (no full-text matches)', function (assert) {
      let query = buildRecentsQuery('mango', SORT_AZ);
      assert.deepEqual(query, {
        filter: {
          every: [
            { not: { type: specRef } },
            { any: titleBranches('mango') },
            DEDUP_FILTER,
          ],
        },
        sort: SORT_AZ.sort,
      });
    });

    test('cardsOnly adds no filter anchor to recents — the card scope is pinned on the wire', function (assert) {
      let query = buildRecentsQuery(undefined, SORT_AZ, undefined, undefined, {
        cardsOnly: true,
      });
      assert.deepEqual(query, {
        filter: { not: { type: specRef } },
        sort: SORT_AZ.sort,
      });
    });
  });

  module('searchScopeForOptions', function () {
    test('cardsOnly maps to the "cards" wire scope', function (assert) {
      assert.strictEqual(searchScopeForOptions({ cardsOnly: true }), 'cards');
    });

    test('anything else is the mixed "all" wire scope', function (assert) {
      assert.strictEqual(searchScopeForOptions({}), 'all');
      assert.strictEqual(searchScopeForOptions(undefined), 'all');
      assert.strictEqual(searchScopeForOptions({ cardsOnly: false }), 'all');
    });
  });

  module('shouldSkipSearchQuery', function () {
    test('empty search key with no baseFilter is skipped', function (assert) {
      assert.true(shouldSkipSearchQuery(''));
      assert.true(shouldSkipSearchQuery('   '));
    });

    test('non-empty search key with no baseFilter runs', function (assert) {
      assert.false(shouldSkipSearchQuery('mango'));
    });

    test('empty search key with baseFilter still runs (modal mode)', function (assert) {
      let baseFilter: Filter = { type: baseCardRef };
      assert.false(shouldSkipSearchQuery('', baseFilter));
    });

    test('URL-like search key is always skipped (handled separately)', function (assert) {
      assert.true(shouldSkipSearchQuery('http://test-realm/test/card'));
      let baseFilter: Filter = { type: baseCardRef };
      assert.true(
        shouldSkipSearchQuery('http://test-realm/test/card', baseFilter),
      );
    });
  });
});
