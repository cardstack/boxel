import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import type { Loader } from '@cardstack/runtime-common';

import { setupBaseRealm } from '../helpers/base-realm';

import { setupRenderingTest } from '../helpers/setup';

import type * as StructuredThemeModule from '@cardstack/base/structured-theme';
import type * as StructuredThemeVarsModule from '@cardstack/base/structured-theme-variables';
import type * as TypographyFieldModule from '@cardstack/base/typography';

// A real tweakcn export: alongside the `:root` and `.dark` variable blocks it
// carries tailwind directives, an `@theme inline` block of self-referential
// variables, and an `@layer base` reset — none of which belong in the theme.
const TWEAKCN_EXPORT = `@import "tailwindcss";

@custom-variant dark (&:is(.dark *));

:root {
  --background: #f6e6ee;
  --foreground: #5b5b5b;
  --card: #fdedc9;
  --card-foreground: #5b5b5b;
  --popover: #ffffff;
  --popover-foreground: #5b5b5b;
  --primary: #d04f99;
  --primary-foreground: #ffffff;
  --secondary: #8acfd1;
  --secondary-foreground: #333333;
  --muted: #b2e1eb;
  --muted-foreground: #7a7a7a;
  --accent: #fbe2a7;
  --accent-foreground: #333333;
  --destructive: #f96f70;
  --destructive-foreground: #ffffff;
  --border: #d04f99;
  --input: #e4e4e4;
  --ring: #e670ab;
  --chart-1: #e670ab;
  --chart-2: #84d2e2;
  --chart-3: #fbe2a7;
  --chart-4: #f3a0ca;
  --chart-5: #d7488e;
  --sidebar: #f8d8ea;
  --sidebar-foreground: #333333;
  --sidebar-primary: #ec4899;
  --sidebar-primary-foreground: #ffffff;
  --sidebar-accent: #f9a8d4;
  --sidebar-accent-foreground: #333333;
  --sidebar-border: #f3e8ff;
  --sidebar-ring: #ec4899;
  --font-sans: Poppins, sans-serif;
  --font-serif: Lora, serif;
  --font-mono: Fira Code, monospace;
  --radius: 0.4rem;
  --shadow-x: 3px;
  --shadow-y: 3px;
  --shadow-blur: 0px;
  --shadow-spread: 0px;
  --shadow-opacity: 1.0;
  --shadow-color: hsl(325.78 58.18% 56.86% / 0.5);
  --shadow-2xs: 3px 3px 0px 0px hsl(325.7800 58.1800% 56.8600% / 0.50);
  --shadow-xs: 3px 3px 0px 0px hsl(325.7800 58.1800% 56.8600% / 0.50);
  --shadow-sm: 3px 3px 0px 0px hsl(325.7800 58.1800% 56.8600% / 1.00), 3px 1px 2px -1px hsl(325.7800 58.1800% 56.8600% / 1.00);
  --shadow: 3px 3px 0px 0px hsl(325.7800 58.1800% 56.8600% / 1.00), 3px 1px 2px -1px hsl(325.7800 58.1800% 56.8600% / 1.00);
  --shadow-md: 3px 3px 0px 0px hsl(325.7800 58.1800% 56.8600% / 1.00), 3px 2px 4px -1px hsl(325.7800 58.1800% 56.8600% / 1.00);
  --shadow-lg: 3px 3px 0px 0px hsl(325.7800 58.1800% 56.8600% / 1.00), 3px 4px 6px -1px hsl(325.7800 58.1800% 56.8600% / 1.00);
  --shadow-xl: 3px 3px 0px 0px hsl(325.7800 58.1800% 56.8600% / 1.00), 3px 8px 10px -1px hsl(325.7800 58.1800% 56.8600% / 1.00);
  --shadow-2xl: 3px 3px 0px 0px hsl(325.7800 58.1800% 56.8600% / 2.50);
  --tracking-normal: 0em;
  --spacing: 0.25rem;
}

.dark {
  --background: #12242e;
  --foreground: #f3e3ea;
  --card: #1c2e38;
  --card-foreground: #f3e3ea;
  --popover: #1c2e38;
  --popover-foreground: #f3e3ea;
  --primary: #fbe2a7;
  --primary-foreground: #12242e;
  --secondary: #e4a2b1;
  --secondary-foreground: #12242e;
  --muted: #24272b;
  --muted-foreground: #e4a2b1;
  --accent: #c67b96;
  --accent-foreground: #f3e3ea;
  --destructive: #e35ea4;
  --destructive-foreground: #12242e;
  --border: #324859;
  --input: #20333d;
  --ring: #50afb6;
  --chart-1: #50afb6;
  --chart-2: #e4a2b1;
  --chart-3: #c67b96;
  --chart-4: #175c6c;
  --chart-5: #24272b;
  --sidebar: #101f28;
  --sidebar-foreground: #f3f4f6;
  --sidebar-primary: #ec4899;
  --sidebar-primary-foreground: #ffffff;
  --sidebar-accent: #f9a8d4;
  --sidebar-accent-foreground: #1f2937;
  --sidebar-border: #374151;
  --sidebar-ring: #ec4899;
  --font-sans: Poppins, sans-serif;
  --font-serif: Lora, serif;
  --font-mono: Fira Code, monospace;
  --radius: 0.4rem;
  --shadow-x: 3px;
  --shadow-y: 3px;
  --shadow-blur: 0px;
  --shadow-spread: 0px;
  --shadow-opacity: 1.0;
  --shadow-color: #324859;
  --shadow-2xs: 3px 3px 0px 0px hsl(206.1538 28.0576% 27.2549% / 0.50);
  --shadow-xs: 3px 3px 0px 0px hsl(206.1538 28.0576% 27.2549% / 0.50);
  --shadow-sm: 3px 3px 0px 0px hsl(206.1538 28.0576% 27.2549% / 1.00), 3px 1px 2px -1px hsl(206.1538 28.0576% 27.2549% / 1.00);
  --shadow: 3px 3px 0px 0px hsl(206.1538 28.0576% 27.2549% / 1.00), 3px 1px 2px -1px hsl(206.1538 28.0576% 27.2549% / 1.00);
  --shadow-md: 3px 3px 0px 0px hsl(206.1538 28.0576% 27.2549% / 1.00), 3px 2px 4px -1px hsl(206.1538 28.0576% 27.2549% / 1.00);
  --shadow-lg: 3px 3px 0px 0px hsl(206.1538 28.0576% 27.2549% / 1.00), 3px 4px 6px -1px hsl(206.1538 28.0576% 27.2549% / 1.00);
  --shadow-xl: 3px 3px 0px 0px hsl(206.1538 28.0576% 27.2549% / 1.00), 3px 8px 10px -1px hsl(206.1538 28.0576% 27.2549% / 1.00);
  --shadow-2xl: 3px 3px 0px 0px hsl(206.1538 28.0576% 27.2549% / 2.50);
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-chart-1: var(--chart-1);
  --color-chart-2: var(--chart-2);
  --color-chart-3: var(--chart-3);
  --color-chart-4: var(--chart-4);
  --color-chart-5: var(--chart-5);
  --color-sidebar: var(--sidebar);
  --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar-primary: var(--sidebar-primary);
  --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
  --color-sidebar-accent: var(--sidebar-accent);
  --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
  --color-sidebar-border: var(--sidebar-border);
  --color-sidebar-ring: var(--sidebar-ring);

  --font-sans: var(--font-sans);
  --font-mono: var(--font-mono);
  --font-serif: var(--font-serif);

  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);

  --shadow-2xs: var(--shadow-2xs);
  --shadow-xs: var(--shadow-xs);
  --shadow-sm: var(--shadow-sm);
  --shadow: var(--shadow);
  --shadow-md: var(--shadow-md);
  --shadow-lg: var(--shadow-lg);
  --shadow-xl: var(--shadow-xl);
  --shadow-2xl: var(--shadow-2xl);
}

@layer base {
  * {
    @apply border-border outline-ring/50;
  }
  body {
    @apply bg-background text-foreground;
  }
}`;

