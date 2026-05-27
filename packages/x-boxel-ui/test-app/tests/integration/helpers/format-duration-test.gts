import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupRenderingTest } from 'test-app/tests/helpers';
import { formatDuration } from '@cardstack/boxel-ui/helpers';

module('Integration | helpers | formatDuration', function (hooks) {
  setupRenderingTest(hooks);

  test('humanized duration formatting', async function (assert) {
    await render(<template>{{formatDuration 7380}}</template>); // 2 hours, 3 minutes
    assert.dom().hasText('2 hours', 'humanizes duration by default');

    await render(
      <template>{{formatDuration 7380 format='humanize'}}</template>,
    );
    assert.dom().hasText('2 hours', 'explicit humanize format');
  });

  test('timer format', async function (assert) {
    await render(<template>{{formatDuration 7380 format='timer'}}</template>);
    assert.dom().hasText('2:03:00', 'timer format shows HH:MM:SS');

    await render(<template>{{formatDuration 65 format='timer'}}</template>);
    assert
      .dom()
      .hasText('1:05', 'timer format shows MM:SS for short durations');
  });

  test('short format', async function (assert) {
    await render(<template>{{formatDuration 7380 format='short'}}</template>);
    assert.dom().hasText('2h 3m', 'short format with abbreviated units');

    await render(<template>{{formatDuration 90 format='short'}}</template>);
    assert.dom().hasText('1m 30s', 'short format for minutes and seconds');
  });

  test('long format', async function (assert) {
    await render(<template>{{formatDuration 7380 format='long'}}</template>);
    assert.dom().hasText('2 hours, 3 minutes', 'long format spells out units');

    await render(<template>{{formatDuration 90 format='long'}}</template>);
    assert
      .dom()
      .hasText('1 minute, 30 seconds', 'long format for smaller durations');
  });

  test('different input units', async function (assert) {
    await render(
      <template>{{formatDuration 7380000 unit='milliseconds'}}</template>,
    );
    assert.dom().hasText('2 hours', 'converts from milliseconds');

    await render(<template>{{formatDuration 123 unit='minutes'}}</template>);
    assert.dom().hasText('2 hours', 'converts from minutes');

    await render(<template>{{formatDuration 2.5 unit='hours'}}</template>);
    assert.dom().hasText('2 hours', 'converts from hours');

    await render(<template>{{formatDuration 1.5 unit='days'}}</template>);
    assert.dom().hasText('1 day', 'converts from days');
  });

  test('duration edge cases', async function (assert) {
    await render(<template>{{formatDuration 0}}</template>);
    assert.dom().hasText('0 seconds', 'handles zero duration');

    await render(
      <template>{{formatDuration null fallback='No duration'}}</template>,
    );
    assert.dom().hasText('No duration', 'uses fallback for null');

    await render(
      <template>
        {{formatDuration undefined fallback='Unknown duration'}}
      </template>,
    );
    assert.dom().hasText('Unknown duration', 'uses fallback for undefined');
  });

  test('extreme durations', async function (assert) {
    const geologicalTime = 365 * 24 * 60 * 60 * 1000000; // 1 million years in seconds

    await render(
      <template>{{formatDuration geologicalTime format='humanize'}}</template>,
    );
    assert.dom().hasText('1000000 years', 'handles geological time scales');
  });

  test('invalid duration handling', async function (assert) {
    await render(
      <template>
        {{! @glint-expect-error: invalid input type }}
        {{formatDuration 'not-a-number' fallback='Invalid duration'}}
      </template>,
    );
    assert.dom().hasText('Invalid duration', 'handles non-numeric input');

    await render(<template>{{formatDuration 123.45 format='timer'}}</template>);
    assert.dom().hasText('2:03', 'handles decimal duration in timer format');
  });

  test('format options edge cases', async function (assert) {
    await render(
      <template>
        {{! @glint-expect-error: invalid format }}
        {{formatDuration 3600 format='invalid' fallback='Invalid format'}}
      </template>,
    );
    assert.dom().hasText('Invalid format', 'handles invalid format option');

    await render(
      <template>
        {{! @glint-expect-error: invalid unit }}
        {{formatDuration 3600 unit='invalid' fallback='Invalid unit'}}
      </template>,
    );
    assert.dom().hasText('Invalid unit', 'handles invalid unit option');

    await render(
      <template>
        {{! @glint-expect-error: invalid format }}
        {{formatDuration 3600 format=123 fallback='Numeric format'}}
      </template>,
    );
    assert.dom().hasText('Numeric format', 'handles numeric format option');
  });

  test('localization', async function (assert) {
    await render(
      <template>{{formatDuration 7380 format='long' locale='es-ES'}}</template>,
    );
    assert.dom().hasText('2 horas, 3 minutos', 'Spanish duration formatting');

    await render(
      <template>{{formatDuration 7380 format='long' locale='fr-FR'}}</template>,
    );
    assert.dom().hasText('2 heures, 3 minutes', 'French duration formatting');
  });

  module('JavaScript function usage', function () {
    test('formatDuration function can be called directly', async function (assert) {
      const result = formatDuration(7380, { format: 'short' });
      assert.strictEqual(
        result,
        '2h 3m',
        'function returns formatted duration',
      );

      const timerResult = formatDuration(125, {
        format: 'timer',
        fallback: 'No duration',
      });
      assert.strictEqual(timerResult, '2:05', 'function handles timer format');
    });
  });
});
