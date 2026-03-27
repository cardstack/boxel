import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupRenderingTest } from 'test-app/tests/helpers';
import { formatPeriod } from '@cardstack/boxel-ui/helpers';

module('Integration | helpers | formatPeriod', function (hooks) {
  setupRenderingTest(hooks);

  test('basic period formatting', async function (assert) {
    await render(<template>{{formatPeriod '2024-Q1'}}</template>);
    assert.dom().hasText('Q1 2024', 'formats basic quarterly period');

    await render(<template>{{formatPeriod '2024-01'}}</template>);
    assert.dom().hasText('Jan 2024', 'formats monthly period');

    await render(<template>{{formatPeriod '2024'}}</template>);
    assert.dom().hasText('2024', 'formats yearly period');
  });

  test('period size variants', async function (assert) {
    await render(<template>{{formatPeriod '2024-Q2' size='tiny'}}</template>);
    assert.dom().hasText('Q2', 'tiny size shows abbreviated form');

    await render(<template>{{formatPeriod '2024-Q2' size='short'}}</template>);
    assert.dom().hasText('Q2 24', 'short size shows abbreviated year');

    await render(<template>{{formatPeriod '2024-Q2' size='long'}}</template>);
    assert.dom().hasText('Quarter 2, 2024', 'long size spells out quarter');
  });

  test('period with range', async function (assert) {
    await render(
      <template>{{formatPeriod '2024-Q1' withRange=true}}</template>,
    );
    assert.dom().hasText('Q1 2024 (Jan - Mar)', 'shows quarter range');

    await render(
      <template>{{formatPeriod '2024-06' withRange=true}}</template>,
    );
    assert.dom().hasText('Jun 2024 (1-30)', 'shows monthly range');

    await render(<template>{{formatPeriod '2024' withRange=true}}</template>);
    assert.dom().hasText('2024 (Jan - Dec)', 'shows yearly range');
  });

  test('period edge cases', async function (assert) {
    await render(
      <template>{{formatPeriod null fallback='No period'}}</template>,
    );
    assert.dom().hasText('No period', 'uses fallback for null');

    await render(
      <template>{{formatPeriod undefined fallback='Unknown period'}}</template>,
    );
    assert.dom().hasText('Unknown period', 'uses fallback for undefined');

    await render(
      <template>{{formatPeriod '' fallback='Empty period'}}</template>,
    );
    assert.dom().hasText('Empty period', 'uses fallback for empty string');
  });

  test('various period formats', async function (assert) {
    await render(<template>{{formatPeriod '2024-Q3'}}</template>);
    assert.dom().hasText('Q3 2024', 'formats Q3');

    await render(<template>{{formatPeriod '2024-Q4'}}</template>);
    assert.dom().hasText('Q4 2024', 'formats Q4');

    await render(<template>{{formatPeriod '2024-12'}}</template>);
    assert.dom().hasText('Dec 2024', 'formats December');

    await render(<template>{{formatPeriod '2024-03'}}</template>);
    assert.dom().hasText('Mar 2024', 'formats March');
  });

  test('localization', async function (assert) {
    await render(
      <template>{{formatPeriod '2024-Q1' locale='es-ES'}}</template>,
    );
    assert.dom().hasText('T1 2024', 'Spanish quarter formatting');

    await render(
      <template>{{formatPeriod '2024-01' locale='fr-FR'}}</template>,
    );
    assert.dom().hasText('jan. 2024', 'French month formatting');

    await render(
      <template>{{formatPeriod '2024-Q2' locale='de-DE'}}</template>,
    );
    assert.dom().hasText('Q2 2024', 'German quarter formatting');
  });

  test('invalid period handling', async function (assert) {
    await render(
      <template>
        {{formatPeriod 'invalid-period' fallback='Invalid format'}}
      </template>,
    );
    assert.dom().hasText('Invalid format', 'handles invalid period format');

    await render(
      <template>
        {{formatPeriod '2024-Q5' fallback='Invalid quarter'}}
      </template>,
    );
    assert.dom().hasText('Invalid quarter', 'handles invalid quarter');

    await render(
      <template>{{formatPeriod '2024-13' fallback='Invalid month'}}</template>,
    );
    assert.dom().hasText('Invalid month', 'handles invalid month');
  });

  test('fiscal year periods', async function (assert) {
    await render(<template>{{formatPeriod 'FY2024-Q1'}}</template>);
    assert.dom().hasText('FY Q1 2024', 'formats fiscal year quarter');

    await render(<template>{{formatPeriod 'FY2024'}}</template>);
    assert.dom().hasText('FY 2024', 'formats fiscal year');
  });

  test('half-year periods', async function (assert) {
    await render(<template>{{formatPeriod '2024-H1'}}</template>);
    assert.dom().hasText('H1 2024', 'formats first half');

    await render(<template>{{formatPeriod '2024-H2'}}</template>);
    assert.dom().hasText('H2 2024', 'formats second half');

    await render(
      <template>{{formatPeriod '2024-H1' withRange=true}}</template>,
    );
    assert.dom().hasText('H1 2024 (Jan - Jun)', 'shows half-year range');
  });

  test('period comparison formatting', async function (assert) {
    await render(
      <template>
        {{formatPeriod '2024-Q1' size='long' withRange=true}}
      </template>,
    );
    assert
      .dom()
      .hasText(
        'Quarter 1, 2024 (January - March)',
        'long format with full range',
      );

    await render(
      <template>
        {{formatPeriod '2024-01' size='long' withRange=true}}
      </template>,
    );
    assert.dom().hasText('January 2024 (1-31)', 'long month with day range');
  });

  module('JavaScript function usage', function () {
    test('formatPeriod function can be called directly', async function (assert) {
      const result = formatPeriod('2024-Q2', { size: 'short' });
      assert.strictEqual(result, 'Q2 24', 'function returns formatted period');

      const rangeResult = formatPeriod('2024-Q1', {
        withRange: true,
        fallback: 'No period',
      });
      assert.strictEqual(
        rangeResult,
        'Q1 2024 (Jan - Mar)',
        'function handles range formatting',
      );
    });
  });
});
