import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupRenderingTest } from 'test-app/tests/helpers';
import { formatNumber } from '@cardstack/boxel-ui/helpers';
import { array } from '@ember/helper';

module('Integration | helpers | formatNumber', function (hooks) {
  setupRenderingTest(hooks);

  test('basic number formatting', async function (assert) {
    await render(<template>{{formatNumber 1234.5678}}</template>);
    assert.dom().hasText('1,234.57', 'formats basic numbers with commas');
  });

  test('number size variants', async function (assert) {
    await render(<template>{{formatNumber 1234567 size='tiny'}}</template>);
    assert.dom().hasText('1.2M', 'tiny size uses compact notation');

    await render(<template>{{formatNumber 1234567 size='short'}}</template>);
    assert.dom().hasText('1,234,567', 'short size full number');

    await render(<template>{{formatNumber 1234567 size='medium'}}</template>);
    assert.dom().hasText('1,234,567.00', 'medium size with decimals');

    await render(<template>{{formatNumber 1234567 size='long'}}</template>);
    assert.dom().hasText('1,234,567.0000', 'long size with more decimals');
  });

  test('percentage formatting', async function (assert) {
    await render(<template>{{formatNumber 0.1235 style='percent'}}</template>);
    assert.dom().hasText('12.35%', 'formats as percentage');

    await render(
      <template>{{formatNumber 0.1235 style='percent' size='tiny'}}</template>,
    );
    assert.dom().hasText('12%', 'tiny percentage without decimals');

    await render(
      <template>{{formatNumber 0.1235 style='percent' size='short'}}</template>,
    );
    assert.dom().hasText('12.4%', 'short percentage with minimal decimals');
  });

  test('precision control', async function (assert) {
    await render(
      <template>{{formatNumber 1234.5 minimumFractionDigits=4}}</template>,
    );
    assert.dom().hasText('1,234.5000', 'minimum fraction digits');

    await render(
      <template>{{formatNumber 1234.56789 maximumFractionDigits=2}}</template>,
    );
    assert.dom().hasText('1,234.57', 'maximum fraction digits');
  });

  test('number edge cases', async function (assert) {
    await render(<template>{{formatNumber 0}}</template>);
    assert.dom().hasText('0', 'handles zero');

    await render(<template>{{formatNumber -1234.56}}</template>);
    assert.dom().hasText('-1,234.56', 'handles negative numbers');

    await render(
      <template>{{formatNumber null fallback='No number'}}</template>,
    );
    assert.dom().hasText('No number', 'uses fallback for null');
  });

  test('number localization', async function (assert) {
    const number = 1234567.89;

    await render(<template>{{formatNumber number locale='en-US'}}</template>);
    assert.dom().hasText('1,234,567.89', 'US number formatting');

    await render(<template>{{formatNumber number locale='de-DE'}}</template>);
    assert.dom().hasText('1.234.567,89', 'German number formatting');

    await render(<template>{{formatNumber number locale='fr-FR'}}</template>);
    assert.dom().hasText('1\u202F234\u202F567,89', 'French number formatting');

    await render(
      <template>
        {{formatNumber 0.1235 style='percent' locale='tr-TR'}}
      </template>,
    );
    assert.dom().hasText('%12,35', 'Turkish percentage format');
  });

  test('invalid number handling', async function (assert) {
    await render(
      <template>
        {{! @glint-expect-error: invalid input type }}
        {{formatNumber 'not-a-number' fallback='Invalid number'}}
      </template>,
    );
    assert.dom().hasText('Invalid number', 'handles non-numeric strings');

    await render(
      <template>
        {{! @glint-expect-error: invalid input type }}
        {{formatNumber (array 1 2 3) fallback='Array input'}}
      </template>,
    );
    assert.dom().hasText('Array input', 'handles array input');

    await render(
      <template>
        {{formatNumber undefined fallback='Undefined input'}}
      </template>,
    );
    assert.dom().hasText('Undefined input', 'handles undefined input');
  });

  test('currency style formatting', async function (assert) {
    await render(
      <template>
        {{formatNumber 1234.56 style='currency' currency='USD' locale='en-US'}}
      </template>,
    );
    assert.dom().hasText('$1,234.56', 'formats currency style USD');

    await render(
      <template>
        {{formatNumber 1234.56 style='currency' currency='EUR' locale='de-DE'}}
      </template>,
    );
    assert.dom().hasText('1.234,56\u00A0€', 'formats currency style EUR');
  });

  test('decimal style formatting', async function (assert) {
    await render(
      <template>{{formatNumber 1234.567 style='decimal'}}</template>,
    );
    assert.dom().hasText('1,234.567', 'formats decimal style');

    await render(
      <template>
        {{formatNumber 1234.567 style='decimal' maximumFractionDigits=1}}
      </template>,
    );
    assert.dom().hasText('1,234.6', 'formats decimal with precision limit');
  });

  module('JavaScript function usage', function () {
    test('formatNumber function can be called directly', async function (assert) {
      const result = formatNumber(1234.567, { maximumFractionDigits: 2 });
      assert.strictEqual(
        result,
        '1,234.57',
        'function returns formatted number',
      );

      const percentResult = formatNumber(0.1235, {
        style: 'percent',
        size: 'short',
      });
      assert.strictEqual(
        percentResult,
        '12.4%',
        'function handles percentage formatting',
      );
    });
  });
});
