import { click, type RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import type { Loader } from '@cardstack/runtime-common';

import { setupBaseRealm } from '../../helpers/base-realm';
import { renderCard } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

import type * as BrandGuideModule from '@cardstack/base/brand-guide';
import type * as StructuredThemeVarsModule from '@cardstack/base/structured-theme-variables';

module('Integration | brand-guide | edit view', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);

  let loader: Loader;
  let BrandGuide: typeof BrandGuideModule.default;
  let CompoundColorField: typeof BrandGuideModule.CompoundColorField;
  let CustomCssVariable: typeof BrandGuideModule.CustomCssVariable;
  let ThemeVarField: typeof StructuredThemeVarsModule.default;

  hooks.beforeEach(async function (this: RenderingTestContext) {
    loader = getService('loader-service').loader;
    let brandGuideModule = await loader.import<typeof BrandGuideModule>(
      '@cardstack/base/brand-guide',
    );
    BrandGuide = brandGuideModule.default;
    CompoundColorField = brandGuideModule.CompoundColorField;
    CustomCssVariable = brandGuideModule.CustomCssVariable;
    ThemeVarField = (
      await loader.import<typeof StructuredThemeVarsModule>(
        '@cardstack/base/structured-theme-variables',
      )
    ).default;
  });

  function renderedSectionIds(element: Element) {
    return [...element.querySelectorAll('[data-test-brand-guide-section]')].map(
      (el) => el.getAttribute('data-test-brand-guide-section'),
    );
  }

  test('edit view shows every editable section with importer and reset, hiding display-only sections', async function (this: RenderingTestContext, assert) {
    let card = new BrandGuide();
    await renderCard(loader, card, 'edit');

    for (let id of [
      'brand-palette',
      'typography',
      'mark-usage',
      'brand-image-attachments',
      'custom-css',
      'visual-dna',
      'inspirations',
      'import-css',
      'view-code',
    ]) {
      assert
        .dom(`[data-test-brand-guide-section="${id}"]`)
        .exists(`${id} section is editable on an empty card`);
    }
    assert
      .dom('[data-test-brand-guide-section="ui-components"]')
      .doesNotExist();
    assert
      .dom('[data-test-brand-guide-section="card-container-css"]')
      .doesNotExist();
    assert.dom('[data-test-import-theme]').exists();
    assert.dom('[data-test-reset]').exists();
  });

  test('edit view renders field editors instead of the read-only variable listings', async function (this: RenderingTestContext, assert) {
    let card = new BrandGuide({
      brandColorPalette: [
        new CompoundColorField({ name: 'brand-blue', value: '#0050ff' }),
      ],
      customCssVariables: [
        new CustomCssVariable({ name: 'spacing-sm', value: '0.5rem' }),
      ],
    });
    await renderCard(loader, card, 'edit');

    assert
      .dom('[data-test-brand-guide-section="brand-palette"] input')
      .exists('brand color palette entries are editable');
    assert
      .dom('[data-test-brand-guide-section="custom-css"] input')
      .exists('custom CSS variables are editable');
    assert
      .dom('[data-test-brand-guide-css-var]')
      .doesNotExist('read-only custom CSS listing is not rendered in edit');
    assert
      .dom('[data-test-brand-image-attachment-var]')
      .doesNotExist('read-only attachment listing is not rendered in edit');
  });

  test('theme-less edit view leads with the import and generated css sections', async function (this: RenderingTestContext, assert) {
    let card = new BrandGuide();
    let element = await renderCard(loader, card, 'edit');
    assert.deepEqual(
      renderedSectionIds(element).slice(0, 2),
      ['import-css', 'view-code'],
      'the import workflow leads when the card has no theme',
    );

    let themedCard = new BrandGuide({
      rootVariables: new ThemeVarField({ background: '#f6e6ee' }),
    });
    element = await renderCard(loader, themedCard, 'edit');
    assert.strictEqual(
      renderedSectionIds(element)[0],
      'brand-palette',
      'a themed card keeps the guide order',
    );
  });

  test('reset clears custom css variables along with the theme variables', async function (this: RenderingTestContext, assert) {
    let card = new BrandGuide({
      rootVariables: new ThemeVarField({ background: '#f6e6ee' }),
      customCssVariables: [
        new CustomCssVariable({ name: 'spacingSm', value: '0.5rem' }),
      ],
    });
    await renderCard(loader, card, 'edit');

    await click('[data-test-reset]');
    assert.strictEqual(
      card.customCssVariables.length,
      0,
      'custom css variables are cleared',
    );
    assert.notOk(
      card.rootVariables?.background,
      'theme variables are cleared too',
    );
  });

  test('isolated view has no importer or reset button', async function (this: RenderingTestContext, assert) {
    let card = new BrandGuide({
      customCssVariables: [
        new CustomCssVariable({ name: 'spacing-sm', value: '0.5rem' }),
      ],
    });
    await renderCard(loader, card, 'isolated');

    assert.dom('[data-test-brand-guide-section="import-css"]').doesNotExist();
    assert.dom('[data-test-import-theme]').doesNotExist();
    assert.dom('[data-test-reset]').doesNotExist();
  });

  test('theme-less isolated view shows the dashboard empty state instead of sections', async function (this: RenderingTestContext, assert) {
    let card = new BrandGuide();
    await renderCard(loader, card, 'isolated');

    assert.dom('[data-test-dashboard-empty-state]').exists();
    assert.dom('[data-test-brand-guide-section]').doesNotExist();

    await renderCard(loader, card, 'edit');
    assert
      .dom('[data-test-dashboard-empty-state]')
      .doesNotExist('edit mode shows the editors, not the empty state');
  });
});
