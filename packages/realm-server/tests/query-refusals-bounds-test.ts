import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import type { Query } from '@cardstack/runtime-common';
import {
  applySearchPageBound,
  applyServerSearchPageBound,
} from '@cardstack/runtime-common/search-bounds';
import { type Mistake, T, table, top } from './helpers/query-refusals.ts';

// What a malformed query is refused with, for page bounds. See
// query-refusals-test.ts for how a row is read.

// ---- a wrong kind of value, member by member ------------------------------

const WRONG_KIND: Mistake[] = [
  ...['all', true, null, 3].map((v) => ({
    name: `page.total: ${JSON.stringify(v)}`,
    query: top({ page: { size: 10, total: v } }),
    code: 'invalid-page',
  })),
];

module(basename(import.meta.filename), function () {
  module('refused at validation', function () {
    table('a wrong kind of value', WRONG_KIND);

    test('[validation] a card search over the page limit is refused with a code; a request is clamped', function (assert) {
      // "A card search that names none gets the first 100, which is also
      // the most a card search may ask for."
      let query = { filter: { type: T }, page: { size: 101 } } as Query;
      let error: unknown;
      try {
        applySearchPageBound(query);
      } catch (e) {
        error = e;
      }
      assert.ok(error, 'a page of 101 is refused');
      assert.strictEqual(
        typeof (error as { code?: unknown } | undefined)?.code,
        'string',
        `the refusal has a code (${String((error as Error | undefined)?.message).slice(0, 100)})`,
      );
      assert.strictEqual(
        applySearchPageBound({
          filter: { type: T },
          page: { size: 100 },
        } as Query).page?.size,
        100,
        'a page of 100 is as asked',
      );
      // "A `_search` … request that names a size takes up to 2,000, clamped
      // above that."
      assert.strictEqual(
        applyServerSearchPageBound({
          filter: { type: T },
          page: { size: 1_000_000 },
        } as Query).page?.size,
        2000,
        'a request for a million rows gets 2,000',
      );
    });
  });
});
