import { module, test } from 'qunit';

import { getTypeRefsFromFilter } from '@cardstack/runtime-common';

const typeRef = { module: 'https://example.com/card', name: 'MyCard' };
const typeRef2 = { module: 'https://example.com/card', name: 'OtherCard' };

module('Unit | getTypeRefsFromFilter', function () {
  test('returns CodeRef[] from top-level `on` (EveryFilter with scoping)', function (assert) {
    // This is the chooseCard/specRef case where on is set at the filter root
    let filter = { every: [], on: typeRef };
    assert.deepEqual(getTypeRefsFromFilter(filter), [typeRef]);
  });

  test('returns CodeRef[] from a top-level CardTypeFilter', function (assert) {
    // This is the linksTo case: { type: CodeRef }
    let filter = { type: typeRef };
    assert.deepEqual(getTypeRefsFromFilter(filter), [typeRef]);
  });

  test('returns CodeRef[] from EveryFilter containing a CardTypeFilter', function (assert) {
    // This is the linksToMany case
    let filter = {
      every: [{ type: typeRef }, { contains: { cardTitle: 'foo' } }],
    };
    assert.deepEqual(getTypeRefsFromFilter(filter), [typeRef]);
  });

  test('returns CodeRef[] from AnyFilter containing a single CardTypeFilter', function (assert) {
    let filter = { any: [{ type: typeRef }] };
    assert.deepEqual(getTypeRefsFromFilter(filter), [typeRef]);
  });

  test('returns CodeRef[] from AnyFilter containing multiple CardTypeFilters', function (assert) {
    let filter = { any: [{ type: typeRef }, { type: typeRef2 }] };
    assert.deepEqual(getTypeRefsFromFilter(filter), [typeRef, typeRef2]);
  });

  test('returns undefined for ContainsFilter with no type info', function (assert) {
    let filter = { contains: { cardTitle: 'foo' } };
    assert.strictEqual(getTypeRefsFromFilter(filter), undefined);
  });

  test('returns undefined for EveryFilter with no CardTypeFilter inside', function (assert) {
    let filter = {
      every: [{ contains: { cardTitle: 'foo' } }, { eq: { status: 'active' } }],
    };
    assert.strictEqual(getTypeRefsFromFilter(filter), undefined);
  });

  test('returns undefined for AnyFilter with no CardTypeFilter inside', function (assert) {
    let filter = {
      any: [{ contains: { cardTitle: 'foo' } }, { eq: { status: 'active' } }],
    };
    assert.strictEqual(getTypeRefsFromFilter(filter), undefined);
  });
});
