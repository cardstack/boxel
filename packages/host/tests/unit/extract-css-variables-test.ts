import { module, test } from 'qunit';

import {
  extractCssVariables,
  parseCssGroups,
} from '@cardstack/boxel-ui/helpers';

module('Unit | extract-css-variables', function () {
  test('extracts CSS variables from a string', function (assert) {
    let cssString = `:root { \n--primary: dimgrey; \n--tertiary: yellow; \n  --font-sans: 'Andale Mono', 'Courier New', Courier, monospace;\n}\n\n.brand {\n--brand-color-1: #ff000;\n}`;
    let result = extractCssVariables(cssString);
    assert.strictEqual(
      result,
      "--font-sans: 'Andale Mono', 'Courier New', Courier, monospace; --primary: dimgrey; --tertiary: yellow",
    );
  });

  test('extracts CSS variables from a string with comments', function (assert) {
    let cssString = `
      :root {
        --font-sans: 'Courier New', Courier, monospace;
        --spacing: 0.125rem;

        /*** BASE COLORS - High Contrast B&W ***/
        --background: oklch(1 0 0); /* Pure white */
        --foreground: oklch(0 0 0); /* Pure black */

        /*** theme-related
         * colors
         * etc... ***/
        --color-background: var(--background, #fff);
        --color-foreground: var(--foreground, #000);
      }
      .dark {
        /* BASE COLORS - Inverted B&W */
        --background: oklch(0 0 0);
        --foreground: oklch(1 0 0);
      }
      @theme inline {
        --color-background: var(--background, #fff);
        --color-foreground: var(--foreground, #000);
      }
    `;
    let result = extractCssVariables(cssString);
    assert.strictEqual(
      result,
      `--background: oklch(1 0 0); --color-background: var(--background, #fff); --color-foreground: var(--foreground, #000); --font-sans: 'Courier New', Courier, monospace; --foreground: oklch(0 0 0); --spacing: 0.125rem`,
    );
  });

  test('extracts CSS variables from a string without `:root` selector', function (assert) {
    let cssString = `
      {
        --font-sans: 'Courier New', Courier, monospace;
        --spacing: 0.125rem;
        /* BASE COLORS - High Contrast B&W */
        --background: oklch(1 0 0); /* Pure white */
        --foreground: oklch(0 0 0); /* Pure black */
        --color-background: var(--background, #fff);
        --color-foreground: var(--foreground, #000);
      }
    `;
    let result = extractCssVariables(cssString);
    assert.strictEqual(
      result,
      `--background: oklch(1 0 0); --color-background: var(--background, #fff); --color-foreground: var(--foreground, #000); --font-sans: 'Courier New', Courier, monospace; --foreground: oklch(0 0 0); --spacing: 0.125rem`,
    );
  });

  test('extracts CSS variables from a string with `root` selector (without the colon)', function (assert) {
    let cssString = `
      root {
        --font-sans: 'Courier New', Courier, monospace;
        --spacing: 0.125rem;
        /* BASE COLORS - High Contrast B&W */
        --background: oklch(1 0 0); /* Pure white */
        --foreground: oklch(0 0 0); /* Pure black */
        --color-background: var(--background, #fff);
        --color-foreground: var(--foreground, #000);
      }
    `;
    let result = extractCssVariables(cssString);
    assert.strictEqual(
      result,
      `--background: oklch(1 0 0); --color-background: var(--background, #fff); --color-foreground: var(--foreground, #000); --font-sans: 'Courier New', Courier, monospace; --foreground: oklch(0 0 0); --spacing: 0.125rem`,
    );
  });

  test('extracts CSS variables from a string without a selector or curly braces', function (assert) {
    let cssString = `
        --font-sans: 'Courier New', Courier, monospace;
        --spacing: 0.125rem;
        /* BASE COLORS - High Contrast B&W */
        --background: oklch(1 0 0); /* Pure white */
        --foreground: oklch(0 0 0); /* Pure black */
        --color-background: var(--background, #fff);
        --color-foreground: var(--foreground, #000);
    `;
    let result = extractCssVariables(cssString);
    assert.strictEqual(
      result,
      `--background: oklch(1 0 0); --color-background: var(--background, #fff); --color-foreground: var(--foreground, #000); --font-sans: 'Courier New', Courier, monospace; --foreground: oklch(0 0 0); --spacing: 0.125rem`,
    );
  });

  test('can not extract CSS variables from a string with unknown selector', function (assert) {
    let cssString = `
      .unknown-selector {
        --font-sans: 'Courier New', Courier, monospace;
        --spacing: 0.125rem;
        --background: oklch(1 0 0);
        --foreground: #000;
      }
    `;
    let result = extractCssVariables(cssString);
    assert.strictEqual(result, undefined);
  });

  test('can not extract CSS variables from empty ruleset', function (assert) {
    let cssString = `
      :root {

      }
    `;
    let result = extractCssVariables(cssString);
    assert.strictEqual(result, undefined);
  });

  test('later-defined css rules override the previous ones', function (assert) {
    let cssString = `
      root {
        --primary: dimgrey;
        --secondary: navy;
      }
      :root {
        --primary: lightpink;
        --secondary: purple;
      }
    `;
    let result = extractCssVariables(cssString);
    assert.strictEqual(result, `--primary: lightpink; --secondary: purple`);
  });

  test('keeps properties containing numbers', function (assert) {
    let cssString = `
      :root {
        --shadow-2xl: 0 1px 4px rgba(0 0 0 / 0.3);
        --shadow-4xl: 0 2px 8px rgba(0 0 0 / 0.4);
      }
    `;
    let result = extractCssVariables(cssString);
    assert.strictEqual(
      result,
      `--shadow-2xl: 0 1px 4px rgba(0 0 0 / 0.3); --shadow-4xl: 0 2px 8px rgba(0 0 0 / 0.4)`,
    );
  });

  test('extracts variables for a requested selector', function (assert) {
    let cssString = `
      :root {
        --primary: dimgrey;
      }
      .dark {
        --primary: black;
        --secondary: white;
      }
    `;

    let result = extractCssVariables(cssString, '.dark');
    assert.strictEqual(result, `--primary: black; --secondary: white`);
  });

  test('falls back to :root when selector is invalid', function (assert) {
    let cssString = `
      :root {
        --primary: blue;
      }
      .dark {
        --primary: black;
      }
    `;

    let result = extractCssVariables(cssString, '   ');
    assert.strictEqual(result, `--primary: blue`);

    let fallbackResult = extractCssVariables(cssString);
    assert.strictEqual(fallbackResult, `--primary: blue`);
  });

  test('ignores non custom properties', function (assert) {
    let cssString = `
      :root {
        color: red;
        font-size: 12px;
        --primary: blue;
      }
    `;

    let result = extractCssVariables(cssString);
    assert.strictEqual(result, `--primary: blue`);
  });

  test('parseCssGroups merges repeated selectors', function (assert) {
    let cssString = `
      :root {
        --primary: red;
      }
      :root {
        --secondary: blue;
      }
    `;

    let groups = parseCssGroups(cssString);
    if (!groups) {
      throw new Error('no groups were returned');
    }

    assert.deepEqual(
      [...groups.entries()].map(([selector, rules]) => [
        selector,
        [...rules.entries()],
      ]),
      [
        [
          ':root',
          [
            ['--primary', 'red'],
            ['--secondary', 'blue'],
          ],
        ],
      ],
    );
  });
});
