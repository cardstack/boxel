import { module, test } from 'qunit';

import {
  baseCardRef,
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
              any: [
                { matches: 'xylophone' },
                { contains: { _title: 'xylophone' } },
              ],
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

    test('a positively-typed baseFilter passes through alone — the picked type already selects one kind', function (assert) {
      let baseFilter: Filter = { type: baseCardRef };
      let query = buildSearchQuery('', SORT_AZ, baseFilter);
      assert.deepEqual(query, {
        filter: baseFilter,
        sort: SORT_AZ.sort,
      });
    });

    test('baseFilter with non-empty search wraps in every and OR-combines matches + _title', function (assert) {
      let baseFilter: Filter = { type: baseCardRef };
      let query = buildSearchQuery('puppy', SORT_AZ, baseFilter);
      assert.deepEqual(query, {
        filter: {
          every: [
            baseFilter,
            {
              any: [{ matches: 'puppy' }, { contains: { _title: 'puppy' } }],
            },
          ],
        },
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
              any: [{ matches: 'droid' }, { contains: { _title: 'droid' } }],
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

    test('a term filters recents by _title substring only (no full-text matches)', function (assert) {
      let query = buildRecentsQuery('mango', SORT_AZ);
      assert.deepEqual(query, {
        filter: {
          every: [
            { not: { type: specRef } },
            { contains: { _title: 'mango' } },
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

    test('the mixed default leaves the scope unset (all)', function (assert) {
      assert.strictEqual(searchScopeForOptions({}), undefined);
      assert.strictEqual(searchScopeForOptions(undefined), undefined);
      assert.strictEqual(
        searchScopeForOptions({ cardsOnly: false }),
        undefined,
      );
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
