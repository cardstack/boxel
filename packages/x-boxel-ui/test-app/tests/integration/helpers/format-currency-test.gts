import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupRenderingTest } from 'test-app/tests/helpers';
import { formatCurrency } from '@cardstack/boxel-ui/helpers';

module('Integration | helpers | formatCurrency', function (hooks) {
  setupRenderingTest(hooks);

  test('basic currency formatting', async function (assert) {
    await render(<template>{{formatCurrency 1234.56}}</template>);
    assert.dom().hasText('$1,234.56', 'formats basic USD currency');
  });

  test('currency with different currencies', async function (assert) {
    await render(
      <template>{{formatCurrency 1234.56 currency='EUR'}}</template>,
    );
    assert.dom().hasText('€1,234.56', 'formats EUR currency');

    await render(
      <template>{{formatCurrency 1234.56 currency='JPY'}}</template>,
    );
    assert.dom().hasText('¥1,235', 'formats JPY currency (no decimals)');
  });

  test('currency size variants', async function (assert) {
    await render(
      <template>{{formatCurrency 1234567.89 size='tiny'}}</template>,
    );
    assert.dom().hasText('$1.2M', 'tiny size uses compact notation');

    await render(
      <template>{{formatCurrency 1234567.89 size='short'}}</template>,
    );
    assert.dom().hasText('$1,234,568', 'short size drops decimals');

    await render(
      <template>{{formatCurrency 1234567.89 size='medium'}}</template>,
    );
    assert.dom().hasText('$1,234,567.89', 'medium size shows full precision');

    await render(
      <template>
        {{formatCurrency 1234567.89 size='long' currency='USD'}}
      </template>,
    );
    assert
      .dom()
      .hasText('1,234,567.89 US dollars', 'long size spells out currency');
  });

  test('currency edge cases', async function (assert) {
    await render(<template>{{formatCurrency 0}}</template>);
    assert.dom().hasText('$0.00', 'handles zero');

    await render(<template>{{formatCurrency -1234.56}}</template>);
    assert.dom().hasText('-$1,234.56', 'handles negative numbers');

    await render(
      <template>{{formatCurrency null fallback='No price'}}</template>,
    );
    assert.dom().hasText('No price', 'uses fallback for null');
  });

  test('currency localization', async function (assert) {
    const amount = 1234567.89;

    await render(
      <template>
        {{formatCurrency amount currency='USD' locale='en-US'}}
      </template>,
    );
    assert.dom().hasText('$1,234,567.89', 'formats USD in US locale');

    await render(
      <template>
        {{formatCurrency amount currency='EUR' locale='de-DE'}}
      </template>,
    );
    assert.dom().hasText('1.234.567,89\u00A0€', 'formats EUR in German locale');

    await render(
      <template>
        {{formatCurrency amount currency='JPY' locale='ja-JP'}}
      </template>,
    );
    assert.dom().hasText('￥1,234,568', 'formats JPY in Japanese locale');
  });

  test('currency with invalid inputs', async function (assert) {
    let PosInfinity = Number.POSITIVE_INFINITY;
    await render(
      <template>
        {{formatCurrency PosInfinity fallback='Invalid amount'}}
      </template>,
    );
    assert.dom().hasText('Invalid amount', 'handles Infinity input');

    await render(
      <template>{{formatCurrency undefined fallback='No amount'}}</template>,
    );
    assert.dom().hasText('No amount', 'handles undefined input');
  });

  test('currency with extreme values', async function (assert) {
    await render(
      <template>{{formatCurrency 9007199254740991 size='tiny'}}</template>,
    );
    assert.dom().hasText('$9007.2T', 'handles max safe integer');
  });

  module('JavaScript function usage', function () {
    test('formatCurrency function can be called directly', async function (assert) {
      const result = formatCurrency(1234.56, { currency: 'USD' });
      assert.strictEqual(
        result,
        '$1,234.56',
        'function returns formatted currency',
      );

      const resultWithOptions = formatCurrency(1000000, {
        currency: 'EUR',
        size: 'tiny',
      });
      assert.strictEqual(
        resultWithOptions,
        '€1M',
        'function handles options correctly',
      );
    });
  });
});
