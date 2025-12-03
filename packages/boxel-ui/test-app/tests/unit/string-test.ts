import { module, test } from 'qunit';

import { dasherize } from '@cardstack/boxel-ui/helpers';

module('Unit | string-helper | dasherize', function () {
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
