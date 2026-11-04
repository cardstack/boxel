import { module, test } from 'qunit';

import { isAimingAt } from '@cardstack/host/components/operator-mode/dashboard/menu-aim';

// A flyout to the right of the rail, from (100, 0) to (300, 200).
const FLYOUT = new DOMRect(100, 0, 200, 200);

module('Unit | dashboard menu aim', function () {
  test('a pointer moving toward the flyout is aiming at it', function (assert) {
    assert.true(isAimingAt({ x: 10, y: 150 }, { x: 30, y: 160 }, FLYOUT));
    assert.true(isAimingAt({ x: 10, y: 100 }, { x: 40, y: 100 }, FLYOUT));
  });

  test('a pointer moving away from the flyout is not', function (assert) {
    assert.false(isAimingAt({ x: 30, y: 100 }, { x: 10, y: 100 }, FLYOUT));
  });

  test('a pointer moving straight down the rail is not', function (assert) {
    assert.false(isAimingAt({ x: 20, y: 100 }, { x: 20, y: 140 }, FLYOUT));
  });

  test('a pointer already over the flyout is not', function (assert) {
    assert.false(isAimingAt({ x: 90, y: 100 }, { x: 120, y: 100 }, FLYOUT));
  });
});
