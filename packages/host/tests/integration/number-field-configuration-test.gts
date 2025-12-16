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
    value: unknown,
    configuration: any,
    format: FieldFormat = 'atom',
  ) {
    const fieldFormat = format;

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

  // ============================================
  // Presentation Mode Rendering Tests
  // ============================================

  test('each presentation mode renders correct embedded component', async function (assert) {
    const presentations = [
      { mode: 'standard', embeddedClass: '[data-test-number-field-embedded]' },
      { mode: 'stat', embeddedClass: '.stat-field-embedded' },
      { mode: 'score', embeddedClass: '.score-field-embedded' },
      { mode: 'progress-bar', embeddedClass: '.progress-bar-container' },
      { mode: 'progress-circle', embeddedClass: '.progress-circle-container' },
      {
        mode: 'badge-notification',
        embeddedClass: '.badge-notification-embedded',
      },
      { mode: 'badge-metric', embeddedClass: '.badge-metric-embedded' },
      { mode: 'badge-counter', embeddedClass: '.badge-counter-embedded' },
      { mode: 'gauge', embeddedClass: '.gauge-embedded' },
    ];

    for (const { mode, embeddedClass } of presentations) {
      await renderConfiguredField(50, { presentation: mode }, 'embedded');
      assert
        .dom(`[data-test-field-container] ${embeddedClass}`)
        .exists(`${mode} presentation renders correct embedded component`);
    }
  });

  // ============================================
  // Options Configuration Tests
  // ============================================

  test('prefix/suffix/decimals options work correctly', async function (assert) {
    await renderConfiguredField(
      100.5,
      {
        presentation: 'standard',
        options: {
          prefix: '$',
          suffix: ' USD',
          decimals: 2,
        },
      },
      'atom',
    );

    assert
      .dom('[data-test-field-container] [data-test-number-field-atom]')
      .hasTextContaining('$100.50 USD', 'Prefix/suffix/decimals are applied');
  });

  test('min/max options work in edit mode', async function (assert) {
    await renderConfiguredField(
      200,
      {
        presentation: 'standard',
        options: {
          min: 0,
          max: 100,
        },
      },
      'edit',
    );

    assert
      .dom('[data-test-field-container] input[type="number"]')
      .hasAttribute('min', '0', 'Edit mode respects min')
      .hasAttribute('max', '100', 'Edit mode respects max');
  });

  test('valueFormat percentage with suffix works correctly', async function (assert) {
    await renderConfiguredField(
      75,
      {
        presentation: 'progress-bar',
        options: {
          min: 0,
          max: 100,
          valueFormat: 'percentage',
          suffix: 'completed',
          showValue: true,
        },
      },
      'embedded',
    );

    assert
      .dom('[data-test-field-container]')
      .hasTextContaining('75% completed', 'Percentage format appends suffix');
  });

  test('badge-notification respects max option for overflow', async function (assert) {
    await renderConfiguredField(
      150,
      {
        presentation: 'badge-notification',
        options: {
          max: 99,
        },
      },
      'atom',
    );

    assert
      .dom('[data-test-field-container] .badge-count')
      .hasText('99+', 'Shows overflow indicator when max exceeded');
  });

  // ============================================
  // Error Handling and Fallback Tests
  // ============================================

  test('invalid presentation falls back to standard', async function (assert) {
    await renderConfiguredField(
      42,
      {
        presentation: 'nonexistent-presentation',
        options: {
          prefix: '$',
        },
      },
      'atom',
    );

    assert
      .dom('[data-test-field-container] [data-test-number-field-atom]')
      .exists('Invalid presentation falls back to standard');

    assert
      .dom('[data-test-field-container] [data-test-number-field-atom]')
      .hasTextContaining('$42', 'Fallback still respects options');
  });

  test('missing presentation defaults to standard', async function (assert) {
    await renderConfiguredField(42, {}, 'atom');

    assert
      .dom('[data-test-field-container] [data-test-number-field-atom]')
      .exists('Missing presentation defaults to standard');
  });

  test('wrong type in options is ignored gracefully', async function (assert) {
    await renderConfiguredField(
      75,
      {
        presentation: 'stat',
        options: {
          min: 'invalid' as any,
          max: 'invalid' as any,
          decimals: 'not-a-number' as any,
        },
      },
      'embedded',
    );

    assert
      .dom('[data-test-field-container] .stat-field-embedded')
      .exists('Renders even with wrong option types');

    assert
      .dom('[data-test-field-container] .stat-footer')
      .doesNotExist('Does not show range with invalid min/max');
  });

  test('null/undefined value is handled gracefully', async function (assert) {
    await renderConfiguredField(
      null,
      {
        presentation: 'stat',
        options: {
          placeholder: 'No value',
        },
      },
      'embedded',
    );

    assert
      .dom('[data-test-field-container] .stat-value')
      .hasText('No value', 'Shows placeholder for null value');
  });

  // ============================================
  // Edit Mode Tests
  // ============================================

  test('edit mode always uses NumberInput regardless of presentation', async function (assert) {
    await renderConfiguredField(
      50,
      {
        presentation: 'stat',
        options: {
          prefix: '$',
          suffix: ' USD',
        },
      },
      'edit',
    );

    assert
      .dom('[data-test-field-container] [data-test-number-input]')
      .exists('Edit mode uses NumberInput for all presentations');

    assert
      .dom('[data-test-field-container] input[type="number"]')
      .exists('Edit mode renders number input');
  });

  test('edit mode extracts compatible options from any presentation', async function (assert) {
    await renderConfiguredField(
      75,
      {
        presentation: 'progress-bar',
        options: {
          min: 0,
          max: 100,
          prefix: '$',
          suffix: ' USD',
          decimals: 2,
          useGradient: true,
          showValue: true,
        },
      },
      'edit',
    );

    assert
      .dom('[data-test-field-container] input[type="number"]')
      .hasAttribute('min', '0', 'Extracts min from options')
      .hasAttribute('max', '100', 'Extracts max from options');
  });
});
