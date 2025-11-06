import { hash } from '@ember/helper';
import { render } from '@ember/test-helpers';
import { module, test } from 'qunit';
import { setupRenderingTest } from 'test-app/tests/helpers';

import {
  formatDateTime,
  formatRelativeTime,
} from '@cardstack/boxel-ui/helpers';

const BASE_DATE = new Date('2024-03-15T15:45:00.000Z');
const NOW = new Date('2024-03-15T17:45:00.000Z'); // 2 hours after BASE_DATE

module('Integration | helpers | formatDateTime', function (hooks) {
  setupRenderingTest(hooks);

  test('handles Excel serial dates', function (assert) {
    // Excel 1900 date system: 45365 = March 14, 2024
    assert.strictEqual(
      formatDateTime(45365, {
        parse: { serialOrigin: 'excel1900' },
        dateStyle: 'short',
      }),
      '3/14/24',
      'correctly parses Excel 1900 serial date',
    );

    // Excel 1904 date system: 43902 = March 15, 2024
    assert.strictEqual(
      formatDateTime(45365, {
        parse: { serialOrigin: 'excel1904' },
        dateStyle: 'short',
      }),
      '3/15/28',
      'correctly parses Excel 1904 serial date',
    );
  });

  test('relative time formatting', function (assert) {
    assert.strictEqual(
      formatDateTime(BASE_DATE, {
        relative: true,
        now: NOW,
      }),
      '2 hours ago',
      'shows relative time in hours',
    );

    const justNow = new Date(NOW.getTime() - 30000); // 30 seconds ago
    assert.strictEqual(
      formatDateTime(justNow, {
        relative: true,
        now: NOW,
      }),
      'now',
      'handles very recent times',
    );
  });

  test('formatDateTime relative delegates to formatRelativeTime for short preset', function (assert) {
    const now = NOW;
    const twentyEightDaysAgo = new Date(
      NOW.getTime() - 28 * 24 * 60 * 60 * 1000,
    );
    const sixtyDaysAgo = new Date(NOW.getTime() - 60 * 24 * 60 * 60 * 1000);

    const fd1 = formatDateTime(twentyEightDaysAgo, {
      relative: true,
      preset: 'short',
      now,
      locale: 'en-US',
    });

    const fr1 = formatRelativeTime(twentyEightDaysAgo, {
      size: 'short',
      now,
      locale: 'en-US',
    });

    assert.strictEqual(
      fd1,
      fr1,
      'formatDateTime delegates to formatRelativeTime for short preset (28 days)',
    );
    assert.strictEqual(
      fd1,
      '28 days ago',
      'short preset shows days for ~last-month spans',
    );

    const fd2 = formatDateTime(sixtyDaysAgo, {
      relative: true,
      preset: 'short',
      now,
      locale: 'en-US',
    });

    const fr2 = formatRelativeTime(sixtyDaysAgo, {
      size: 'short',
      now,
      locale: 'en-US',
    });

    assert.strictEqual(
      fd2,
      fr2,
      'formatDateTime delegates to formatRelativeTime for short preset (60 days)',
    );
    assert.strictEqual(
      fd2,
      '2 months ago',
      'short preset falls back to months for larger spans',
    );
  });

  test('today-aware tiny formatting', function (assert) {
    assert.strictEqual(
      formatDateTime(NOW, {
        preset: 'tiny',
        now: NOW,
      }),
      '5:45 PM',
      'shows time for today',
    );

    const yesterday = new Date(NOW.getTime() - 24 * 60 * 60 * 1000);
    assert.strictEqual(
      formatDateTime(yesterday, {
        preset: 'tiny',
        now: NOW,
      }),
      '3/14',
      'shows date for non-today',
    );
  });

  test('minimal invocation returns non-empty string', function (assert) {
    assert.ok(
      formatDateTime(BASE_DATE).length > 0,
      'returns some formatted text',
    );
  });

  test('defaults to medium date style', async function (assert) {
    await render(<template>
      {{formatDateTime BASE_DATE locale='en-US' timeZone='UTC'}}
    </template>);

    assert.dom().hasText('Mar 15, 2024', 'uses medium date style by default');
  });

  test('preset tiny uses current day awareness', function (assert) {
    const now = new Date('2024-03-15T08:00:00.000Z');
    const sameDay = formatDateTime(BASE_DATE, {
      locale: 'en-US',
      timeZone: 'UTC',
      preset: 'tiny',
      now,
    });
    assert.strictEqual(sameDay, '3:45 PM', 'shows time when same calendar day');

    const previousDay = new Date('2024-03-14T12:00:00.000Z');
    const otherDay = formatDateTime(previousDay, {
      locale: 'en-US',
      timeZone: 'UTC',
      preset: 'tiny',
      now,
    });
    assert.strictEqual(
      otherDay,
      '3/14',
      'falls back to numeric month/day for other days',
    );
  });

  test('preset short and long map to Intl date styles', async function (assert) {
    await render(<template>
      {{formatDateTime BASE_DATE locale='en-US' timeZone='UTC' preset='short'}}
    </template>);
    assert.dom().hasText('3/15/24', 'short preset uses short date style');

    await render(<template>
      {{formatDateTime BASE_DATE locale='en-US' timeZone='UTC' preset='long'}}
    </template>);
    assert.dom().hasText('March 15, 2024', 'long preset uses long date style');
  });

  test('respects explicit date and time styles with hour cycle', async function (assert) {
    await render(<template>
      {{formatDateTime
        BASE_DATE
        locale='en-US'
        dateStyle='medium'
        timeStyle='short'
        timeZone='America/New_York'
        hour12=false
      }}
    </template>);

    assert
      .dom()
      .hasText(
        'Mar 15, 2024, 11:45',
        'renders localized date and time with 24-hour clock',
      );
  });

  test('kind variants format partial dates', async function (assert) {
    await render(<template>
      {{formatDateTime BASE_DATE kind='month' locale='en-US' timeZone='UTC'}}
    </template>);
    assert.dom().hasText('March', 'formats month');

    await render(<template>
      {{formatDateTime BASE_DATE kind='monthDay' locale='en-US' timeZone='UTC'}}
    </template>);
    assert.dom().hasText('Mar 15', 'formats month and day');

    await render(<template>
      {{formatDateTime
        BASE_DATE
        kind='monthYear'
        locale='en-US'
        timeZone='UTC'
        monthDisplay='long'
      }}
    </template>);
    assert.dom().hasText('March 2024', 'formats month and year');

    await render(<template>
      {{formatDateTime BASE_DATE kind='year' locale='en-US' timeZone='UTC'}}
    </template>);
    assert.dom().hasText('2024', 'formats year');

    await render(<template>
      {{formatDateTime
        BASE_DATE
        kind='month'
        locale='en-US'
        timeZone='UTC'
        monthDisplay='narrow'
      }}
    </template>);
    assert.dom().hasText('M', 'supports narrow month display');

    await render(<template>
      {{formatDateTime BASE_DATE kind='time' locale='en-US' timeZone='UTC'}}
    </template>);
    assert.dom().hasText('3:45 PM', 'formats time-only output');
  });

  test('week and quarter formatting', async function (assert) {
    await render(<template>
      {{formatDateTime BASE_DATE kind='week' locale='en-US' timeZone='UTC'}}
    </template>);
    assert.dom().hasText('2024-W11', 'formats ISO week');

    await render(<template>
      {{formatDateTime
        BASE_DATE
        kind='week'
        locale='en-US'
        timeZone='UTC'
        weekFormat='label'
      }}
    </template>);
    assert.dom().hasText('week 11, 2024', 'formats localized week label');

    await render(<template>
      {{formatDateTime BASE_DATE kind='quarter' locale='en-US' timeZone='UTC'}}
    </template>);
    assert.dom().hasText('Q1 2024', 'defaults to short quarter format');

    await render(<template>
      {{formatDateTime
        BASE_DATE
        kind='quarter'
        locale='en-US'
        timeZone='UTC'
        quarterFormat='long'
      }}
    </template>);
    assert.dom().hasText('quarter 1, 2024', 'supports long quarter labels');
  });

  test('uses Day.js when token format provided', async function (assert) {
    await render(<template>
      {{formatDateTime
        BASE_DATE
        locale='en'
        timeZone='UTC'
        format='YYYY/MM/DD'
      }}
    </template>);

    assert.dom().hasText('2024/03/15', 'renders using token format');
  });

  test('supports numeric seconds and Excel serial parsing', async function (assert) {
    const secondsTimestamp = 1_700_000_000;
    const excelSerial = 45365;

    await render(<template>
      {{formatDateTime secondsTimestamp locale='en-US' timeZone='UTC' unit='s'}}
    </template>);
    assert
      .dom()
      .hasText('Nov 14, 2023', 'interprets numeric seconds timestamp');

    await render(<template>
      {{formatDateTime excelSerial parse=(hash serialOrigin='excel1900')}}
    </template>);
    assert.dom().hasText('Mar 14, 2024', 'parses Excel 1900 serial dates');

    await render(<template>
      {{formatDateTime excelSerial parse=(hash serialOrigin='excel1904')}}
    </template>);
    assert.dom().hasText('Mar 15, 2028', 'parses Excel 1904 serial dates');
  });

  test('engine selection and numbering system', function (assert) {
    const intlResult = formatDateTime(BASE_DATE, {
      engine: 'intl',
      locale: 'en-US',
      dateStyle: 'short',
      timeZone: 'UTC',
      numberingSystem: 'latn',
    });
    assert.strictEqual(
      intlResult,
      '3/15/24',
      'intl engine honors numbering system',
    );

    const dayjsResult = formatDateTime(BASE_DATE, {
      engine: 'dayjs',
      format: 'YYYY-MM-DD',
      locale: 'en',
      timeZone: 'UTC',
    });
    assert.strictEqual(
      dayjsResult,
      '2024-03-15',
      'dayjs engine formats tokens',
    );
  });

  test('falls back when value cannot be parsed', async function (assert) {
    await render(<template>
      {{formatDateTime 'not-a-date' fallback='Invalid date'}}
    </template>);
    assert.dom().hasText('Invalid date', 'uses fallback for invalid string');

    await render(<template>
      {{formatDateTime null fallback='Missing'}}
    </template>);
    assert.dom().hasText('Missing', 'uses fallback for null value');
  });

  module('JavaScript function usage', function () {
    test('formatDateTime can be used directly in code', async function (assert) {
      const result = formatDateTime(BASE_DATE, {
        locale: 'en-US',
        timeZone: 'UTC',
        preset: 'medium',
      });
      assert.strictEqual(
        result,
        'Mar 15, 2024',
        'formats using provided options',
      );

      const tokenResult = formatDateTime(BASE_DATE, {
        format: 'MMM D, YYYY',
        locale: 'en',
        timeZone: 'UTC',
      });
      assert.strictEqual(
        tokenResult,
        'Mar 15, 2024',
        'supports token formatting',
      );
    });
  });
});
