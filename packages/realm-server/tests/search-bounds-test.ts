import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import {
  applySearchPageBound,
  applyServerSearchPageBound,
  assertRealmsBound,
  isItemLegSearch,
  runWithSearchTimeBudget,
  setSearchBoundsForTests,
  resetSearchBoundsForTests,
  SearchBoundError,
  MAX_SEARCH_PAGE_SIZE,
  SERVER_MAX_SEARCH_PAGE_SIZE,
  MAX_REALMS_PER_SEARCH_REQUEST,
  type Query,
} from '@cardstack/runtime-common';
import type { SearchEntryFieldset } from '@cardstack/runtime-common';

const htmlLeg: SearchEntryFieldset = {
  html: true,
  item: { kind: 'none' },
  itemAsFallback: true,
};
const itemLegFull: SearchEntryFieldset = {
  html: false,
  item: { kind: 'full' },
  itemAsFallback: false,
};
const itemLegSparse: SearchEntryFieldset = {
  html: false,
  item: { kind: 'sparse', fields: ['title'] },
  itemAsFallback: false,
};

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module(basename(import.meta.filename), function (hooks) {
  hooks.afterEach(function () {
    resetSearchBoundsForTests();
  });

  module('isItemLegSearch', function () {
    test('the prerendered/default fieldset (kind none) is not the item leg', function (assert) {
      assert.false(isItemLegSearch(htmlLeg));
    });

    test('an explicit item / item.<field> fieldset is the item leg', function (assert) {
      assert.true(isItemLegSearch(itemLegFull));
      assert.true(isItemLegSearch(itemLegSparse));
    });
  });

  module('applySearchPageBound', function () {
    test('an absent page is clamped to the max (mandatory pagination)', function (assert) {
      let bounded = applySearchPageBound({ filter: { eq: {} } } as Query);
      assert.deepEqual(
        bounded.page,
        { size: MAX_SEARCH_PAGE_SIZE },
        'a default page size is injected',
      );
    });

    test('a page at or under the max passes through unchanged', function (assert) {
      let query = { page: { size: MAX_SEARCH_PAGE_SIZE, number: 2 } } as Query;
      assert.strictEqual(applySearchPageBound(query), query);
    });

    test('a page object with a missing size is clamped, not left unbounded', function (assert) {
      let bounded = applySearchPageBound({
        page: { number: 0 },
      } as unknown as Query);
      assert.deepEqual(
        bounded.page,
        { number: 0, size: MAX_SEARCH_PAGE_SIZE },
        'the cap is injected and page.number is preserved',
      );
    });

    test('a non-positive page.size is clamped, not left unbounded', function (assert) {
      for (let bad of [-1, 0]) {
        let bounded = applySearchPageBound({ page: { size: bad } } as Query);
        assert.strictEqual(
          bounded.page?.size,
          MAX_SEARCH_PAGE_SIZE,
          `size ${bad} is clamped to the cap`,
        );
      }
    });

    test('an explicit page.size over the max is rejected with a 400', function (assert) {
      try {
        applySearchPageBound({
          page: { size: MAX_SEARCH_PAGE_SIZE + 1 },
        } as Query);
        assert.ok(false, 'expected a SearchBoundError');
      } catch (e) {
        assert.true(e instanceof SearchBoundError);
        assert.strictEqual((e as SearchBoundError).status, 400);
      }
    });

    test('a numeric-string page.size over the max is also rejected', function (assert) {
      try {
        applySearchPageBound({
          page: { size: String(MAX_SEARCH_PAGE_SIZE + 500) },
        } as unknown as Query);
        assert.ok(false, 'expected a SearchBoundError');
      } catch (e) {
        assert.true(e instanceof SearchBoundError);
        assert.strictEqual((e as SearchBoundError).status, 400);
      }
    });

    test('the override lowers the effective cap', function (assert) {
      setSearchBoundsForTests({ maxPageSize: 10 });
      assert.throws(
        () => applySearchPageBound({ page: { size: 11 } } as Query),
        (e: Error) => e instanceof SearchBoundError,
      );
      let clamped = applySearchPageBound({} as Query);
      assert.deepEqual(clamped.page, { size: 10 });
    });
  });

  module('applyServerSearchPageBound', function () {
    test('the server ceiling is higher than the card @context cap', function (assert) {
      assert.true(
        SERVER_MAX_SEARCH_PAGE_SIZE > MAX_SEARCH_PAGE_SIZE,
        'the server backstop lets the host page larger than a card',
      );
    });

    test('a page at or under the server ceiling passes through unchanged', function (assert) {
      let query = { page: { size: SERVER_MAX_SEARCH_PAGE_SIZE } } as Query;
      assert.strictEqual(applyServerSearchPageBound(query), query);
    });

    test('an absent page is clamped to the server ceiling', function (assert) {
      let bounded = applyServerSearchPageBound({ filter: { eq: {} } } as Query);
      assert.deepEqual(bounded.page, { size: SERVER_MAX_SEARCH_PAGE_SIZE });
    });

    test('an explicit page over the server ceiling is rejected with a 400', function (assert) {
      try {
        applyServerSearchPageBound({
          page: { size: SERVER_MAX_SEARCH_PAGE_SIZE + 1 },
        } as Query);
        assert.ok(false, 'expected a SearchBoundError');
      } catch (e) {
        assert.true(e instanceof SearchBoundError);
        assert.strictEqual((e as SearchBoundError).status, 400);
      }
    });

    test('a page allowed by the server ceiling can still exceed the card cap', function (assert) {
      // The same page the card cap would reject is fine at the server ceiling —
      // this is what lets the trusted host page larger than a card.
      let query = { page: { size: MAX_SEARCH_PAGE_SIZE + 1 } } as Query;
      assert.throws(
        () => applySearchPageBound(query),
        (e: Error) => e instanceof SearchBoundError,
        'the card cap rejects it',
      );
      assert.strictEqual(
        applyServerSearchPageBound(query),
        query,
        'the server ceiling passes it through',
      );
    });

    test('the override lowers the effective server ceiling independently', function (assert) {
      setSearchBoundsForTests({ serverMaxPageSize: 3 });
      assert.throws(
        () => applyServerSearchPageBound({ page: { size: 4 } } as Query),
        (e: Error) => e instanceof SearchBoundError,
      );
      let clamped = applyServerSearchPageBound({} as Query);
      assert.deepEqual(clamped.page, { size: 3 });
    });
  });

  module('assertRealmsBound', function () {
    test('a request at the cap is allowed', function (assert) {
      let realms = Array.from(
        { length: MAX_REALMS_PER_SEARCH_REQUEST },
        (_v, i) => `http://r${i}/`,
      );
      assert.strictEqual(assertRealmsBound(realms), undefined);
    });

    test('a request over the cap is rejected with a 400', function (assert) {
      let realms = Array.from(
        { length: MAX_REALMS_PER_SEARCH_REQUEST + 1 },
        (_v, i) => `http://r${i}/`,
      );
      try {
        assertRealmsBound(realms);
        assert.ok(false, 'expected a SearchBoundError');
      } catch (e) {
        assert.true(e instanceof SearchBoundError);
        assert.strictEqual((e as SearchBoundError).status, 400);
      }
    });
  });

  module('runWithSearchTimeBudget', function () {
    test('a search that finishes within budget returns its value', async function (assert) {
      let result = await runWithSearchTimeBudget(async () => {
        await wait(5);
        return 'ok';
      }, 1000);
      assert.strictEqual(result, 'ok');
    });

    test('an over-budget search is cut off with a 408 and the signal aborts', async function (assert) {
      let aborted = false;
      try {
        await runWithSearchTimeBudget(async (signal) => {
          signal.addEventListener('abort', () => {
            aborted = true;
          });
          await wait(200);
          return 'too-late';
        }, 20);
        assert.ok(false, 'expected a SearchBoundError');
      } catch (e) {
        assert.true(e instanceof SearchBoundError);
        assert.strictEqual((e as SearchBoundError).status, 408);
      }
      assert.true(aborted, 'the runner signal was aborted on timeout');
    });
  });
});
