import { module, test } from 'qunit';

import { themeScope, themeScopedCss } from '@cardstack/boxel-ui/helpers';

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

  test('a bare-declaration value cannot break out of the scoped block', function (assert) {
    let css = themeScopedCss(
      SCOPE,
      '--primary: red} body{background:url(https://evil.example/x)',
    ).toString();
    assert.false(
      css.includes('body{'),
      'no rule escapes the scoped selector block',
    );
    let openBraces = css.split('{').length - 1;
    let closeBraces = css.split('}').length - 1;
    assert.strictEqual(openBraces, closeBraces, 'braces stay balanced');
  });

  test('drops declarations whose value contains block delimiters', function (assert) {
    let css = themeScopedCss(
      SCOPE,
      ':root { --safe: blue; --evil: red{orange; }',
    ).toString();
    assert.true(css.includes('--safe: blue'), 'safe declaration is kept');
    assert.false(
      css.includes('--evil'),
      'declaration with a block delimiter in its value is dropped',
    );
  });

  test('drops declarations whose property name contains block delimiters', function (assert) {
    let css = themeScopedCss(SCOPE, '--safe: blue; --x} body: red').toString();
    assert.strictEqual(css, `${SELECTOR}{--safe: blue}`);
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

  test('a scope cannot terminate the surrounding style element', function (assert) {
    let css = themeScopedCss(
      'x"]</style><script>window.hacked = true</script>',
      ':root { --primary: blue; }',
    ).toString();
    assert.false(css.includes('<'), 'markup delimiters are CSS-escaped');
    assert.true(
      css.includes('[data-boxel-theme-scope="x\\"]\\3c /style>'),
      'quote and < are escaped but the selector still targets the literal scope',
    );
  });

  test('an escaped scope selector still matches its element', function (assert) {
    let scope = 'https://example.test/card"</style>';
    let css = themeScopedCss(scope, ':root { --primary: blue; }').toString();
    let selector = css.slice(0, css.indexOf('{'));
    let el = document.createElement('div');
    el.setAttribute('data-boxel-theme-scope', scope);
    assert.true(el.matches(selector), 'escaped selector matches the element');
  });
});

module('Unit | theme-scope', function () {
  const THEME_ID = 'https://example.test/starry-night-theme';
  const CSS = ':root { --primary: #112233; }';

  test('is deterministic for the same theme id and css', function (assert) {
    assert.strictEqual(themeScope(THEME_ID, CSS), themeScope(THEME_ID, CSS));
  });

  test('starts with the theme id', function (assert) {
    assert.true(themeScope(THEME_ID, CSS)!.startsWith(`${THEME_ID}-`));
  });

  test('changes when the css changes', function (assert) {
    assert.notStrictEqual(
      themeScope(THEME_ID, CSS),
      themeScope(THEME_ID, ':root { --primary: #445566; }'),
    );
  });

  test('differs across themes with identical css', function (assert) {
    assert.notStrictEqual(
      themeScope(THEME_ID, CSS),
      themeScope('https://example.test/other-theme', CSS),
    );
  });

  test('returns undefined without a theme id or css', function (assert) {
    assert.strictEqual(themeScope(undefined, CSS), undefined);
    assert.strictEqual(themeScope(null, CSS), undefined);
    assert.strictEqual(themeScope('', CSS), undefined);
    assert.strictEqual(themeScope(THEME_ID, undefined), undefined);
    assert.strictEqual(themeScope(THEME_ID, null), undefined);
    assert.strictEqual(themeScope(THEME_ID, ''), undefined);
  });
});
