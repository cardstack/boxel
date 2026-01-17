import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupRenderingTest } from 'test-app/tests/helpers';
import { formatCountdown } from '@cardstack/boxel-ui/helpers';

module('Integration | helpers | formatCountdown', function (hooks) {
  setupRenderingTest(hooks);

  test('basic countdown formatting', async function (assert) {
    const twoHoursFromNow = new Date(Date.now() + 2 * 60 * 60 * 1000);

    await render(<template>{{formatCountdown twoHoursFromNow}}</template>);
    assert.dom().hasText('2:00:00', 'formats basic countdown');
  });

  test('countdown component visibility', async function (assert) {
    const oneDayFromNow = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await render(
      <template>{{formatCountdown oneDayFromNow showDays=true}}</template>,
    );
    assert.dom().hasText('1 day, 0:00:00', 'shows days when enabled');

    await render(
      <template>{{formatCountdown oneDayFromNow showDays=false}}</template>,
    );
    assert.dom().hasText('24:00:00', 'hides days when disabled');

    const twoMinutesFromNow = new Date(Date.now() + 2 * 60 * 1000);

    await render(
      <template>
        {{formatCountdown twoMinutesFromNow showSeconds=true}}
      </template>,
    );
    assert.dom().hasText('0:02:00', 'shows seconds when enabled');

    await render(
      <template>
        {{formatCountdown twoMinutesFromNow showSeconds=false}}
      </template>,
    );
    assert.dom().hasText('0:02', 'hides seconds when disabled');
  });

  test('countdown granularity options', async function (assert) {
    const futureTime = new Date(
      Date.now() + 2 * 60 * 60 * 1000 + 30 * 60 * 1000 + 45 * 1000,
    );

    await render(
      <template>
        {{formatCountdown
          futureTime
          showDays=true
          showHours=true
          showMinutes=true
          showSeconds=true
        }}
      </template>,
    );
    assert
      .dom()
      .hasText('0 days, 2:30:45', 'shows all components when enabled');

    await render(
      <template>
        {{formatCountdown
          futureTime
          showDays=false
          showHours=true
          showMinutes=true
          showSeconds=false
        }}
      </template>,
    );
    assert.dom().hasText('2:30', 'shows only hours and minutes');

    await render(
      <template>
        {{formatCountdown
          futureTime
          showDays=true
          showHours=false
          showMinutes=false
          showSeconds=false
        }}
      </template>,
    );
    assert.dom().hasText('0 days', 'shows only days');
  });

  test('past event handling', async function (assert) {
    const pastEvent = new Date(Date.now() - 60 * 60 * 1000);

    await render(<template>{{formatCountdown pastEvent}}</template>);
    assert.dom().hasText('Expired', 'shows expired for past events');

    await render(
      <template>
        {{formatCountdown pastEvent fallback='Event finished'}}
      </template>,
    );
    assert.dom().hasText('Event finished', 'uses fallback for past events');
  });

  test('countdown edge cases', async function (assert) {
    await render(
      <template>{{formatCountdown null fallback='No event'}}</template>,
    );
    assert.dom().hasText('No event', 'uses fallback for null');

    await render(
      <template>{{formatCountdown undefined fallback='No date set'}}</template>,
    );
    assert.dom().hasText('No date set', 'uses fallback for undefined');

    const now = new Date();
    await render(<template>{{formatCountdown now}}</template>);
    assert.dom().hasText('0:00:00', 'handles current time');
  });

  test('string date input', async function (assert) {
    const futureDate = new Date(Date.now() + 60 * 60 * 1000);
    const futureDateString = futureDate.toISOString();

    await render(<template>{{formatCountdown futureDateString}}</template>);
    assert.dom().hasText('1:00:00', 'handles string date input');
  });

  test('boundary countdown conditions', async function (assert) {
    const farFuture = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

    await render(
      <template>{{formatCountdown farFuture showDays=true}}</template>,
    );
    assert.dom().hasText('365 days, 0:00:00', 'handles far future countdown');

    const oneSecondFromNow = new Date(Date.now() + 1000);

    await render(
      <template>
        {{formatCountdown oneSecondFromNow showSeconds=true}}
      </template>,
    );
    assert.dom().hasText('0:00:01', 'handles very short countdown');
  });

  test('localization', async function (assert) {
    const oneDayFromNow = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await render(
      <template>
        {{formatCountdown oneDayFromNow showDays=true locale='en-US'}}
      </template>,
    );
    assert.dom().hasText('1 day, 0:00:00', 'English countdown formatting');

    await render(
      <template>
        {{formatCountdown oneDayFromNow showDays=true locale='es-ES'}}
      </template>,
    );
    assert.dom().hasText('1 día, 0:00:00', 'Spanish countdown formatting');

    await render(
      <template>
        {{formatCountdown oneDayFromNow showDays=true locale='fr-FR'}}
      </template>,
    );
    assert.dom().hasText('1 jour, 0:00:00', 'French countdown formatting');
  });

  test('invalid date handling', async function (assert) {
    await render(
      <template>
        {{formatCountdown 'invalid-date' fallback='Invalid event date'}}
      </template>,
    );
    assert.dom().hasText('Invalid event date', 'handles invalid date strings');

    await render(
      <template>{{formatCountdown 'not-a-date' fallback='Bad date'}}</template>,
    );
    assert.dom().hasText('Bad date', 'handles non-date strings');
  });

  test('multiple days countdown', async function (assert) {
    const multipleDaysFromNow = new Date(
      Date.now() + 5 * 24 * 60 * 60 * 1000 + 3 * 60 * 60 * 1000,
    );

    await render(
      <template>
        {{formatCountdown multipleDaysFromNow showDays=true}}
      </template>,
    );
    assert.dom().hasText('5 days, 3:00:00', 'handles multiple days countdown');
  });

  test('urgent countdown display', async function (assert) {
    const urgentTime = new Date(Date.now() + 30 * 1000); // 30 seconds

    await render(
      <template>{{formatCountdown urgentTime showSeconds=true}}</template>,
    );
    assert.dom().hasText('0:00:30', 'shows urgent countdown with seconds');

    const criticalTime = new Date(Date.now() + 5 * 1000); // 5 seconds

    await render(
      <template>{{formatCountdown criticalTime showSeconds=true}}</template>,
    );
    assert.dom().hasText('0:00:05', 'shows critical countdown');
  });

  module('JavaScript function usage', function () {
    test('formatCountdown function can be called directly', async function (assert) {
      const eventDate = new Date(Date.now() + 2 * 60 * 60 * 1000);

      const result = formatCountdown(eventDate, { showSeconds: true });
      assert.strictEqual(
        result,
        '2:00:00',
        'function returns formatted countdown',
      );

      const daysResult = formatCountdown(eventDate, {
        showDays: true,
        fallback: 'No event',
      });
      assert.strictEqual(
        daysResult,
        '0 days, 2:00:00',
        'function handles days display',
      );
    });
  });
});
