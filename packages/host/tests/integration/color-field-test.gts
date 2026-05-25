import { settled } from '@ember/test-helpers';

import { module, test } from 'qunit';

import { setupBaseRealm, ColorField } from '../helpers/base-realm';
import { renderConfiguredField } from '../helpers/field-test-helpers';
import { setupRenderingTest } from '../helpers/setup';

module('Integration | color field configuration', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);

  // ============================================
  // Valid Variant Configuration Tests
  // ============================================

  test('standard variant renders color picker', async function (assert) {
    await renderConfiguredField(
      ColorField,
      '#3b82f6',
      { variant: 'standard' },
      'edit',
    );

    assert
      .dom('[data-test-field-container] .color-picker')
      .exists('standard variant renders color picker');
  });

  test('swatches-picker variant renders color palette', async function (assert) {
    await renderConfiguredField(
      ColorField,
      '#3b82f6',
      { variant: 'swatches-picker' },
      'edit',
    );

    assert
      .dom('[data-test-field-container] .color-palette-group')
      .exists('swatches-picker variant renders color palette');
  });

  test('slider variant renders slider controls', async function (assert) {
    await renderConfiguredField(
      ColorField,
      '#3b82f6',
      { variant: 'slider' },
      'edit',
    );

    assert
      .dom('[data-test-field-container] .slider-controls-editor')
      .exists('slider variant renders slider controls');
  });

  test('advanced variant renders advanced editor', async function (assert) {
    await renderConfiguredField(
      ColorField,
      '#3b82f6',
      { variant: 'advanced' },
      'edit',
    );

    assert
      .dom('[data-test-field-container] .advanced-color-editor')
      .exists('advanced variant renders advanced editor');
  });

  test('wheel variant renders color wheel', async function (assert) {
    await renderConfiguredField(
      ColorField,
      '#3b82f6',
      { variant: 'wheel' },
      'edit',
    );

    assert
      .dom('[data-test-field-container] .color-wheel-editor')
      .exists('wheel variant renders color wheel');
  });

  test('missing variant defaults to standard', async function (assert) {
    await renderConfiguredField(ColorField, '#3b82f6', {}, 'edit');

    assert
      .dom('[data-test-field-container] .color-picker')
      .exists('missing variant defaults to standard');
  });

  // ============================================
  // Invalid Variant Configuration Tests
  // ============================================

  test('invalid variant value falls back to standard variant', async function (assert) {
    await renderConfiguredField(
      ColorField,
      '#3b82f6',
      { variant: 'not-a-real-variant' },
      'edit',
    );

    assert
      .dom('[data-test-field-container] .color-picker')
      .exists('invalid variant falls back to standard');
    assert
      .dom('[data-test-field-container] .advanced-color-editor')
      .doesNotExist('advanced variant is not rendered');
  });

  test('null variant value defaults to standard variant', async function (assert) {
    await renderConfiguredField(
      ColorField,
      '#3b82f6',
      { variant: null },
      'edit',
    );

    assert
      .dom('[data-test-field-container] .color-picker')
      .exists('null variant defaults to standard');
  });

  // ============================================
  // Valid Options Configuration Tests
  // ============================================

  test('showRecent option displays recent colors addon', async function (assert) {
    await renderConfiguredField(
      ColorField,
      '#3b82f6',
      {
        variant: 'standard',
        options: { showRecent: true },
      },
      'edit',
    );

    assert
      .dom('[data-test-field-container] .recent-colors-addon')
      .exists('showRecent option displays recent colors addon');
  });

  test('showContrastChecker option displays contrast checker addon', async function (assert) {
    await renderConfiguredField(
      ColorField,
      '#3b82f6',
      {
        variant: 'standard',
        options: { showContrastChecker: true },
      },
      'edit',
    );

    assert
      .dom('[data-test-field-container] .contrast-checker-addon')
      .exists('showContrastChecker option displays contrast checker addon');
  });

  test('showRecent defaults to false', async function (assert) {
    await renderConfiguredField(
      ColorField,
      '#3b82f6',
      { variant: 'standard' },
      'edit',
    );

    assert
      .dom('[data-test-field-container] .recent-colors-addon')
      .doesNotExist('showRecent defaults to false');
  });

  test('showContrastChecker defaults to false', async function (assert) {
    await renderConfiguredField(
      ColorField,
      '#3b82f6',
      { variant: 'standard' },
      'edit',
    );

    assert
      .dom('[data-test-field-container] .contrast-checker-addon')
      .doesNotExist('showContrastChecker defaults to false');
  });

  test('maxRecentHistory option is respected', async function (assert) {
    await renderConfiguredField(
      ColorField,
      '#3b82f6',
      {
        variant: 'standard',
        options: {
          showRecent: true,
          maxRecentHistory: 5,
        },
      },
      'edit',
    );

    assert
      .dom('[data-test-field-container] .recent-colors-addon')
      .exists('recent colors addon is shown with custom maxRecentHistory');
  });

  test('swatches-picker variant supports paletteColors option', async function (assert) {
    await renderConfiguredField(
      ColorField,
      '#3b82f6',
      {
        variant: 'swatches-picker',
        options: {
          paletteColors: ['#ff0000', '#00ff00', '#0000ff'],
        },
      },
      'edit',
    );

    assert
      .dom('[data-test-field-container] .color-palette-group')
      .exists('swatches-picker variant renders with palette colors');
  });

  test('base options are ignored when variant is advanced', async function (assert) {
    await renderConfiguredField(
      ColorField,
      '#3b82f6',
      {
        variant: 'advanced',
        options: {
          showRecent: true,
          showContrastChecker: true,
          maxRecentHistory: 5,
        },
      },
      'edit',
    );

    assert
      .dom('[data-test-field-container] .advanced-color-editor')
      .exists('advanced variant renders');
    assert
      .dom('[data-test-field-container] .recent-colors-addon')
      .doesNotExist('base options are ignored for advanced variant');
    assert
      .dom('[data-test-field-container] .contrast-checker-addon')
      .doesNotExist('base options are ignored for advanced variant');
  });

  // ============================================
  // Invalid Options Configuration Tests
  // ============================================

  test('invalid option values are handled gracefully', async function (assert) {
    await renderConfiguredField(
      ColorField,
      '#3b82f6',
      {
        variant: 'standard',
        options: {
          showRecent: true,
          maxRecentHistory: 'ten' as any, // invalid type
          unknownProperty: 'should be ignored',
        } as any,
      },
      'edit',
    );

    assert
      .dom('[data-test-field-container] .color-picker')
      .exists('renders with invalid option values');
    assert
      .dom('[data-test-field-container] .recent-colors-addon')
      .exists('addon still renders despite invalid maxRecentHistory');
  });

  test('null or undefined options are handled', async function (assert) {
    await renderConfiguredField(
      ColorField,
      '#3b82f6',
      {
        variant: 'standard',
        options: null,
      },
      'edit',
    );

    assert
      .dom('[data-test-field-container] .color-picker')
      .exists('renders with null options');
  });

  // ============================================
  // Valid Format Configuration Tests
  // ============================================

  test('advanced variant renders with configured default format', async function (assert) {
    await renderConfiguredField(
      ColorField,
      'rgb(59, 130, 246)',
      {
        variant: 'advanced',
        options: { defaultFormat: 'rgb' },
      },
      'edit',
    );

    await settled();

    assert
      .dom('[data-test-field-container] .advanced-color-editor')
      .exists('advanced variant renders');
    assert
      .dom('[data-test-field-container] .color-value-input')
      .exists('RGB input section is visible');
  });

  test('advanced variant parses CSS color names', async function (assert) {
    await renderConfiguredField(
      ColorField,
      'blue',
      {
        variant: 'advanced',
        options: { defaultFormat: 'hex' },
      },
      'edit',
    );

    await settled();

    assert
      .dom('[data-test-field-container] .advanced-color-editor')
      .exists('CSS color name is parsed and component renders');
  });

  test('advanced variant parses RGB values', async function (assert) {
    await renderConfiguredField(
      ColorField,
      'rgb(255, 0, 0)',
      {
        variant: 'advanced',
        options: { defaultFormat: 'hsl' },
      },
      'edit',
    );

    await settled();

    assert
      .dom('[data-test-field-container] .advanced-color-editor')
      .exists('RGB value is parsed and component renders');
  });

  test('advanced variant parses hex values', async function (assert) {
    await renderConfiguredField(
      ColorField,
      '#ff0000',
      {
        variant: 'advanced',
        options: { defaultFormat: 'rgb' },
      },
      'edit',
    );

    await settled();

    assert
      .dom('[data-test-field-container] .advanced-color-editor')
      .exists('hex value is parsed and component renders');
  });

  test('slider variant displays HSL format when configured', async function (assert) {
    await renderConfiguredField(
      ColorField,
      '#3b82f6',
      {
        variant: 'slider',
        options: { defaultFormat: 'hsl' },
      },
      'edit',
    );

    await settled();

    const hslSliders = document.querySelectorAll(
      '[data-test-field-container] .slider-label.hue, [data-test-field-container] .slider-label.saturation, [data-test-field-container] .slider-label.lightness',
    );

    assert.ok(
      hslSliders.length >= 3,
      'slider variant with HSL format displays HSL sliders',
    );
  });

  test('slider variant displays RGB format when configured', async function (assert) {
    await renderConfiguredField(
      ColorField,
      '#3b82f6',
      {
        variant: 'slider',
        options: { defaultFormat: 'rgb' },
      },
      'edit',
    );

    await settled();

    const rgbSliders = document.querySelectorAll(
      '[data-test-field-container] .slider-label.red, [data-test-field-container] .slider-label.green, [data-test-field-container] .slider-label.blue',
    );

    assert.ok(
      rgbSliders.length >= 3,
      'slider variant with RGB format displays RGB sliders',
    );
  });

  test('wheel variant displays with configured format', async function (assert) {
    await renderConfiguredField(
      ColorField,
      '#3b82f6',
      {
        variant: 'wheel',
        options: { defaultFormat: 'rgb' },
      },
      'edit',
    );

    await settled();

    assert
      .dom('[data-test-field-container] .color-wheel-editor')
      .exists('wheel variant renders with RGB format');
  });

  // ============================================
  // Invalid Format Configuration Tests
  // ============================================

  test('invalid defaultFormat falls back to default', async function (assert) {
    await renderConfiguredField(
      ColorField,
      '#3b82f6',
      {
        variant: 'advanced',
        options: { defaultFormat: 'invalid-format' as any },
      },
      'edit',
    );

    await settled();

    assert
      .dom('[data-test-field-container] .advanced-color-editor')
      .exists('editor renders with invalid defaultFormat');
  });

  // ============================================
  // Invalid Color Value Handling Tests
  // ============================================

  test('invalid color values are handled gracefully', async function (assert) {
    const invalidColors = [
      null,
      '',
      '   ',
      'not-a-color',
      '#gggggg',
      'rgb(999, 999, 999)',
      '#ff',
    ];

    for (const color of invalidColors) {
      await renderConfiguredField(
        ColorField,
        color,
        { variant: 'standard' },
        'edit',
      );

      assert
        .dom('[data-test-field-container] .color-picker')
        .exists(`color value "${color}" renders without error`);
    }
  });

  // ============================================
  // Edge Cases and Boundary Conditions
  // ============================================

  test('multiple invalid values are handled gracefully', async function (assert) {
    await renderConfiguredField(
      ColorField,
      'invalid-color',
      {
        variant: 'not-a-variant',
        options: {
          showRecent: 'yes' as any,
          maxRecentHistory: 'ten' as any,
          unknownProperty: 'ignored',
        } as any,
      },
      'edit',
    );

    assert
      .dom('[data-test-field-container] .color-picker')
      .exists('renders despite multiple invalid values');
  });
});
