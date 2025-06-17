import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupRenderingTest } from 'test-app/tests/helpers';
import { formatRelativeTime } from '@cardstack/boxel-ui/helpers';

module('Integration | helpers | formatRelativeTime', function (hooks) {
  setupRenderingTest(hooks);

  test('basic relative time formatting', async function (assert) {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

    await render(<template>{{formatRelativeTime twoHoursAgo}}</template>);
    assert.dom().hasText('2 hours ago', 'formats basic relative time');
  });

  test('relative time size variants', async function (assert) {
    const threeMinutesAgo = new Date(Date.now() - 3 * 60 * 1000);

    await render(<template>
      {{formatRelativeTime threeMinutesAgo size='tiny'}}
    </template>);
    assert.dom().hasText('3m', 'tiny size uses abbreviated format');

    await render(<template>
      {{formatRelativeTime threeMinutesAgo size='medium'}}
    </template>);
    assert.dom().hasText('3 minutes ago', 'medium size uses full format');
  });

  test('various time intervals', async function (assert) {
    const now = new Date();

    const thirtySecondsAgo = new Date(now.getTime() - 30 * 1000);
    await render(<template>{{formatRelativeTime thirtySecondsAgo}}</template>);
    assert.dom().hasText('30 seconds ago', 'formats seconds ago');

    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
    await render(<template>{{formatRelativeTime fiveMinutesAgo}}</template>);
    assert.dom().hasText('5 minutes ago', 'formats minutes ago');

    const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000);
    await render(<template>{{formatRelativeTime sixHoursAgo}}</template>);
    assert.dom().hasText('6 hours ago', 'formats hours ago');

    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    await render(<template>{{formatRelativeTime threeDaysAgo}}</template>);
    assert.dom().hasText('3 days ago', 'formats days ago');

    const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    await render(<template>{{formatRelativeTime twoWeeksAgo}}</template>);
    assert.dom().hasText('2 weeks ago', 'formats weeks ago');

    const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    await render(<template>{{formatRelativeTime oneMonthAgo}}</template>);
    assert.dom().hasText('last month', 'formats months ago 1');

    const twoMonthsAgo = new Date(now.getTime() - 2 * 30 * 24 * 60 * 60 * 1000);
    await render(<template>{{formatRelativeTime twoMonthsAgo}}</template>);
    assert.dom().hasText('2 months ago', 'formats months ago 1');
  });

  test('future time formatting', async function (assert) {
    const now = new Date();

    const inTwoHours = new Date(now.getTime() + 2.01 * 60 * 60 * 1000);
    await render(<template>{{formatRelativeTime inTwoHours}}</template>);
    assert.dom().hasText('in 2 hours', 'formats future time');

    const inThreeDays = new Date(now.getTime() + 3.01 * 24 * 60 * 60 * 1000);
    await render(<template>{{formatRelativeTime inThreeDays}}</template>);
    assert.dom().hasText('in 3 days', 'formats future days');

    const inOneMinute = new Date(now.getTime() + 1.01 * 60 * 1000);
    await render(<template>{{formatRelativeTime inOneMinute}}</template>);
    assert.dom().hasText('in 1 minute', 'formats near future');
  });

  test('edge cases and special times', async function (assert) {
    const now = new Date();

    await render(<template>{{formatRelativeTime now}}</template>);
    assert.dom().hasText('now', 'formats current time');

    const justNow = new Date(now.getTime() - 1000);
    await render(<template>{{formatRelativeTime justNow}}</template>);
    assert.dom().hasText('just now', 'formats very recent time');

    await render(<template>
      {{formatRelativeTime null fallback='No time'}}
    </template>);
    assert.dom().hasText('No time', 'uses fallback for null');

    await render(<template>
      {{formatRelativeTime undefined fallback='Unknown time'}}
    </template>);
    assert.dom().hasText('Unknown time', 'uses fallback for undefined');
  });

  test('string and number input', async function (assert) {
    const timestamp = Date.now() - 2 * 60 * 60 * 1000; // 2 hours ago

    await render(<template>{{formatRelativeTime timestamp}}</template>);
    assert.dom().hasText('2 hours ago', 'handles numeric timestamp');

    const isoString = new Date(timestamp).toISOString();
    await render(<template>{{formatRelativeTime isoString}}</template>);
    assert.dom().hasText('2 hours ago', 'handles ISO string');
  });

  test('localization', async function (assert) {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

    await render(<template>
      {{formatRelativeTime twoHoursAgo locale='en-US'}}
    </template>);
    assert.dom().hasText('2 hours ago', 'English relative time');

    await render(<template>
      {{formatRelativeTime twoHoursAgo locale='es-ES'}}
    </template>);
    assert.dom().hasText('hace 2 horas', 'Spanish relative time');

    await render(<template>
      {{formatRelativeTime twoHoursAgo locale='fr-FR'}}
    </template>);
    assert.dom().hasText('il y a 2 heures', 'French relative time');

    await render(<template>
      {{formatRelativeTime twoHoursAgo locale='de-DE'}}
    </template>);
    assert.dom().hasText('vor 2 Stunden', 'German relative time');

    await render(<template>
      {{formatRelativeTime twoHoursAgo locale='ar-SA'}}
    </template>);
    assert.dom().hasText('قبل ساعتين', 'Arabic relative time');
  });

  test('tiny size with localization', async function (assert) {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    await render(<template>
      {{formatRelativeTime oneHourAgo size='tiny' locale='en-US'}}
    </template>);
    assert.dom().hasText('1h', 'English tiny format');

    await render(<template>
      {{formatRelativeTime oneHourAgo size='tiny' locale='fr-FR'}}
    </template>);
    assert.dom().hasText('1h', 'French tiny format');

    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
    await render(<template>
      {{formatRelativeTime thirtyMinutesAgo size='tiny'}}
    </template>);
    assert.dom().hasText('30m', 'tiny format for minutes');
  });

  test('invalid time handling', async function (assert) {
    await render(<template>
      {{formatRelativeTime 'invalid-date' fallback='Invalid time'}}
    </template>);
    assert.dom().hasText('Invalid time', 'handles invalid date strings');

    await render(<template>
      {{formatRelativeTime 'not-a-date' fallback='Bad timestamp'}}
    </template>);
    assert.dom().hasText('Bad timestamp', 'handles non-date strings');

    const nanValue = NaN;
    await render(<template>
      {{formatRelativeTime nanValue fallback='Invalid number'}}
    </template>);
    assert.dom().hasText('Invalid number', 'handles NaN input');
  });

  test('extreme time differences', async function (assert) {
    const veryLongAgo = new Date(Date.now() - 10 * 365 * 24 * 60 * 60 * 1000); // 10 years ago

    await render(<template>{{formatRelativeTime veryLongAgo}}</template>);
    assert.dom().hasText('10 years ago', 'handles very long time differences');

    const centuryAgo = new Date(Date.now() - 100 * 365 * 24 * 60 * 60 * 1000);
    await render(<template>{{formatRelativeTime centuryAgo}}</template>);
    assert.dom().hasText('100 years ago', 'handles century-long differences');
  });

  test('precise timing around boundaries', async function (assert) {
    const almostTwoHours = new Date(
      Date.now() - (2 * 60 * 60 * 1000 - 30 * 1000),
    ); // 1h 59m 30s ago

    await render(<template>{{formatRelativeTime almostTwoHours}}</template>);
    assert.dom().hasText('about 2 hours ago', 'handles near-boundary times');

    const justOverOneDay = new Date(
      Date.now() - (24 * 60 * 60 * 1000 + 60 * 1000),
    ); // 1 day 1 minute ago

    await render(<template>{{formatRelativeTime justOverOneDay}}</template>);
    assert.dom().hasText('yesterday', 'rounds to nearest day');
  });

  module('JavaScript function usage', function () {
    test('formatRelativeTime function can be called directly', async function (assert) {
      const timestamp = Date.now() - 3 * 60 * 60 * 1000; // 3 hours ago

      const result = formatRelativeTime(timestamp, { size: 'medium' });
      assert.strictEqual(
        result,
        '3 hours ago',
        'function returns formatted relative time',
      );

      const tinyResult = formatRelativeTime(timestamp, {
        size: 'tiny',
        fallback: 'No time',
      });
      assert.strictEqual(tinyResult, '3h', 'function handles tiny format');

      const futureTimestamp = Date.now() + 2 * 60 * 60 * 1000; // 2 hours from now
      const futureResult = formatRelativeTime(futureTimestamp, {
        locale: 'en-US',
      });
      assert.strictEqual(
        futureResult,
        'in 2 hours',
        'function handles future times',
      );
    });
  });
});
