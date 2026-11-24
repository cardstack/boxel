import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import type { CodeRef } from '@cardstack/runtime-common';
import type { Filter } from '@cardstack/runtime-common/query-v2/query';
import { filterWithout } from '@cardstack/runtime-common/query-engine/facet-sql';

// The filter an `own: 'ignore'` facet counts over: the query's filter
// without the nodes that test only the facet's field. A filter that tests
// the field nowhere is the filter itself, whatever it is built of; an `any`
// whose conjunctions test other fields keeps every branch.

const on = {
  module: 'http://test-realm/shop',
  name: 'Product',
} as unknown as CodeRef;
const red = { eq: { color: 'red' } } as Filter;
const blue = { eq: { color: 'blue' } } as Filter;
const draft = { eq: { status: 'draft' } } as Filter;

module(basename(import.meta.filename), function () {
  test('a filter that does not test the field is the filter itself', function (assert) {
    let filters: Filter[] = [
      { any: [{ every: [red, draft] }, { every: [blue] }] } as Filter,
      { on, any: [{ every: [red, draft] }, { every: [blue] }] } as Filter,
      { every: [{ any: [{ every: [red, draft] }, blue] }, draft] } as Filter,
      { not: { every: [red, draft] } } as Filter,
      { any: [{ every: [{ type: on }, { not: { any: [red] } }] }] } as Filter,
    ];
    for (let filter of filters) {
      assert.strictEqual(
        filterWithout(filter, 'productType'),
        filter,
        JSON.stringify(filter),
      );
    }
  });

  test("an any of conjunctions keeps every branch, without the field's tests", function (assert) {
    let filter = {
      any: [{ every: [red, draft] }, { every: [blue, draft] }],
    } as Filter;
    assert.deepEqual(filterWithout(filter, 'color'), {
      any: [{ every: [draft] }, { every: [draft] }],
    });
    assert.deepEqual(
      filterWithout(
        { on, any: [{ every: [red] }, { every: [blue] }] } as Filter,
        'color',
      ),
      { type: on },
      'every branch tested only the field: the type alone',
    );
  });

  test('a conjunction loses only the tests of the field', function (assert) {
    assert.deepEqual(
      filterWithout({ every: [red, draft] } as Filter, 'color'),
      { every: [draft] },
    );
    assert.strictEqual(
      filterWithout({ every: [red] } as Filter, 'color'),
      undefined,
    );
  });
});
