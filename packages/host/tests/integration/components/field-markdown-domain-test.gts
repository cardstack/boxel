import type { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import type { Loader } from '@cardstack/runtime-common';

import {
  CardDef,
  CardInfoField,
  Component,
  RealmField,
  contains,
  enumField,
  field,
  setupBaseRealm,
  StringField,
} from '../../helpers/base-realm';

import { renderCard } from '../../helpers/render-component';

import { setupRenderingTest } from '../../helpers/setup';

import type * as BrandFunctionalPaletteModule from '@cardstack/base/brand-functional-palette';
import type * as BrandLogoModule from '@cardstack/base/brand-logo';
import type * as CSSValueFieldModule from '@cardstack/base/css-value';
import type * as CsvFileDefModule from '@cardstack/base/csv-file-def';
import type * as GtsFileDefModule from '@cardstack/base/gts-file-def';
import type * as ImageFileDefModule from '@cardstack/base/image-file-def';
import type * as JsonFileDefModule from '@cardstack/base/json-file-def';
import type * as MarkdownFileDefModule from '@cardstack/base/markdown-file-def';
import type * as ResponseFieldModule from '@cardstack/base/response-field';
import type * as StructuredThemeModule from '@cardstack/base/structured-theme';
import type * as StructuredThemeVarsModule from '@cardstack/base/structured-theme-variables';
import type * as TextFileDefModule from '@cardstack/base/text-file-def';
import type * as TsFileDefModule from '@cardstack/base/ts-file-def';
import type * as TypographyFieldModule from '@cardstack/base/typography';

// Verifies the explicit `static markdown` templates added per CS-10787 to
// domain/reference/file/theme fields. Fields are tested via a CardDef wrapper
// whose `isolated` template embeds `<@fields.foo @format='markdown' />` inside
// a `[data-test-md]` container; FileDef subclasses (which are themselves
// BaseDefs) are rendered directly with `renderCard(card, 'markdown')`.

function readMarkdown(root: Element | Document): string {
  let el = root.querySelector('[data-test-md]');
  return (el?.textContent ?? '').trim();
}

function readRootMarkdown(root: Element | Document): string {
  return (root.textContent ?? '').replace(/^\s+|\s+$/g, '');
}

module('Integration | field markdown domain', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);

  let loader: Loader;
  let BrandFunctionalPalette: typeof BrandFunctionalPaletteModule.default;
  let BrandLogo: typeof BrandLogoModule.default;
  let MarkField: typeof BrandLogoModule.MarkField;
  let CSSValueField: typeof CSSValueFieldModule.default;
  let CsvFileDef: typeof CsvFileDefModule.CsvFileDef;
  let GtsFileDef: typeof GtsFileDefModule.GtsFileDef;
  let ImageDef: typeof ImageFileDefModule.ImageDef;
  let JsonFileDef: typeof JsonFileDefModule.JsonFileDef;
  let MarkdownDef: typeof MarkdownFileDefModule.MarkdownDef;
  let ResponseField: typeof ResponseFieldModule.default;
  let StructuredTheme: typeof StructuredThemeModule.default;
  let ThemeVarField: typeof StructuredThemeVarsModule.default;
  let ThemeTypographyField: typeof StructuredThemeVarsModule.ThemeTypographyField;
  let TextFileDef: typeof TextFileDefModule.TextFileDef;
  let TsFileDef: typeof TsFileDefModule.TsFileDef;
  let TypographyField: typeof TypographyFieldModule.default;

  hooks.beforeEach(async function (this: RenderingTestContext) {
    loader = getService('loader-service').loader;
    BrandFunctionalPalette = (
      await loader.import<typeof BrandFunctionalPaletteModule>(
        '@cardstack/base/brand-functional-palette',
      )
    ).default;
    let brandLogoModule = await loader.import<typeof BrandLogoModule>(
      '@cardstack/base/brand-logo',
    );
    BrandLogo = brandLogoModule.default;
    MarkField = brandLogoModule.MarkField;
    CSSValueField = (
      await loader.import<typeof CSSValueFieldModule>(
        '@cardstack/base/css-value',
      )
    ).default;
    CsvFileDef = (
      await loader.import<typeof CsvFileDefModule>(
        '@cardstack/base/csv-file-def',
      )
    ).CsvFileDef;
    GtsFileDef = (
      await loader.import<typeof GtsFileDefModule>(
        '@cardstack/base/gts-file-def',
      )
    ).GtsFileDef;
    ImageDef = (
      await loader.import<typeof ImageFileDefModule>(
        '@cardstack/base/image-file-def',
      )
    ).ImageDef;
    JsonFileDef = (
      await loader.import<typeof JsonFileDefModule>(
        '@cardstack/base/json-file-def',
      )
    ).JsonFileDef;
    MarkdownDef = (
      await loader.import<typeof MarkdownFileDefModule>(
        '@cardstack/base/markdown-file-def',
      )
    ).MarkdownDef;
    ResponseField = (
      await loader.import<typeof ResponseFieldModule>(
        '@cardstack/base/response-field',
      )
    ).default;
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
    TextFileDef = (
      await loader.import<typeof TextFileDefModule>(
        '@cardstack/base/text-file-def',
      )
    ).TextFileDef;
    TsFileDef = (
      await loader.import<typeof TsFileDefModule>('@cardstack/base/ts-file-def')
    ).TsFileDef;
    TypographyField = (
      await loader.import<typeof TypographyFieldModule>(
        '@cardstack/base/typography',
      )
    ).default;
  });

  // ---- Reference / relation fields ------------------------------------

  test('RealmField markdown emits a self-linked markdown link', async function (this: RenderingTestContext, assert) {
    class Sample extends CardDef {
      @field value = contains(RealmField);
      static isolated = class extends Component<typeof this> {
        <template>
          <div data-test-md><@fields.value @format='markdown' /></div>
        </template>
      };
    }
    let card = new Sample({ value: 'https://example.com/realm/' });
    await renderCard(loader, card, 'isolated');
    assert.strictEqual(
      readMarkdown(this.element),
      '[https://example.com/realm/](https://example.com/realm/)',
    );
  });

  test('RealmField markdown emits empty string when unset', async function (this: RenderingTestContext, assert) {
    class Sample extends CardDef {
      @field value = contains(RealmField);
      static isolated = class extends Component<typeof this> {
        <template>
          <div data-test-md><@fields.value @format='markdown' /></div>
        </template>
      };
    }
    let card = new Sample();
    await renderCard(loader, card, 'isolated');
    assert.strictEqual(readMarkdown(this.element), '');
  });

  test('ResponseField markdown emits a status summary placeholder', async function (this: RenderingTestContext, assert) {
    class Sample extends CardDef {
      @field value = contains(ResponseField);
      static isolated = class extends Component<typeof this> {
        <template>
          <div data-test-md><@fields.value @format='markdown' /></div>
        </template>
      };
    }
    let card = new Sample({
      value: new Response('body', { status: 200, statusText: 'OK' }),
    });
    await renderCard(loader, card, 'isolated');
    assert.strictEqual(readMarkdown(this.element), '[HTTP response: 200 OK]');
  });

  test('ResponseField markdown emits a generic placeholder when unset', async function (this: RenderingTestContext, assert) {
    class Sample extends CardDef {
      @field value = contains(ResponseField);
      static isolated = class extends Component<typeof this> {
        <template>
          <div data-test-md><@fields.value @format='markdown' /></div>
        </template>
      };
    }
    let card = new Sample();
    await renderCard(loader, card, 'isolated');
    assert.strictEqual(readMarkdown(this.element), '');
  });

  // ---- enum factory ---------------------------------------------------

  test('enumField markdown renders the matching option label', async function (this: RenderingTestContext, assert) {
    const Priority = enumField(StringField, {
      options: [
        { value: 'high', label: 'High Priority' },
        { value: 'medium', label: 'Medium Priority' },
        { value: 'low', label: 'Low Priority' },
      ],
    });
    class Sample extends CardDef {
      @field value = contains(Priority);
      static isolated = class extends Component<typeof this> {
        <template>
          <div data-test-md><@fields.value @format='markdown' /></div>
        </template>
      };
    }
    let card = new Sample({ value: 'high' });
    await renderCard(loader, card, 'isolated');
    assert.strictEqual(readMarkdown(this.element), 'High Priority');
  });

  test('enumField markdown falls back to escaped raw value when no option matches', async function (this: RenderingTestContext, assert) {
    const Priority = enumField(StringField, {
      options: ['high', 'low'],
    });
    class Sample extends CardDef {
      @field value = contains(Priority);
      static isolated = class extends Component<typeof this> {
        <template>
          <div data-test-md><@fields.value @format='markdown' /></div>
        </template>
      };
    }
    // `-urgent` at line start would read as a bullet marker, so the `-` gets
    // escaped by markdownEscape.
    let card = new Sample({ value: '-urgent' });
    await renderCard(loader, card, 'isolated');
    assert.strictEqual(readMarkdown(this.element), '\\-urgent');
  });

  // ---- Style / theme fields -------------------------------------------

  test('CSSValueField markdown wraps the value in a single-backtick fence', async function (this: RenderingTestContext, assert) {
    class Sample extends CardDef {
      @field value = contains(CSSValueField);
      static isolated = class extends Component<typeof this> {
        <template>
          <div data-test-md><@fields.value @format='markdown' /></div>
        </template>
      };
    }
    let card = new Sample({ value: '1rem' });
    await renderCard(loader, card, 'isolated');
    assert.strictEqual(readMarkdown(this.element), '`1rem`');
  });

  test('CSSValueField markdown widens the fence when the value contains backticks', async function (this: RenderingTestContext, assert) {
    class Sample extends CardDef {
      @field value = contains(CSSValueField);
      static isolated = class extends Component<typeof this> {
        <template>
          <div data-test-md><@fields.value @format='markdown' /></div>
        </template>
      };
    }
    // A value containing a backtick needs a double-backtick fence, and because
    // it ends with a backtick we pad with spaces.
    let card = new Sample({ value: 'var(--x) `fallback`' });
    await renderCard(loader, card, 'isolated');
    assert.strictEqual(readMarkdown(this.element), '`` var(--x) `fallback` ``');
  });

  test('TypographyField markdown emits bulleted non-empty properties', async function (this: RenderingTestContext, assert) {
    class Sample extends CardDef {
      @field typography = contains(TypographyField);
      static isolated = class extends Component<typeof this> {
        <template>
          <div data-test-md><@fields.typography @format='markdown' /></div>
        </template>
      };
    }
    let card = new Sample({
      typography: new TypographyField({
        fontFamily: 'Inter, sans-serif',
        fontSize: '16px',
        fontWeight: '400',
        sampleText: 'Lorem ipsum',
      }),
    });
    await renderCard(loader, card, 'isolated');
    assert.strictEqual(
      readMarkdown(this.element),
      [
        '- Font family: `Inter, sans-serif`',
        '- Font size: `16px`',
        '- Font weight: `400`',
        '- Sample text: Lorem ipsum',
      ].join('\n'),
    );
  });

  test('TypographyField markdown emits empty string when no properties are set', async function (this: RenderingTestContext, assert) {
    class Sample extends CardDef {
      @field typography = contains(TypographyField);
      static isolated = class extends Component<typeof this> {
        <template>
          <div data-test-md><@fields.typography @format='markdown' /></div>
        </template>
      };
    }
    let card = new Sample({ typography: new TypographyField({}) });
    await renderCard(loader, card, 'isolated');
    assert.strictEqual(readMarkdown(this.element), '');
  });

  test('ThemeVarField markdown lists populated CSS variables with escaped names', async function (this: RenderingTestContext, assert) {
    class Sample extends CardDef {
      @field vars = contains(ThemeVarField);
      static isolated = class extends Component<typeof this> {
        <template>
          <div data-test-md><@fields.vars @format='markdown' /></div>
        </template>
      };
    }
    let card = new Sample({
      vars: new ThemeVarField({
        background: '#fff',
        foreground: '#000',
      }),
    });
    await renderCard(loader, card, 'isolated');
    // Variable names always start with `--`; markdownEscape escapes every `-`
    // unconditionally so downstream markdown renderers don't misinterpret
    // the leading dashes.
    let text = readMarkdown(this.element);
    assert.true(
      text.includes('- \\-\\-background: `#fff`'),
      `expected background entry in: ${text}`,
    );
    assert.true(
      text.includes('- \\-\\-foreground: `#000`'),
      `expected foreground entry in: ${text}`,
    );
    // Unpopulated fields (e.g. primary) should be omitted.
    assert.false(
      text.includes('primary'),
      `expected unpopulated entries to be omitted in: ${text}`,
    );
  });

  test('ThemeVarField markdown emits empty string when no variables are populated', async function (this: RenderingTestContext, assert) {
    class Sample extends CardDef {
      @field vars = contains(ThemeVarField);
      static isolated = class extends Component<typeof this> {
        <template>
          <div data-test-md><@fields.vars @format='markdown' /></div>
        </template>
      };
    }
    let card = new Sample({ vars: new ThemeVarField({}) });
    await renderCard(loader, card, 'isolated');
    assert.strictEqual(readMarkdown(this.element), '');
  });

  test('ThemeTypographyField markdown lists populated typography entries', async function (this: RenderingTestContext, assert) {
    class Sample extends CardDef {
      @field typography = contains(ThemeTypographyField);
      static isolated = class extends Component<typeof this> {
        <template>
          <div data-test-md><@fields.typography @format='markdown' /></div>
        </template>
      };
    }
    let card = new Sample({
      typography: new ThemeTypographyField({
        heading: new TypographyField({ fontFamily: 'Inter' }),
      }),
    });
    await renderCard(loader, card, 'isolated');
    assert.strictEqual(
      readMarkdown(this.element),
      '- \\-\\-theme\\-heading\\-font\\-family: `Inter`',
    );
  });

  // ---- Brand / logo fields --------------------------------------------

  test('MarkField markdown emits a markdown image with encoded href', async function (this: RenderingTestContext, assert) {
    class Sample extends CardDef {
      @field value = contains(MarkField);
      static isolated = class extends Component<typeof this> {
        <template>
          <div data-test-md><@fields.value @format='markdown' /></div>
        </template>
      };
    }
    let card = new Sample({ value: 'https://example.com/logo with space.png' });
    await renderCard(loader, card, 'isolated');
    // Alt text is intentionally blank; the URL gets percent-encoded for safe
    // use inside the markdown image reference.
    assert.strictEqual(
      readMarkdown(this.element),
      '![](https://example.com/logo%20with%20space.png)',
    );
  });

  test('MarkField markdown emits empty string when URL is missing', async function (this: RenderingTestContext, assert) {
    class Sample extends CardDef {
      @field value = contains(MarkField);
      static isolated = class extends Component<typeof this> {
        <template>
          <div data-test-md><@fields.value @format='markdown' /></div>
        </template>
      };
    }
    let card = new Sample();
    await renderCard(loader, card, 'isolated');
    assert.strictEqual(readMarkdown(this.element), '');
  });

  test('BrandFunctionalPalette markdown lists populated palette colors', async function (this: RenderingTestContext, assert) {
    class Sample extends CardDef {
      @field palette = contains(BrandFunctionalPalette);
      static isolated = class extends Component<typeof this> {
        <template>
          <div data-test-md><@fields.palette @format='markdown' /></div>
        </template>
      };
    }
    let card = new Sample({
      palette: new BrandFunctionalPalette({
        primary: '#ff00ff',
        accent: '#00ffff',
      }),
    });
    await renderCard(loader, card, 'isolated');
    assert.strictEqual(
      readMarkdown(this.element),
      ['- Primary: `#ff00ff`', '- Accent: `#00ffff`'].join('\n'),
    );
  });

  test('BrandFunctionalPalette markdown emits empty string when nothing is populated', async function (this: RenderingTestContext, assert) {
    class Sample extends CardDef {
      @field palette = contains(BrandFunctionalPalette);
      static isolated = class extends Component<typeof this> {
        <template>
          <div data-test-md><@fields.palette @format='markdown' /></div>
        </template>
      };
    }
    let card = new Sample({ palette: new BrandFunctionalPalette({}) });
    await renderCard(loader, card, 'isolated');
    assert.strictEqual(readMarkdown(this.element), '');
  });

  test('BrandLogo markdown lists populated mark URLs with links and labels', async function (this: RenderingTestContext, assert) {
    class Sample extends CardDef {
      @field logo = contains(BrandLogo);
      static isolated = class extends Component<typeof this> {
        <template>
          <div data-test-md><@fields.logo @format='markdown' /></div>
        </template>
      };
    }
    let card = new Sample({
      logo: new BrandLogo({
        primaryMark1: 'https://example.com/primary-light.png',
        socialMediaProfileIcon: 'https://example.com/icon.png',
      }),
    });
    await renderCard(loader, card, 'isolated');
    // `(light)` has its parens escaped by markdownEscape on the label, and
    // `markdownLink(url, url)` double-quotes the URL as both link text and
    // href (no `-` in these URLs so no escape inside the text).
    assert.strictEqual(
      readMarkdown(this.element),
      [
        '- Primary mark \\(light\\): [https://example.com/primary\\-light.png](https://example.com/primary-light.png)',
        '- Social media icon: [https://example.com/icon.png](https://example.com/icon.png)',
      ].join('\n'),
    );
  });

  // ---- FileDef subclasses (rendered directly) -------------------------

  test('MarkdownDef markdown passes content through verbatim', async function (this: RenderingTestContext, assert) {
    let card = new MarkdownDef({
      name: 'doc.md',
      content: '# Heading\n\n- bullet',
      contentType: 'text/markdown',
      sourceUrl: 'https://example.com/doc.md',
    });
    await renderCard(loader, card, 'markdown');
    assert.strictEqual(readRootMarkdown(this.element), '# Heading\n\n- bullet');
  });

  test('TsFileDef markdown emits a fenced ts code block', async function (this: RenderingTestContext, assert) {
    let card = new TsFileDef({
      name: 'sample.ts',
      content: 'export const x = 1;',
      contentType: 'text/typescript',
      sourceUrl: 'https://example.com/sample.ts',
    });
    await renderCard(loader, card, 'markdown');
    assert.strictEqual(
      readRootMarkdown(this.element),
      '```ts\nexport const x = 1;\n```',
    );
  });

  test('GtsFileDef markdown overrides the language tag to gts', async function (this: RenderingTestContext, assert) {
    let card = new GtsFileDef({
      name: 'sample.gts',
      content: '<template>hi</template>',
      contentType: 'text/typescript',
      sourceUrl: 'https://example.com/sample.gts',
    });
    await renderCard(loader, card, 'markdown');
    assert.strictEqual(
      readRootMarkdown(this.element),
      '```gts\n<template>hi</template>\n```',
    );
  });

  test('JsonFileDef markdown emits a fenced json code block', async function (this: RenderingTestContext, assert) {
    let card = new JsonFileDef({
      name: 'data.json',
      content: '{"ok":true}',
      contentType: 'application/json',
      sourceUrl: 'https://example.com/data.json',
    });
    await renderCard(loader, card, 'markdown');
    assert.strictEqual(
      readRootMarkdown(this.element),
      '```json\n{"ok":true}\n```',
    );
  });

  test('CsvFileDef markdown emits a fenced csv code block', async function (this: RenderingTestContext, assert) {
    let card = new CsvFileDef({
      name: 'rows.csv',
      content: 'name,count\nA,1\nB,2',
      contentType: 'text/csv',
      sourceUrl: 'https://example.com/rows.csv',
    });
    await renderCard(loader, card, 'markdown');
    assert.strictEqual(
      readRootMarkdown(this.element),
      '```csv\nname,count\nA,1\nB,2\n```',
    );
  });

  test('TextFileDef markdown emits an unlabeled fenced code block', async function (this: RenderingTestContext, assert) {
    let card = new TextFileDef({
      name: 'notes.txt',
      content: 'plain content',
      contentType: 'text/plain',
      sourceUrl: 'https://example.com/notes.txt',
    });
    await renderCard(loader, card, 'markdown');
    assert.strictEqual(
      readRootMarkdown(this.element),
      '```\nplain content\n```',
    );
  });

  test('ImageDef markdown emits a markdown image reference', async function (this: RenderingTestContext, assert) {
    let card = new ImageDef({
      name: 'hero',
      url: 'https://example.com/hero.png',
      sourceUrl: 'https://example.com/hero.png',
      contentType: 'image/png',
    });
    await renderCard(loader, card, 'markdown');
    assert.strictEqual(
      readRootMarkdown(this.element),
      '![hero](https://example.com/hero.png)',
    );
  });

  test('ImageDef markdown falls back to a placeholder when no URL is set', async function (this: RenderingTestContext, assert) {
    let card = new ImageDef({ name: 'hero', contentType: 'image/png' });
    await renderCard(loader, card, 'markdown');
    assert.strictEqual(readRootMarkdown(this.element), '[binary image: hero]');
  });

  // ---- StructuredTheme (CardDef subclass, rendered directly) ----------

  test('StructuredTheme markdown emits title, description, version, and variable sections', async function (this: RenderingTestContext, assert) {
    let card = new StructuredTheme({
      cardInfo: new CardInfoField({
        name: 'Example Theme',
        summary: 'A sample theme for testing.',
      }),
      version: '1.0.0',
      typography: new ThemeTypographyField({
        heading: new TypographyField({ fontFamily: 'Inter' }),
      }),
      rootVariables: new ThemeVarField({
        background: '#fff',
      }),
    });
    await renderCard(loader, card, 'markdown');
    let text = readRootMarkdown(this.element);
    assert.true(
      text.includes('# Example Theme'),
      `expected H1 title in: ${text}`,
    );
    assert.true(
      text.includes('A sample theme for testing.'),
      `expected description in: ${text}`,
    );
    assert.true(
      text.includes('Version: `1.0.0`'),
      `expected version line in: ${text}`,
    );
    assert.true(
      text.includes('## Typography'),
      `expected typography heading in: ${text}`,
    );
    assert.true(
      text.includes('## Root Variables'),
      `expected root variables heading in: ${text}`,
    );
    assert.true(
      text.includes('\\-\\-theme\\-heading\\-font\\-family'),
      `expected typography entry in: ${text}`,
    );
    assert.true(
      text.includes('\\-\\-background'),
      `expected root var entry in: ${text}`,
    );
  });
});
