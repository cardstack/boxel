import { module, test } from 'qunit';

import {
  baseCardRef,
  specRef,
  type Filter,
  type Sort,
} from '@cardstack/runtime-common';

import type { SortOption } from '@cardstack/host/components/card-search/constants';

import {
  buildSearchQuery,
  shouldSkipSearchQuery,
} from '@cardstack/host/utils/card-search/query-builder';

const SORT_AZ: SortOption = {
  displayName: 'A-Z',
  sort: [{ by: 'cardTitle', direction: 'asc' }] as Sort,
};

module('Unit | card-search/query-builder', function () {
  module('buildSearchQuery', function () {
    test('empty search key with no baseFilter collapses to the single not-spec filter', function (assert) {
      let query = buildSearchQuery('', SORT_AZ);
      assert.deepEqual(query, {
        filter: { not: { type: specRef } },
        sort: SORT_AZ.sort,
      });
    });

    test('non-empty search key with no baseFilter produces a matches filter (not contains/cardTitle)', function (assert) {
      let query = buildSearchQuery('xylophone', SORT_AZ);
      assert.deepEqual(query, {
        filter: {
          every: [{ not: { type: specRef } }, { matches: 'xylophone' }],
        },
        sort: SORT_AZ.sort,
      });
    });

    test('whitespace-only search key is treated as empty', function (assert) {
      let query = buildSearchQuery('   ', SORT_AZ);
      assert.deepEqual(query, {
        filter: { not: { type: specRef } },
        sort: SORT_AZ.sort,
      });
    });

    test('baseFilter alone returns that filter without matches', function (assert) {
      let baseFilter: Filter = { type: baseCardRef };
      let query = buildSearchQuery('', SORT_AZ, baseFilter);
      assert.deepEqual(query, {
        filter: baseFilter,
        sort: SORT_AZ.sort,
      });
    });

    test('baseFilter with non-empty search wraps in every and adds matches (not title contains)', function (assert) {
      let baseFilter: Filter = { type: baseCardRef };
      let query = buildSearchQuery('puppy', SORT_AZ, baseFilter);
      assert.deepEqual(query, {
        filter: {
          every: [baseFilter, { matches: 'puppy' }],
        },
        sort: SORT_AZ.sort,
      });
    });

    test('search with a selected type produces a type filter alongside matches', function (assert) {
      let authorRef = {
        module: 'http://test-realm/test/author',
        name: 'Author',
      };
      let typeKey = `${authorRef.module}/${authorRef.name}`;
      let query = buildSearchQuery('droid', SORT_AZ, undefined, [typeKey]);
      assert.deepEqual(query, {
        filter: {
          every: [
            { not: { type: specRef } },
            { type: authorRef },
            { matches: 'droid' },
          ],
        },
        sort: SORT_AZ.sort,
      });
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
