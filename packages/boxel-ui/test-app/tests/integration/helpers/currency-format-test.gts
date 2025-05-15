import { module, test } from 'qunit';
import {
  click,
  fillIn,
  find,
  render,
  settled,
  typeIn,
} from '@ember/test-helpers';
import { setupRenderingTest } from 'test-app/tests/helpers';
import { currencyFormat } from '@cardstack/boxel-ui/helpers';

module('Integration | helpers | currencyFormat test', function (hooks) {
  setupRenderingTest(hooks);

  test('it formats with default USD currency', async function (assert) {
    await render(<template>{{currencyFormat 123.45}}</template>);
    assert.dom().hasText('$123.45', 'formats as US dollars');

    await render(<template>{{currencyFormat 1000}}</template>);
    assert.dom().hasText('$1,000.00', 'formats with commas for thousands');
  });

  test('it handles custom currencies', async function (assert) {
    await render(<template>{{currencyFormat 100 'EUR'}}</template>);
    assert.dom().hasText('€100.00', 'formats as euros');

    await render(<template>{{currencyFormat 100 'JPY'}}</template>);
    assert.dom().hasText('¥100', 'formats as yen');

    await render(<template>{{currencyFormat 100 'GBP'}}</template>);
    assert.dom().hasText('£100.00', 'formats as pounds');
  });

  test('it handles edge cases', async function (assert) {
    await render(<template>{{currencyFormat 0}}</template>);
    assert.dom().hasText('$0.00', 'formats zero correctly');

    await render(<template>{{currencyFormat -50.25}}</template>);
    assert.dom().hasText('-$50.25', 'formats negative numbers correctly');

    await render(<template>{{currencyFormat 1000000}}</template>);
    assert.dom().hasText('$1,000,000.00', 'formats large numbers correctly');
  });
});
