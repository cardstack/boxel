import {
  themeScope as pretuiThemeScope,
  themeScopedCss as pretuiThemeScopedCss,
} from '@cardstack/pretui/theme-scoped-css';
import { module, test } from 'qunit';

import {
  themeScope as boxelUiThemeScope,
  themeScopedCss as boxelUiThemeScopedCss,
} from '@cardstack/boxel-ui/helpers';

// boxel-ui's helpers mint a card's theme scope (base's field-component) and
// emit its stylesheet (CardContainer). Pret UI's copies do the same for a
// ThemeFrame previewing that card's theme. Equal inputs give both elements
// one scope, and each stylesheet matches both elements, so the two copies
// must agree byte for byte or one restyles the other's element.

const THEME_ID = 'https://example.test/themes/parity-theme';

const CSS_INPUTS = [
  ':root { --background: #fff; --primary: #112233; }',
  ':root { --primary: #112233; } .dark { --primary: #445566; }',
  '.dark { --primary: #445566; }',
  '--primary: #112233;',
  '/* palette */ root { --primary: #112233; } dark { --primary: #445566; }',
  ':root { --a: 1;; --b : 2 ;\n --c:\n 3 } :root { --a: 9 } .other { --z: 1 }',
  ':root { --font-sans: "Inter", sans-serif; --radius: calc(0.5rem + 1px); }',
  ':root { --Upper_Case: 1; --bad name: 2; color : red; }',
  '--primary: red} body{background:url(https://example.test/x)',
  ':root { --safe: blue; --unsafe: red{orange; }',
  ':root { --primary: red</style><script>window.parityHacked = true</script>; }',
  'not css at all',
];

const SCOPES = [
  'ember123',
  `${THEME_ID}-0123456789abcdef`,
  'x"]</style><script>window.parityHacked = true</script>',
  'back\\slash\u0001control',
];

module('Unit | theme-scoped-css parity', function () {
  test('themeScope mints the same scope in boxel-ui and Pret UI', function (assert) {
    for (let css of [...CSS_INPUTS, undefined, null, '']) {
      assert.strictEqual(
        pretuiThemeScope(THEME_ID, css),
        boxelUiThemeScope(THEME_ID, css),
        `css: ${JSON.stringify(css)}`,
      );
    }
    for (let id of [undefined, null, '']) {
      assert.strictEqual(
        pretuiThemeScope(id, CSS_INPUTS[0]),
        boxelUiThemeScope(id, CSS_INPUTS[0]),
        `theme id: ${JSON.stringify(id)}`,
      );
    }
  });

  test('themeScopedCss emits the same stylesheet in boxel-ui and Pret UI', function (assert) {
    for (let scope of [...SCOPES, undefined]) {
      for (let css of [...CSS_INPUTS, undefined, null, '']) {
        assert.strictEqual(
          pretuiThemeScopedCss(scope, css).toString(),
          boxelUiThemeScopedCss(scope, css).toString(),
          `scope: ${JSON.stringify(scope)}, css: ${JSON.stringify(css)}`,
        );
      }
    }
  });
});
