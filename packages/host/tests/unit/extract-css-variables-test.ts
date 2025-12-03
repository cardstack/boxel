import { module, test } from 'qunit';

import { extractCssVariables } from '@cardstack/boxel-ui/helpers';

module('Unit | extract-css-variables', function () {
  test('extracts CSS variables from a string', function (assert) {
    let cssString = `:root { \n--primary: dimgrey; \n--tertiary: yellow; \n  --font-sans: 'Andale Mono', 'Courier New', Courier, monospace;\n}\n\n.brand {\n--brand-color-1: #ff000;\n}`;
    let result = extractCssVariables(cssString);
    assert.strictEqual(
      result,
      "--primary: dimgrey; --tertiary: yellow; --font-sans: 'Andale Mono', 'Courier New', Courier, monospace",
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
      `--font-sans: 'Courier New', Courier, monospace; --spacing: 0.125rem; --background: oklch(1 0 0); --foreground: oklch(0 0 0); --color-background: var(--background, #fff); --color-foreground: var(--foreground, #000)`,
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
      `--font-sans: 'Courier New', Courier, monospace; --spacing: 0.125rem; --background: oklch(1 0 0); --foreground: oklch(0 0 0); --color-background: var(--background, #fff); --color-foreground: var(--foreground, #000)`,
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
      `--font-sans: 'Courier New', Courier, monospace; --spacing: 0.125rem; --background: oklch(1 0 0); --foreground: oklch(0 0 0); --color-background: var(--background, #fff); --color-foreground: var(--foreground, #000)`,
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
      `--font-sans: 'Courier New', Courier, monospace; --spacing: 0.125rem; --background: oklch(1 0 0); --foreground: oklch(0 0 0); --color-background: var(--background, #fff); --color-foreground: var(--foreground, #000)`,
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
});
