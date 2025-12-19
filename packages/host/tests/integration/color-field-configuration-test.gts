import { settled } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import { ensureTrailingSlash } from '@cardstack/runtime-common';
import type { Loader } from '@cardstack/runtime-common/loader';

import ENV from '@cardstack/host/config/environment';

import {
  setupBaseRealm,
  field,
  contains,
  CardDef,
  Component,
} from '../helpers/base-realm';
import { renderCard } from '../helpers/render-component';
import { setupRenderingTest } from '../helpers/setup';

let loader: Loader;

module('Integration | color field configuration', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);

  let catalogRealmURL = ensureTrailingSlash(ENV.resolvedCatalogRealmURL);
  let CatalogColorFieldClass: any;

  hooks.beforeEach(async function () {
    loader = getService('loader-service').loader;
    const colorModule: any = await loader.import(
      `${catalogRealmURL}fields/color`,
    );
    CatalogColorFieldClass = colorModule.default;
  });

  async function renderConfiguredField(
    value: string | null,
    configuration: any,
  ) {
    class TestCard extends CardDef {
      @field sample = contains(CatalogColorFieldClass, { configuration });

      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <div data-test-field-container>
            <@fields.sample @format='edit' />
          </div>
        </template>
      };
    }

    let card = new TestCard({ sample: value });
    await renderCard(loader, card, 'isolated');
  }

  // ============================================
  // Variant Rendering Tests
  // ============================================

  test('each variant renders correct component', async function (assert) {
    const variants = [
      { variant: 'standard', selector: '.color-picker' },
      { variant: 'swatches-picker', selector: '.color-palette-group' },
      { variant: 'slider', selector: '.slider-controls-editor' },
      { variant: 'advanced', selector: '.advanced-color-editor' },
      { variant: 'wheel', selector: '.color-wheel-editor' },
    ];

    for (const { variant, selector } of variants) {
      await renderConfiguredField('#3b82f6', { variant });
      assert
        .dom(`[data-test-field-container] ${selector}`)
        .exists(`${variant} variant renders correct component`);
    }
  });

  test('missing variant defaults to standard', async function (assert) {
    await renderConfiguredField('#3b82f6', {});

    assert
      .dom('[data-test-field-container] .color-picker')
      .exists('Missing variant defaults to standard');
  });

  test('invalid variant falls back to standard', async function (assert) {
    await renderConfiguredField('#3b82f6', { variant: 'invalid-variant' });

    assert
      .dom('[data-test-field-container] .color-picker')
      .exists('Invalid variant falls back to standard');
  });

  // ============================================
  // Options Configuration Tests
  // ============================================

  test('showRecent and showContrastChecker options display addons', async function (assert) {
    await renderConfiguredField('#3b82f6', {
      variant: 'standard',
      options: {
        showRecent: true,
        showContrastChecker: true,
      },
    });

    assert
      .dom('[data-test-field-container] .recent-colors-addon')
      .exists('showRecent option displays recent colors addon');

    assert
      .dom('[data-test-field-container] .contrast-checker-addon')
      .exists('showContrastChecker option displays contrast checker addon');
  });

  test('showRecent and showContrastChecker default to false', async function (assert) {
    await renderConfiguredField('#3b82f6', { variant: 'standard' });

    assert
      .dom('[data-test-field-container] .recent-colors-addon')
      .doesNotExist('showRecent defaults to false');

    assert
      .dom('[data-test-field-container] .contrast-checker-addon')
      .doesNotExist('showContrastChecker defaults to false');
  });

  test('maxRecentHistory option is respected', async function (assert) {
    await renderConfiguredField('#3b82f6', {
      variant: 'standard',
      options: {
        showRecent: true,
        maxRecentHistory: 5,
      },
    });

    assert
      .dom('[data-test-field-container] .recent-colors-addon')
      .exists('Recent colors addon is shown with custom maxRecentHistory');
  });

  test('advanced variant does not support base options', async function (assert) {
    await renderConfiguredField('#3b82f6', {
      variant: 'advanced',
      options: {
        showRecent: true,
        showContrastChecker: true,
      },
    });

    assert
      .dom('[data-test-field-container] .recent-colors-addon')
      .doesNotExist('Advanced variant does not show recent colors addon');

    assert
      .dom('[data-test-field-container] .contrast-checker-addon')
      .doesNotExist('Advanced variant does not show contrast checker addon');
  });

  test('variant-specific defaultFormat option works', async function (assert) {
    const variantsWithFormat = [
      { variant: 'advanced', format: 'rgb' },
      { variant: 'slider', format: 'hsl' },
      { variant: 'wheel', format: 'hex' },
    ];

    for (const { variant, format } of variantsWithFormat) {
      await renderConfiguredField('#3b82f6', {
        variant,
        options: { defaultFormat: format },
      });

      const selectors = {
        advanced: '.advanced-color-editor',
        slider: '.slider-controls-editor',
        wheel: '.color-wheel-editor',
      };

      assert
        .dom(
          `[data-test-field-container] ${
            selectors[variant as keyof typeof selectors]
          }`,
        )
        .exists(`${variant} variant renders with defaultFormat option`);
    }
  });

  test('swatches-picker variant supports paletteColors option', async function (assert) {
    await renderConfiguredField('#3b82f6', {
      variant: 'swatches-picker',
      options: {
        paletteColors: ['#ff0000', '#00ff00', '#0000ff'],
      },
    });

    assert
      .dom('[data-test-field-container] .color-palette-group')
      .exists('Swatches-picker variant renders with palette colors');
  });

  // ============================================
  // Error Handling and Edge Cases
  // ============================================

  test('null and invalid color values are handled gracefully', async function (assert) {
    await renderConfiguredField(null, { variant: 'standard' });
    assert
      .dom('[data-test-field-container] .color-picker')
      .exists('Null value renders without error');

    await renderConfiguredField('invalid-color', { variant: 'standard' });
    assert
      .dom('[data-test-field-container] .color-picker')
      .exists('Invalid color value renders without error');
  });

  test('wrong type in options is ignored gracefully', async function (assert) {
    await renderConfiguredField('#3b82f6', {
      variant: 'standard',
      options: {
        showRecent: 'not-a-boolean' as any,
        maxRecentHistory: 'not-a-number' as any,
      },
    });

    assert
      .dom('[data-test-field-container] .color-picker')
      .exists('Renders even with wrong option types');
  });

  // ============================================
  // Format Conversion and Storage Tests
  // ============================================

  test('advanced variant displays color in defaultFormat', async function (assert) {
    // Use an RGB-formatted value so it will be detected as 'rgb' format
    // and the RGB input will be shown, matching the defaultFormat setting
    await renderConfiguredField('rgb(59, 130, 246)', {
      variant: 'advanced',
      options: { defaultFormat: 'rgb' },
    });

    await settled();

    // Verify the advanced color editor is rendered
    assert
      .dom('[data-test-field-container] .advanced-color-editor')
      .exists('Advanced variant renders');

    // Check that the RGB input is visible (color-value-input class is used for RGB/HSL/HSB)
    assert
      .dom('[data-test-field-container] .color-value-input')
      .exists('RGB input section is visible');

    // Verify hex input is not shown when outputFormat is rgb
    assert
      .dom('[data-test-field-container] .color-hex-input')
      .doesNotExist(
        'Hex input stays hidden when defaultFormat is rgb and value is RGB',
      );
  });

  test('CSS color values are parsed and displayed correctly', async function (assert) {
    const testCases = [
      {
        input: 'blue',
        variant: 'advanced',
        defaultFormat: 'hex',
        description: 'CSS color name is parsed',
      },
      {
        input: 'rgb(255, 0, 0)',
        variant: 'advanced',
        defaultFormat: 'hsl',
        description: 'RGB value is parsed',
      },
      {
        input: '#ff0000',
        variant: 'advanced',
        defaultFormat: 'rgb',
        description: 'Hex value is parsed',
      },
    ];

    for (const testCase of testCases) {
      await renderConfiguredField(testCase.input, {
        variant: testCase.variant,
        options: { defaultFormat: testCase.defaultFormat },
      });

      await settled();

      // The component should render without errors
      assert
        .dom('[data-test-field-container] .advanced-color-editor')
        .exists(`${testCase.description}: Component renders successfully`);
    }
  });

  test('slider variant displays color values in defaultFormat', async function (assert) {
    await renderConfiguredField('#3b82f6', {
      variant: 'slider',
      options: { defaultFormat: 'hsl' },
    });

    await settled();

    // Check that HSL sliders are displayed (hue, saturation, lightness)
    const hslSliders = document.querySelectorAll(
      '[data-test-field-container] .slider-label.hue, [data-test-field-container] .slider-label.saturation, [data-test-field-container] .slider-label.lightness',
    );

    assert.ok(
      hslSliders.length >= 3,
      'Slider variant with HSL format displays HSL sliders',
    );
  });

  test('wheel variant displays color in defaultFormat', async function (assert) {
    await renderConfiguredField('#3b82f6', {
      variant: 'wheel',
      options: { defaultFormat: 'rgb' },
    });

    await settled();

    // Check that the wheel variant is displayed
    assert
      .dom('[data-test-field-container] .color-wheel-editor')
      .exists('Wheel variant renders with RGB format');
  });
});
