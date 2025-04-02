import { module, test } from 'qunit';

import { getContrastColor } from '@cardstack/boxel-ui/helpers';

module('Unit | contrast-color test', function () {
  const darkText = 'var(--boxel-dark, #000000)';
  const lightText = 'var(--boxel-light, #ffffff)';

  test('returns light-color given black', function (assert) {
    const color = getContrastColor('#000000');
    assert.strictEqual(color, lightText);
  });

  test('returns dark-color given white', function (assert) {
    const color = getContrastColor('#fff');
    assert.strictEqual(color, darkText);
  });

  test('can handle 3-digit hex value', function (assert) {
    const color = getContrastColor('#3cf');
    assert.strictEqual(color, darkText);
  });

  test('can handle hex value without #', function (assert) {
    const color = getContrastColor('272330');
    assert.strictEqual(color, lightText);
  });

  test('does not break for non-hex code value', function (assert) {
    const color = getContrastColor('cyan');
    assert.strictEqual(color, undefined);
  });

  test('returns dark-color given #00ff00', function (assert) {
    const color = getContrastColor('#00ff00');
    assert.strictEqual(color, darkText);
  });

  test('returns dark-color given #ff0000', function (assert) {
    const color = getContrastColor('#ff0000');
    assert.strictEqual(color, darkText);
  });

  test('returns dark-color given #8d8d8d', function (assert) {
    const color = getContrastColor('#8d8d8d');
    assert.strictEqual(color, darkText);
  });

  test('returns light-color given #5a586a', function (assert) {
    const color = getContrastColor('#5a586a');
    assert.strictEqual(color, lightText);
  });

  test('returns light-color given #6638ff', function (assert) {
    const color = getContrastColor('#6638ff');
    assert.strictEqual(color, lightText);
  });

  test('can use different lightColor value', function (assert) {
    const color = getContrastColor('#000', undefined, '#ddd');
    assert.strictEqual(color, '#ddd');
  });

  test('can use different darkColor value', function (assert) {
    const color = getContrastColor('#fff', '#333');
    assert.strictEqual(color, '#333');
  });
});
