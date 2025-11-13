import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { ensureTrailingSlash } from '@cardstack/runtime-common';
import { Loader } from '@cardstack/runtime-common/loader';

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

type FieldFormat = 'embedded' | 'atom' | 'edit';

let loader: Loader;

module('Integration | number field configuration', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);

  let catalogRealmURL = ensureTrailingSlash(ENV.resolvedCatalogRealmURL);
  let CatalogNumberFieldClass: any;

  hooks.beforeEach(async function () {
    loader = getService('loader-service').loader;
    const numberModule: any = await loader.import(
      `${catalogRealmURL}fields/number`,
    );
    CatalogNumberFieldClass = numberModule.default;
  });

  async function renderConfiguredField(
    value: unknown, // The value to be rendered in the field
    presentation: any,
    format: FieldFormat = 'atom',
  ) {
    const fieldFormat = format;
    const configuration = { presentation };

    class TestCard extends CardDef {
      @field sample = contains(CatalogNumberFieldClass, { configuration });

      static isolated = class Isolated extends Component<typeof this> {
        format: FieldFormat = fieldFormat;

        <template>
          <div data-test-field-container>
            <@fields.sample @format={{this.format}} />
          </div>
        </template>
      };
    }

    let card = new TestCard({ sample: value });
    await renderCard(loader, card, 'isolated');
  }

  // Rating Field Tests
  test('rating field edit view shows 5 star buttons', async function (assert) {
    await renderConfiguredField(
      4,
      {
        type: 'rating',
        maxStars: 5,
      },
      'edit',
    );

    assert
      .dom('[data-test-field-container] .star-btn')
      .exists({ count: 5 }, 'Rating field edit view renders 5 star buttons');
  });

  test('rating field ignores irrelevant config properties', async function (assert) {
    await renderConfiguredField(
      3,
      {
        type: 'rating',
        maxStars: 5,
        // These properties should be ignored by rating field
        decimals: 2,
        prefix: '$',
        suffix: ' USD',
        min: 0,
        max: 100,
      },
      'edit',
    );

    // Rating field should still work normally, ignoring the irrelevant config
    assert
      .dom('[data-test-field-container] .star-btn')
      .exists(
        { count: 5 },
        'Rating field ignores decimals, prefix, suffix, min, max configs',
      );

    // Should not show any formatting like prefix/suffix
    assert
      .dom('[data-test-field-container]')
      .doesNotContainText('$', 'Rating field does not apply prefix');

    assert
      .dom('[data-test-field-container]')
      .doesNotContainText('USD', 'Rating field does not apply suffix');
  });

  test('rating field atom view shows only 1 star + numeric value', async function (assert) {
    await renderConfiguredField(3, {
      type: 'rating',
      maxStars: 5,
    });

    assert
      .dom('[data-test-field-container] [data-test-rating-atom]')
      .exists('Rating field atom view is rendered');

    assert
      .dom('[data-test-field-container] [data-test-rating-atom] .atom-value')
      .hasText('3', 'Rating field atom view shows the numeric value');

    assert
      .dom('[data-test-field-container] [data-test-rating-atom] .atom-star')
      .exists({ count: 1 }, 'Rating atom view shows only 1 star icon')
      .hasText('★', 'Star icon is rendered as Unicode character');
  });

  // Slider Field Tests
  test('slider field renders as input type="range"', async function (assert) {
    await renderConfiguredField(
      50,
      {
        type: 'slider',
        min: 0,
        max: 100,
      },
      'edit',
    );

    assert
      .dom('[data-test-field-container] input[type="range"]')
      .exists('Slider field edit view renders as <input type="range">');
  });

  test('slider field respects min/max configuration', async function (assert) {
    await renderConfiguredField(
      30,
      {
        type: 'slider',
        min: 10,
        max: 50,
      },
      'edit',
    );

    assert
      .dom('[data-test-field-container] input[type="range"]')
      .hasAttribute('min', '10', 'Slider has correct min value')
      .hasAttribute('max', '50', 'Slider has correct max value')
      .hasValue('30', 'Slider has correct current value');
  });

  test('slider field with showValue displays current value', async function (assert) {
    await renderConfiguredField(
      75,
      {
        type: 'slider',
        min: 0,
        max: 100,
        showValue: true,
      },
      'edit',
    );

    assert
      .dom('[data-test-field-container] input[type="range"]')
      .exists('Slider renders range input');

    assert
      .dom('[data-test-field-container]')
      .hasTextContaining(
        '75',
        'Slider displays current value when showValue is true',
      );
  });

  test('slider field ignores rating-specific config', async function (assert) {
    await renderConfiguredField(
      50,
      {
        type: 'slider',
        min: 0,
        max: 100,
        maxStars: 5, // This is rating-specific and should be ignored
      },
      'edit',
    );

    // Should render as slider, not rating
    assert
      .dom('[data-test-field-container] input[type="range"]')
      .exists('Slider field ignores maxStars config from rating field');

    // Should NOT render star buttons
    assert
      .dom('[data-test-field-container] .star-btn')
      .doesNotExist(
        'Slider does not render star buttons even if maxStars is provided',
      );
  });

  // Number Input Tests
  test('number input with prefix/suffix formatting', async function (assert) {
    await renderConfiguredField(100.5, {
      prefix: '$',
      suffix: ' USD',
      decimals: 2,
    });

    assert
      .dom('[data-test-field-container]')
      .hasTextContaining(
        '$100.50 USD',
        'Number field shows prefix/suffix formatting',
      );
  });

  test('number input respects decimals configuration', async function (assert) {
    await renderConfiguredField(5.5, {
      decimals: 3,
    });

    assert
      .dom('[data-test-field-container]')
      .hasTextContaining(
        '5.500',
        'Number field shows correct decimal places (0.000)',
      );
  });

  test('number input respects min/max configuration', async function (assert) {
    await renderConfiguredField(
      50,
      {
        min: 0,
        max: 100,
      },
      'edit',
    );

    assert
      .dom('[data-test-field-container] input[type="number"]')
      .hasAttribute('min', '0', 'Number input has correct min value')
      .hasAttribute('max', '100', 'Number input has correct max value')
      .hasValue('50', 'Number input has correct current value');
  });

  test('invalid type falls back to default NumberInput', async function (assert) {
    await renderConfiguredField(
      42,
      {
        type: 'nonexistent-type',
        prefix: '€',
      },
      'edit',
    );

    assert
      .dom('[data-test-field-container] [data-test-number-input]')
      .exists('Field with invalid type falls back to default NumberInput');
  });

  test('no configuration uses default number input behavior', async function (assert) {
    await renderConfiguredField(123.456, {}, 'edit');

    assert
      .dom('[data-test-field-container] [data-test-number-input]')
      .exists('Field with no configuration uses default NumberInput');

    assert
      .dom('[data-test-field-container] input[type="number"]')
      .exists('Default behavior renders as number input type');
  });

  // Default Config Fallback Tests
  test('rating field edit view falls back to default maxStars of 5 when config is missing', async function (assert) {
    await renderConfiguredField(
      3,
      {
        type: 'rating',
        // No maxStars provided
      },
      'edit',
    );

    assert
      .dom('[data-test-field-container] .star-btn')
      .exists(
        { count: 5 },
        'Rating edit view defaults to 5 stars when maxStars is not provided',
      );

    assert
      .dom('[data-test-field-container] .rating-value')
      .hasText('3/5', 'Rating value shows default maxStars of 5');
  });

  test('slider field edit view falls back to default min of 0 and max of 100 when config is missing', async function (assert) {
    await renderConfiguredField(
      50,
      {
        type: 'slider',
        // No min/max provided
      },
      'edit',
    );

    assert
      .dom('[data-test-field-container] input[type="range"]')
      .hasAttribute('min', '0', 'Slider edit view defaults to min: 0')
      .hasAttribute('max', '100', 'Slider edit view defaults to max: 100');
  });

  test('quantity field edit view falls back to default min of 0 and max of 100 when config is missing', async function (assert) {
    await renderConfiguredField(
      50,
      {
        type: 'quantity',
        // No min/max provided
      },
      'edit',
    );

    assert
      .dom('[data-test-field-container] .qty-input')
      .hasAttribute('min', '0', 'Quantity edit view defaults to min: 0')
      .hasAttribute('max', '100', 'Quantity edit view defaults to max: 100');
  });
});
