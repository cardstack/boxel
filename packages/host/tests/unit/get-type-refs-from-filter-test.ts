import { module, test } from 'qunit';

import { getTypeRefsFromFilter } from '@cardstack/runtime-common';

const typeRef = { module: 'https://example.com/card', name: 'MyCard' };
const typeRef2 = { module: 'https://example.com/card', name: 'OtherCard' };

module('Unit | getTypeRefsFromFilter', function () {
  test('returns result from top-level `on` (EveryFilter with scoping)', function (assert) {
    let filter = { every: [], on: typeRef };
    assert.deepEqual(getTypeRefsFromFilter(filter), [
      { ref: typeRef, negated: false },
    ]);
  });

  test('returns result from a top-level CardTypeFilter', function (assert) {
    let filter = { type: typeRef };
    assert.deepEqual(getTypeRefsFromFilter(filter), [
      { ref: typeRef, negated: false },
    ]);
  });

  test('returns result from EveryFilter containing a CardTypeFilter', function (assert) {
    let filter = {
      every: [{ type: typeRef }, { contains: { cardTitle: 'foo' } }],
    };
    assert.deepEqual(getTypeRefsFromFilter(filter), [
      { ref: typeRef, negated: false },
    ]);
  });

  test('returns result from AnyFilter containing a single CardTypeFilter', function (assert) {
    let filter = { any: [{ type: typeRef }] };
    assert.deepEqual(getTypeRefsFromFilter(filter), [
      { ref: typeRef, negated: false },
    ]);
  });

  test('returns results from AnyFilter containing multiple CardTypeFilters', function (assert) {
    let filter = { any: [{ type: typeRef }, { type: typeRef2 }] };
    assert.deepEqual(getTypeRefsFromFilter(filter), [
      { ref: typeRef, negated: false },
      { ref: typeRef2, negated: false },
    ]);
  });

  test('returns negated result from NotFilter containing a CardTypeFilter', function (assert) {
    let filter = { not: { type: typeRef } };
    assert.deepEqual(getTypeRefsFromFilter(filter), [
      { ref: typeRef, negated: true },
    ]);
  });

  test('returns negated results from NotFilter wrapping an AnyFilter with multiple types', function (assert) {
    let filter = { not: { any: [{ type: typeRef }, { type: typeRef2 }] } };
    assert.deepEqual(getTypeRefsFromFilter(filter), [
      { ref: typeRef, negated: true },
      { ref: typeRef2, negated: true },
    ]);
  });

  test('double negation (NotFilter inside NotFilter) restores negated: false', function (assert) {
    let filter = { not: { not: { type: typeRef } } };
    assert.deepEqual(getTypeRefsFromFilter(filter), [
      { ref: typeRef, negated: false },
    ]);
  });

  test('collects refs from nested EveryFilter inside AnyFilter', function (assert) {
    let filter = {
      any: [{ every: [{ type: typeRef }] }, { type: typeRef2 }],
    };
    assert.deepEqual(getTypeRefsFromFilter(filter), [
      { ref: typeRef, negated: false },
      { ref: typeRef2, negated: false },
    ]);
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

  test('returns undefined for NotFilter with no type info inside', function (assert) {
    let filter = { not: { contains: { cardTitle: 'foo' } } };
    assert.strictEqual(getTypeRefsFromFilter(filter), undefined);
  });
});
