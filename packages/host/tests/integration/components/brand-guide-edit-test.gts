import type { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import type { Loader } from '@cardstack/runtime-common';

import { setupBaseRealm } from '../../helpers/base-realm';
import { renderCard } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

import type * as BrandGuideModule from '@cardstack/base/brand-guide';

module('Integration | brand-guide | edit view', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);

  let loader: Loader;
  let BrandGuide: typeof BrandGuideModule.default;
  let CompoundColorField: typeof BrandGuideModule.CompoundColorField;
  let CustomCssVariable: typeof BrandGuideModule.CustomCssVariable;

  hooks.beforeEach(async function (this: RenderingTestContext) {
    loader = getService('loader-service').loader;
    let brandGuideModule = await loader.import<typeof BrandGuideModule>(
      '@cardstack/base/brand-guide',
    );
    BrandGuide = brandGuideModule.default;
    CompoundColorField = brandGuideModule.CompoundColorField;
    CustomCssVariable = brandGuideModule.CustomCssVariable;
  });

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
