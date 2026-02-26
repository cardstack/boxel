import { module, test } from 'qunit';

import { getTypeRefFromFilter } from '@cardstack/runtime-common';

const typeRef = { module: 'https://example.com/card', name: 'MyCard' };

module('Unit | getTypeRefFromFilter', function () {
  test('returns CodeRef from top-level `on` (EveryFilter with scoping)', function (assert) {
    // This is the chooseCard/specRef case where on is set at the filter root
    let filter = { every: [], on: typeRef };
    assert.deepEqual(getTypeRefFromFilter(filter), typeRef);
  });

  test('returns CodeRef from a top-level CardTypeFilter', function (assert) {
    // This is the linksTo case: { type: CodeRef }
    let filter = { type: typeRef };
    assert.deepEqual(getTypeRefFromFilter(filter), typeRef);
  });

  test('returns CodeRef from EveryFilter containing a CardTypeFilter', function (assert) {
    // This is the linksToMany case
    let filter = {
      every: [{ type: typeRef }, { contains: { cardTitle: 'foo' } }],
    };
    assert.deepEqual(getTypeRefFromFilter(filter), typeRef);
  });

  test('returns undefined for ContainsFilter with no type info', function (assert) {
    let filter = { contains: { cardTitle: 'foo' } };
    assert.strictEqual(getTypeRefFromFilter(filter), undefined);
  });

  test('returns undefined for EveryFilter with no CardTypeFilter inside', function (assert) {
    let filter = {
      every: [{ contains: { cardTitle: 'foo' } }, { eq: { status: 'active' } }],
    };
    assert.strictEqual(getTypeRefFromFilter(filter), undefined);
  });
});
