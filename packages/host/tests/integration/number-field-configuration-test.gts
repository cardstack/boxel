import { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import { baseRealm, ensureTrailingSlash } from '@cardstack/runtime-common';
import { Loader } from '@cardstack/runtime-common/loader';

import ENV from '@cardstack/host/config/environment';

import {
  testRealmURL,
  setupCardLogs,
  setupLocalIndexing,
  setupIntegrationTestRealm,
} from '../helpers';
import { setupBaseRealm } from '../helpers/base-realm';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { renderCard } from '../helpers/render-component';
import { setupRenderingTest } from '../helpers/setup';

let loader: Loader;

module('Integration | number field configuration', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);

  hooks.beforeEach(function () {
    loader = getService('loader-service').loader;
  });

  setupLocalIndexing(hooks);
  let mockMatrixUtils = setupMockMatrix(hooks);

  setupCardLogs(
    hooks,
    async () => await loader.import(`${baseRealm.url}card-api`),
  );

  hooks.beforeEach(async function (this: RenderingTestContext) {
    const catalogRealmURL = ensureTrailingSlash(ENV.resolvedCatalogRealmURL);

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'test-card.gts': `
          import { field, contains, CardDef, Component } from 'https://cardstack.com/base/card-api';
          import NumberField from '${catalogRealmURL}fields/number';

          export class TestCard extends CardDef {
            @field sliderNumber = contains(NumberField, {
              configuration: {
                presentation: {
                  type: 'slider',
                  min: 0,
                  max: 100,
                  suffix: '%',
                  decimals: 1,
                },
              },
            });

            @field ratingNumber = contains(NumberField, {
              configuration: {
                presentation: {
                  type: 'rating',
                  maxStars: 5,
                },
              },
            });

            @field prefixSuffixNumber = contains(NumberField, {
              configuration: {
                presentation: {
                  prefix: '$',
                  suffix: ' USD',
                  decimals: 2,
                },
              },
            });

            @field decimalsNumber = contains(NumberField, {
              configuration: {
                presentation: {
                  decimals: 3,
                },
              },
            });

            @field minMaxNumber = contains(NumberField, {
              configuration: {
                presentation: {
                  type: 'slider',
                  min: 10,
                  max: 50,
                },
              },
            });

            @field invalidTypeNumber = contains(NumberField, {
              configuration: {
                presentation: {
                  type: 'nonexistent-type',
                  prefix: '€',
                },
              },
            });

            @field noConfigNumber = contains(NumberField);

            static isolated = class Isolated extends Component<typeof this> {
              <template>
                <div data-test-card>
                  <div data-test-slider-field>
                    <@fields.sliderNumber @format='edit' />
                    <@fields.sliderNumber @format='atom' />
                  </div>
                  <div data-test-rating-field>
                    <@fields.ratingNumber @format='edit' />
                    <@fields.ratingNumber @format='atom' />
                  </div>
                  <div data-test-prefix-suffix-field>
                    <@fields.prefixSuffixNumber @format='atom' />
                  </div>
                  <div data-test-decimals-field>
                    <@fields.decimalsNumber @format='atom' />
                  </div>
                  <div data-test-min-max-field>
                    <@fields.minMaxNumber @format='edit' />
                  </div>
                  <div data-test-invalid-type-field>
                    <@fields.invalidTypeNumber @format='edit' />
                  </div>
                  <div data-test-no-config-field>
                    <@fields.noConfigNumber @format='atom' />
                  </div>
                </div>
              </template>
            };
          }
        `,
      },
    });
  });

  test('slider field edit view renders range slider component', async function (assert) {
    let mod = await loader.import(`${testRealmURL}test-card`);
    let { TestCard } = mod as any;
    let card = new TestCard();
    await renderCard(loader, card, 'isolated');

    // Slider edit view uses input with type='range'
    assert
      .dom('[data-test-slider-field] input[type="range"]')
      .exists('Slider field edit view renders as range slider input');
  });

  test('rating field edit view renders star button components', async function (assert) {
    let mod = await loader.import(`${testRealmURL}test-card`);
    let { TestCard } = mod as any;
    let card = new TestCard();
    await renderCard(loader, card, 'isolated');

    // Rating edit view has 5 star buttons
    assert
      .dom('[data-test-rating-field] .star-btn')
      .exists({ count: 5 }, 'Rating field edit view renders 5 star buttons');
  });

  test('rating field atom view shows only one star', async function (assert) {
    let mod = await loader.import(`${testRealmURL}test-card`);
    let { TestCard } = mod as any;
    let card = new TestCard({ ratingNumber: 3 });
    await renderCard(loader, card, 'isolated');

    // Atom view should display only one star icon, not all 5
    assert
      .dom('[data-test-rating-field] [data-test-rating-atom] .atom-star')
      .exists({ count: 1 }, 'Rating field atom view shows only one star');

    // Should also display the numeric value
    assert
      .dom('[data-test-rating-field] [data-test-rating-atom] .atom-value')
      .hasText('3', 'Rating field atom view shows the numeric value');
  });

  test('min and max configuration is applied to slider field', async function (assert) {
    let mod = await loader.import(`${testRealmURL}test-card`);
    let { TestCard } = mod as any;
    let card = new TestCard();
    await renderCard(loader, card, 'isolated');

    // Check min/max attributes on slider input
    const input = document.querySelector(
      '[data-test-min-max-field] input[type="range"]',
    ) as HTMLInputElement;
    assert.strictEqual(
      input.min,
      '10',
      'Slider field respects min configuration (10)',
    );
    assert.strictEqual(
      input.max,
      '50',
      'Slider field respects max configuration (50)',
    );
  });

  test('prefix and suffix are displayed in atom view', async function (assert) {
    let mod = await loader.import(`${testRealmURL}test-card`);
    let { TestCard } = mod as any;
    let card = new TestCard();
    await renderCard(loader, card, 'isolated');

    // Atom view shows formatted value with prefix and suffix
    assert
      .dom('[data-test-prefix-suffix-field] [data-test-number-field-atom]')
      .hasText(
        '$0.00 USD',
        'Atom view displays prefix ($), formatted value (0.00), and suffix ( USD)',
      );
  });

  test('decimals configuration controls decimal places in atom view', async function (assert) {
    let mod = await loader.import(`${testRealmURL}test-card`);
    let { TestCard } = mod as any;
    let card = new TestCard();
    await renderCard(loader, card, 'isolated');

    // Decimals: 3 should show 3 decimal places
    assert
      .dom('[data-test-decimals-field] [data-test-number-field-atom]')
      .hasText('0.000', 'Atom view shows 3 decimal places when decimals: 3');
  });

  test('field with invalid type falls back to default NumberInput', async function (assert) {
    let mod = await loader.import(`${testRealmURL}test-card`);
    let { TestCard } = mod as any;
    let card = new TestCard();
    await renderCard(loader, card, 'isolated');

    // When type is invalid (not 'slider' or 'rating'), falls back to number input
    assert
      .dom('[data-test-invalid-type-field] [data-test-number-input]')
      .exists(
        'Field with invalid type (nonexistent-type) falls back to default number input',
      );
  });

  test('field without type configuration uses default number input', async function (assert) {
    let mod = await loader.import(`${testRealmURL}test-card`);
    let { TestCard } = mod as any;
    let card = new TestCard();
    await renderCard(loader, card, 'isolated');

    // Without type, uses default formatting (no prefix/suffix, 0 decimals)
    assert
      .dom('[data-test-no-config-field] [data-test-number-field-atom]')
      .hasText('0', 'Field without configuration renders plain value');
  });
});
