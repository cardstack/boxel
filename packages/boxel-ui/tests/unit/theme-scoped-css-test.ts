import { themeScope, themeScopedCss } from '@cardstack/boxel-ui/helpers';
import { module, test } from 'qunit';

const SCOPE = 'ember123';
const SELECTOR = `[data-boxel-theme-scope="${SCOPE}"]`;
// Scheme islands the card stamps below its scope element, bounded by the
// next themed card
const ISLANDS = `@scope (${SELECTOR}) to ([data-boxel-theme-scope])`;
const lightIsland = (decls: string) => `:scope [data-theme="light"]{${decls}}`;
const darkIsland = (decls: string) =>
  `:scope :is(.dark,[data-theme="dark"]){${decls}}`;

module('Unit | theme-scoped-css', function () {
  test('scopes root variables to the theme-scope selector', function (assert) {
    let css = themeScopedCss(
      SCOPE,
      ':root { --background: #fff; --primary: #112233; }',
    ).toString();
    assert.strictEqual(
      css,
      `${SELECTOR}{--background: #fff; --primary: #112233}` +
        `${ISLANDS}{${lightIsland('--background: #fff; --primary: #112233')}${darkIsland('--background: #fff; --primary: #112233')}}`,
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
        `@container style(--boxel-color-scheme: dark){${SELECTOR}{--primary: #445566}}` +
        `${ISLANDS}{${lightIsland('--primary: #112233')}${darkIsland('--primary: #112233; --primary: #445566')}}`,
    );
  });

  test('a dark-only theme emits only the container query block', function (assert) {
    let css = themeScopedCss(SCOPE, '.dark { --primary: #445566; }').toString();
    assert.strictEqual(
      css,
      `@container style(--boxel-color-scheme: dark){${SELECTOR}{--primary: #445566}}` +
        `${ISLANDS}{${darkIsland('--primary: #445566')}}`,
    );
  });

  test('re-emits each palette on scheme islands stamped inside the card', function (assert) {
    let css = themeScopedCss(
      SCOPE,
      ':root { --primary: #112233; --accent: #abcdef; } .dark { --primary: #445566; }',
    ).toString();
    let islands = css.slice(css.indexOf('@scope'));
    assert.true(
      islands.startsWith(`${ISLANDS}{`),
      'the island rules are scoped to this theme and stop at a nested themed card',
    );
    assert.true(
      islands.includes(lightIsland('--accent: #abcdef; --primary: #112233')),
      'a light island gets the root palette',
    );
    assert.true(
      islands.includes(
        darkIsland('--accent: #abcdef; --primary: #112233; --primary: #445566'),
      ),
      'a dark island gets the root palette with the dark declarations on top, so a root-only token survives there',
    );
    assert.true(
      islands.indexOf(':scope [data-theme="light"]') <
        islands.indexOf(':scope :is(.dark'),
      'the dark rule comes last, matching theme.css precedence for an element carrying both markers',
    );
  });

  test('an element carrying both scheme markers resolves the dark palette, as in theme.css', function (assert) {
    let scope = 'both-markers';
    let style = document.createElement('style');
    style.textContent = themeScopedCss(
      scope,
      ':root { --primary: #112233; } .dark { --primary: #445566; }',
    ).toString();
    let root = document.createElement('div');
    root.setAttribute('data-boxel-theme-scope', scope);
    let island = document.createElement('div');
    island.className = 'dark';
    island.setAttribute('data-theme', 'light');
    root.appendChild(island);
    document.head.appendChild(style);
    document.body.appendChild(root);
    try {
      assert.strictEqual(
        getComputedStyle(island).getPropertyValue('--primary').trim(),
        '#445566',
      );
    } finally {
      root.remove();
      style.remove();
    }
  });

  test('bare declarations without a selector are treated as root variables', function (assert) {
    let css = themeScopedCss(SCOPE, '--primary: #112233;').toString();
    assert.strictEqual(
      css,
      `${SELECTOR}{--primary: #112233}` +
        `${ISLANDS}{${lightIsland('--primary: #112233')}${darkIsland('--primary: #112233')}}`,
    );
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
    assert.strictEqual(
      css,
      `${SELECTOR}{--safe: blue}${ISLANDS}{${lightIsland('--safe: blue')}${darkIsland('--safe: blue')}}`,
    );
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

  // Scope values persist in prerendered HTML, so the format is a
  // serialization contract: the theme id, a separator, and a fixed-width
  // 64-bit hex fingerprint of the css.
  test('is the theme id plus a fixed-width 64-bit hex fingerprint', function (assert) {
    let suffix = (css: string) =>
      themeScope(THEME_ID, css)!.slice(`${THEME_ID}-`.length);
    assert.true(
      themeScope(THEME_ID, CSS)!.startsWith(`${THEME_ID}-`),
      'scope starts with the theme id',
    );
    assert.true(
      /^[0-9a-f]{16}$/.test(suffix(CSS)),
      'fingerprint is 16 hex chars',
    );
    assert.true(
      // this css hashes with a leading zero in the first pass, which must be
      // padded rather than truncated
      /^[0-9a-f]{16}$/.test(suffix(':root { --primary: #000011; }')),
      'fingerprint width is stable when a pass hashes below 2^28',
    );
  });

  test('changes when the css or the theme id changes', function (assert) {
    assert.notStrictEqual(
      themeScope(THEME_ID, CSS),
      themeScope(THEME_ID, ':root { --primary: #445566; }'),
      'differs across css versions of one theme',
    );
    assert.notStrictEqual(
      themeScope(THEME_ID, CSS),
      themeScope('https://example.test/other-theme', CSS),
      'differs across themes with identical css',
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
