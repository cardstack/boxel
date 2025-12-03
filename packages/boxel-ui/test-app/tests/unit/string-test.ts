import { module, test } from 'qunit';

import { buildCssVariableName, dasherize } from '@cardstack/boxel-ui/helpers';

module('Unit | string helper | dasherize', function () {
  test('converts whitespace-delimited words to lowercase kebab case', function (assert) {
    assert.strictEqual(dasherize('  Foo Bar   Baz  '), 'foo-bar-baz');
  });

  test('inserts separators between camelCase transitions', function (assert) {
    assert.strictEqual(dasherize('camelCaseValue'), 'camel-case-value');
  });

  test('separates consecutive capitals and digits', function (assert) {
    assert.strictEqual(dasherize('Account2FAStatus'), 'account-2-fa-status');
    assert.strictEqual(dasherize('CSSVariableName'), 'css-variable-name');
    assert.strictEqual(dasherize('chart1'), 'chart-1');
    assert.strictEqual(dasherize('shadow2xl'), 'shadow-2xl');
  });

  test('returns an empty string for undefined input', function (assert) {
    assert.strictEqual(dasherize(undefined), '');
  });
});

module('Unit | string helper | buildCssVariableName', function () {
  test('returns empty string when name argument is missing', function (assert) {
    assert.strictEqual(buildCssVariableName(undefined, undefined), '');
    assert.strictEqual(buildCssVariableName(), '');
    assert.strictEqual(buildCssVariableName(undefined, 'brand'), '');
  });

  test('builds css variable with only name provided', function (assert) {
    assert.strictEqual(buildCssVariableName('Spacing'), '--spacing');
    assert.strictEqual(buildCssVariableName('--spacing'), '--spacing');
  });

  test('builds css variable with prefix and name', function (assert) {
    assert.strictEqual(
      buildCssVariableName('Primary Color', 'Brand'),
      '--brand-primary-color',
    );
    assert.strictEqual(
      buildCssVariableName('primaryColor', '--brand'),
      '--brand-primary-color',
    );
    assert.strictEqual(
      buildCssVariableName('shadow2xl', 'Brand'),
      '--brand-shadow-2xl',
    );
  });

  test('strips leading dashes and trims whitespace', function (assert) {
    assert.strictEqual(
      buildCssVariableName('  --Primary-Heading  ', '  --Brand  '),
      '--brand-primary-heading',
    );
  });
});
