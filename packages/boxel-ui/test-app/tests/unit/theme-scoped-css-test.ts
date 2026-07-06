import { module, test } from 'qunit';

import { themeScopedCss } from '@cardstack/boxel-ui/helpers';

const SCOPE = 'ember123';
const SELECTOR = `[data-boxel-theme-scope="${SCOPE}"]`;

module('Unit | theme-scoped-css', function () {
  test('scopes root variables to the theme-scope selector', function (assert) {
    let css = themeScopedCss(
      SCOPE,
      ':root { --background: #fff; --primary: #112233; }',
    ).toString();
    assert.strictEqual(
      css,
      `${SELECTOR}{--background: #fff; --primary: #112233}`,
    );
  });

  test('wraps dark variables in a color-scheme style container query', function (assert) {
    let css = themeScopedCss(
      SCOPE,
      ':root { --primary: #112233; } .dark { --primary: #445566; }',
    ).toString();
    assert.strictEqual(
      css,
      `${SELECTOR}{--primary: #112233}` +
        `@container style(--boxel-color-scheme: dark){${SELECTOR}{--primary: #445566}}`,
    );
  });

  test('a dark-only theme emits only the container query block', function (assert) {
    let css = themeScopedCss(SCOPE, '.dark { --primary: #445566; }').toString();
    assert.strictEqual(
      css,
      `@container style(--boxel-color-scheme: dark){${SELECTOR}{--primary: #445566}}`,
    );
  });

  test('bare declarations without a selector are treated as root variables', function (assert) {
    let css = themeScopedCss(SCOPE, '--primary: #112233;').toString();
    assert.strictEqual(css, `${SELECTOR}{--primary: #112233}`);
  });

  test('returns empty string without a scope or css', function (assert) {
    assert.strictEqual(
      themeScopedCss(undefined, ':root { --primary: red; }').toString(),
      '',
    );
    assert.strictEqual(themeScopedCss(SCOPE, undefined).toString(), '');
    assert.strictEqual(themeScopedCss(SCOPE, null).toString(), '');
    assert.strictEqual(themeScopedCss(SCOPE, '').toString(), '');
  });

  test('sanitizes markup out of variable values', function (assert) {
    let css = themeScopedCss(
      SCOPE,
      ':root { --primary: red</style><script>window.hacked = true</script>; }',
    ).toString();
    assert.false(css.includes('</style>'), 'closing style tag is stripped');
    assert.false(css.includes('<script>'), 'script tag is stripped');
    assert.notOk((window as any).hacked, 'script does not execute');
  });
});
