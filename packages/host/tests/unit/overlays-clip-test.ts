import { module, test } from 'qunit';

import { stickyHeaderClipPath } from '@cardstack/host/components/operator-mode/overlays';

module('Unit | overlays | stickyHeaderClipPath', function () {
  test('no clip while the card sits below the sticky header', function (assert) {
    // Card top (100) is below the header bottom (50): nothing is occluded.
    assert.strictEqual(stickyHeaderClipPath(100, 50), '');
  });

  test('no clip when the card top is flush with the header bottom', function (assert) {
    assert.strictEqual(stickyHeaderClipPath(50, 50), '');
  });

  test('clips the strip that has slid behind the header', function (assert) {
    // Card top (20) is 30px above the header bottom (50): clip the top 30px,
    // extending the other edges so the box-shadow ring survives on the
    // still-visible portion.
    assert.strictEqual(
      stickyHeaderClipPath(20, 50),
      'inset(30px -0.5rem -0.5rem -0.5rem)',
    );
  });

  test('clamps to no clip when the card top is far below the header', function (assert) {
    assert.strictEqual(stickyHeaderClipPath(500, 50), '');
  });
});
