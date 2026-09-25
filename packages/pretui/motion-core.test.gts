import { module, test } from 'qunit';
import { normalizeRootMargin } from './motion-core';

module('Pretui | InView rootMargin', function () {
  test('preserves valid CSS IntersectionObserver margins', function (assert) {
    assert.strictEqual(normalizeRootMargin('12px'), '12px');
    assert.strictEqual(normalizeRootMargin('-10% +2.5px'), '-10% +2.5px');
    assert.strictEqual(
      normalizeRootMargin('0px 0px -12% .5px'),
      '0px 0px -12% .5px',
    );
    assert.strictEqual(normalizeRootMargin('  1px   2%  '), '1px 2%');
  });

  test('falls back safely for invalid or unsupported margins', function (assert) {
    assert.strictEqual(normalizeRootMargin(undefined), '0px');
    assert.strictEqual(normalizeRootMargin(''), '0px');
    assert.strictEqual(normalizeRootMargin('12'), '0px');
    assert.strictEqual(normalizeRootMargin('1em'), '0px');
    assert.strictEqual(normalizeRootMargin('calc(1px + 2%)'), '0px');
    assert.strictEqual(normalizeRootMargin('1px 2px 3px 4px 5px'), '0px');
    assert.strictEqual(normalizeRootMargin('0px nope'), '0px');
  });
});
