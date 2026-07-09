import type { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { baseRealm, type Loader } from '@cardstack/runtime-common';

import { setupBaseRealm } from '../../helpers/base-realm';
import { renderCard } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

import type * as BrandGuideModule from '@cardstack/base/brand-guide';

module('Integration | brand-guide | custom-css section', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);

  let loader: Loader;
  let BrandGuide: typeof BrandGuideModule.default;
  let CompoundColorField: typeof BrandGuideModule.CompoundColorField;
  let CustomCssVariable: typeof BrandGuideModule.CustomCssVariable;

  hooks.beforeEach(async function (this: RenderingTestContext) {
    loader = getService('loader-service').loader;
    let brandGuideModule = await loader.import<typeof BrandGuideModule>(
      `${baseRealm.url}brand-guide`,
    );
    BrandGuide = brandGuideModule.default;
    CompoundColorField = brandGuideModule.CompoundColorField;
    CustomCssVariable = brandGuideModule.CustomCssVariable;
  });

  test('custom-css section is visible when customCssVariables or brandColorPalette has entries', async function (this: RenderingTestContext, assert) {
    let card = new BrandGuide();
    await renderCard(loader, card, 'isolated');
    assert
      .dom('[data-test-brand-guide-section="custom-css"]')
      .doesNotExist('hidden when no custom variables or palette entries exist');

    let cardWithVars = new BrandGuide({
      customCssVariables: [
        new CustomCssVariable({ name: 'spacing-sm', value: '0.5rem' }),
      ],
    });
    await renderCard(loader, cardWithVars, 'isolated');
    assert
      .dom('[data-test-brand-guide-section="custom-css"]')
      .exists('section appears with customCssVariables');

    let cardWithPalette = new BrandGuide({
      brandColorPalette: [
        new CompoundColorField({ name: 'brand-blue', value: '#0050ff' }),
      ],
    });
    await renderCard(loader, cardWithPalette, 'isolated');
    assert
      .dom('[data-test-brand-guide-section="custom-css"]')
      .exists('section appears with brandColorPalette');
  });

  test('custom CSS variable names are normalized and values are rendered, with incomplete entries filtered out', async function (this: RenderingTestContext, assert) {
    let card = new BrandGuide({
      customCssVariables: [
        new CustomCssVariable({ name: '', value: 'should-be-hidden' }),
        new CustomCssVariable({ name: 'noValue', value: '' }),
        new CustomCssVariable({ name: 'myFont', value: 'Georgia, serif' }),
        new CustomCssVariable({ name: 'spacing', value: '1.5rem' }),
      ],
    });
    await renderCard(loader, card, 'isolated');

    assert
      .dom('[data-test-brand-guide-css-var]')
      .exists(
        { count: 2 },
        'only entries with both name and value are rendered',
      );
    assert
      .dom('[data-test-brand-guide-css-var-name]')
      .hasText(
        '--my-font',
        'camelCase name is kebab-cased and prefixed with --',
      );
    assert
      .dom('[data-test-brand-guide-css-var-value]')
      .exists({ count: 2 }, 'values render for each complete entry');
    assert
      .dom(
        '[data-test-brand-guide-section="custom-css"] [data-test-boxel-copy-button]',
      )
      .exists('copy button is present');
  });

  test('custom-css section is hidden when all entries have missing name or value', async function (this: RenderingTestContext, assert) {
    let card = new BrandGuide({
      customCssVariables: [
        new CustomCssVariable({ name: 'noValue', value: '' }),
        new CustomCssVariable({ name: '', value: 'noName' }),
      ],
    });
    await renderCard(loader, card, 'isolated');

    assert
      .dom('[data-test-brand-guide-section="custom-css"]')
      .doesNotExist('section hidden when no entry has both name and value');
  });

  test('trailing semicolons in custom CSS variable values are stripped in display and copy block', async function (this: RenderingTestContext, assert) {
    let card = new BrandGuide({
      customCssVariables: [
        new CustomCssVariable({ name: 'myFont', value: 'Georgia, serif;' }),
        new CustomCssVariable({ name: 'spacing', value: '1.5rem;;' }),
      ],
    });
    await renderCard(loader, card, 'isolated');

    let valueEls = document.querySelectorAll(
      '[data-test-brand-guide-css-var-value]',
    );
    assert.strictEqual(
      valueEls[0]?.textContent,
      'Georgia, serif',
      'trailing semicolon is stripped in display',
    );
    assert.strictEqual(
      valueEls[1]?.textContent,
      '1.5rem',
      'multiple trailing semicolons are stripped in display',
    );

    let css = card.cssVariables ?? '';
    assert.ok(
      css.includes('--my-font: Georgia, serif;'),
      'copy block value has exactly one trailing semicolon',
    );
    assert.notOk(
      css.includes(';;'),
      'copy block never produces double semicolons',
    );
  });

  test('customCssVariables appear in computed cssVariables with normalized names, empty-name entries excluded', async function (this: RenderingTestContext, assert) {
    let card = new BrandGuide({
      customCssVariables: [
        new CustomCssVariable({ name: '', value: 'should-be-excluded' }),
        new CustomCssVariable({ name: 'myFont', value: 'Georgia, serif' }),
        new CustomCssVariable({ name: 'spacingSm', value: '0.5rem' }),
      ],
    });
    await renderCard(loader, card, 'isolated');

    let css = card.cssVariables ?? '';
    assert.ok(
      css.includes('--my-font: Georgia, serif'),
      'camelCase name is dasherized and prefixed with --',
    );
    assert.ok(
      css.includes('--spacing-sm: 0.5rem'),
      'camelCase compound name is dasherized correctly',
    );
    assert.notOk(
      css.includes('should-be-excluded'),
      'entry with empty name is excluded from cssVariables',
    );
  });

  test('palette entries render var names and swatches, filtering entries missing name or value', async function (this: RenderingTestContext, assert) {
    let card = new BrandGuide({
      brandColorPalette: [
        new CompoundColorField({ name: '', value: '#ff0000' }),
        new CompoundColorField({ name: 'noColor', value: '' }),
        new CompoundColorField({ name: 'primary', value: '#ff0000' }),
      ],
    });
    await renderCard(loader, card, 'isolated');

    assert
      .dom('[data-test-brand-guide-palette-var]')
      .exists({ count: 1 }, 'entries missing name or value are filtered out');
    assert
      .dom('[data-test-brand-guide-palette-var-name]')
      .hasText(
        '--primary',
        'palette entry var name is shown as a CSS variable',
      );
    assert
      .dom('[data-test-brand-guide-palette-swatch]')
      .exists('palette entry renders a color swatch cell');
  });
});