module('Integration | structured-theme', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);

  let StructuredTheme: typeof StructuredThemeModule.default;
  let ThemeVarField: typeof StructuredThemeVarsModule.default;
  let ThemeTypographyField: typeof StructuredThemeVarsModule.ThemeTypographyField;
  let TypographyField: typeof TypographyFieldModule.default;

  hooks.beforeEach(async function () {
    let loader: Loader = getService('loader-service').loader;
    StructuredTheme = (
      await loader.import<typeof StructuredThemeModule>(
        '@cardstack/base/structured-theme',
      )
    ).default;
    let themeVarsModule = await loader.import<typeof StructuredThemeVarsModule>(
      '@cardstack/base/structured-theme-variables',
    );
    ThemeVarField = themeVarsModule.default;
    ThemeTypographyField = themeVarsModule.ThemeTypographyField;
    TypographyField = (
      await loader.import<typeof TypographyFieldModule>(
        '@cardstack/base/typography',
      )
    ).default;
  });

  test('setCss applies the :root and .dark variables of a theme export and imports its Google Fonts stylesheets', function (assert) {
    let card = new StructuredTheme({
      rootVariables: new ThemeVarField({}),
      darkModeVariables: new ThemeVarField({}),
    });
    assert.false(
      card.setCss('h1 { color: red; }'),
      'CSS without :root or .dark variables is rejected',
    );
    assert.true(card.setCss(TWEAKCN_EXPORT));
    assert.strictEqual(card.rootVariables.background, '#f6e6ee');
    assert.strictEqual(card.rootVariables.radius, '0.4rem');
    assert.strictEqual(
      card.rootVariables.fontSans,
      'Poppins, sans-serif',
      'the @theme inline self-reference (var(--font-sans)) does not clobber the :root value',
    );
    assert.strictEqual(card.darkModeVariables.background, '#12242e');
    assert.strictEqual(card.darkModeVariables.fontMono, 'Fira Code, monospace');
    assert.deepEqual(
      [...(card.cssImports ?? [])],
      [
        'https://fonts.googleapis.com/css2?family=Poppins&display=swap',
        'https://fonts.googleapis.com/css2?family=Lora&display=swap',
        'https://fonts.googleapis.com/css2?family=Fira+Code&display=swap',
      ],
      'one import per web font family across both modes; generic fallbacks are skipped',
    );
  });

  test('setCss replaces stale Google Fonts imports but keeps imports from other hosts', function (assert) {
    let card = new StructuredTheme({
      rootVariables: new ThemeVarField({}),
      darkModeVariables: new ThemeVarField({}),
      cssImports: [
        'https://fonts.googleapis.com/css2?family=Oxanium&display=swap',
        'https://use.typekit.net/abc123.css',
      ],
    });
    card.setCss(TWEAKCN_EXPORT);
    assert.deepEqual(
      [...card.cssImports],
      [
        'https://use.typekit.net/abc123.css',
        'https://fonts.googleapis.com/css2?family=Poppins&display=swap',
        'https://fonts.googleapis.com/css2?family=Lora&display=swap',
        'https://fonts.googleapis.com/css2?family=Fira+Code&display=swap',
      ],
    );
  });

  test('setCss imports fonts referenced by dark mode and typography fields', function (assert) {
    let card = new StructuredTheme({
      rootVariables: new ThemeVarField({}),
      darkModeVariables: new ThemeVarField({ fontSans: 'Oxanium, sans-serif' }),
      typography: new ThemeTypographyField({
        heading: new TypographyField({ fontFamily: '"Playfair Display"' }),
        body: new TypographyField({
          fontFamily: 'var(--font-sans, sans-serif)',
        }),
      }),
    });
    card.setCss(':root { --background: #ffffff; }');
    assert.deepEqual(
      [...card.cssImports],
      [
        'https://fonts.googleapis.com/css2?family=Oxanium&display=swap',
        'https://fonts.googleapis.com/css2?family=Playfair+Display&display=swap',
      ],
      'var() references in typography font families do not mint imports',
    );
  });

  test('resetCss clears font-derived imports', function (assert) {
    let card = new StructuredTheme({
      rootVariables: new ThemeVarField({ fontSans: 'Geist, sans-serif' }),
      darkModeVariables: new ThemeVarField({}),
      cssImports: [
        'https://fonts.googleapis.com/css2?family=Geist&display=swap',
        'https://use.typekit.net/abc123.css',
      ],
    });
    card.resetCss();
    assert.strictEqual(card.rootVariables.fontSans, null);
    assert.deepEqual(
      [...card.cssImports],
      ['https://use.typekit.net/abc123.css'],
      'imports the user added by hand survive a reset',
    );
  });
});
