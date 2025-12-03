import { module, test } from 'qunit';

import { buildCssVariableName } from '@cardstack/boxel-ui/helpers';

module('Unit | theme-css | buildCssVariableName', function () {
  test('returns empty string when name argument is missing', function (assert) {
    assert.strictEqual(buildCssVariableName(undefined), '');
    assert.strictEqual(buildCssVariableName(), '');
  });

  test('builds css variable with only name provided', function (assert) {
    assert.strictEqual(buildCssVariableName('Spacing'), '--spacing');
    assert.strictEqual(buildCssVariableName('--spacing'), '--spacing');
  });

  test('builds css variable with prefix and name', function (assert) {
    assert.strictEqual(
      buildCssVariableName('Primary Color', { prefix: '_Theme' }),
      '--_theme-primary-color',
    );
    assert.strictEqual(
      buildCssVariableName('primaryColor', { prefix: '--brand' }),
      '--brand-primary-color',
    );
    assert.strictEqual(
      buildCssVariableName('shadow2xl', { prefix: 'Brand' }),
      '--brand-shadow-2xl',
    );
  });

  test('strips leading dashes and trims whitespace', function (assert) {
    assert.strictEqual(
      buildCssVariableName('  --Primary-Heading  ', { prefix: '  --Brand  ' }),
      '--brand-primary-heading',
    );
  });

  test('ignores prefix when name is missing', function (assert) {
    assert.strictEqual(
      buildCssVariableName(undefined, { prefix: 'brand' }),
      '',
    );
  });
});
