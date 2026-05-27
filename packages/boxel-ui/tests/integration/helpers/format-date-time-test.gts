import { hash } from '@ember/helper';
import { render } from '@ember/test-helpers';
import { module, test } from 'qunit';
import { setupRenderingTest } from 'test-app/tests/helpers';

import {
  formatDateTime,
  formatRelativeTime,
} from '@cardstack/boxel-ui/helpers';

const BASE_DATE = new Date('2024-03-15T15:45:00.000Z');
const REFERENCE_TIME = new Date('2024-03-15T17:45:00.000Z'); // 2 hours after BASE_DATE

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

  test('relative time formatting (direct helper)', function (assert) {
    assert.strictEqual(
      formatRelativeTime(BASE_DATE, {
        now: REFERENCE_TIME,
      }),
      '2 hours ago',
      'shows relative time in hours',
    );

    const justNow = new Date(REFERENCE_TIME.getTime() - 30000); // 30 seconds ago
    assert.strictEqual(
      formatRelativeTime(justNow, {
        now: REFERENCE_TIME,
      }),
      'now',
      'handles very recent times',
    );
  });

  test('short relative preset equivalence (direct helper)', function (assert) {
    const twentyEightDaysAgo = new Date(
      REFERENCE_TIME.getTime() - 28 * 24 * 60 * 60 * 1000,
    );
    const sixtyDaysAgo = new Date(
      REFERENCE_TIME.getTime() - 60 * 24 * 60 * 60 * 1000,
    );
    const fr1 = formatRelativeTime(twentyEightDaysAgo, {
      size: 'short',
      now: REFERENCE_TIME,
      locale: 'en-US',
    });
    assert.strictEqual(
      fr1,
      '28 days ago',
      'short preset shows days for ~last-month spans',
    );

    const fr2 = formatRelativeTime(sixtyDaysAgo, {
      size: 'short',
      now: REFERENCE_TIME,
      locale: 'en-US',
    });
    assert.strictEqual(
      fr2,
      '2 months ago',
      'short preset falls back to months for larger spans',
    );
  });

  test('today-aware tiny formatting', function (assert) {
    assert.strictEqual(
      formatDateTime(REFERENCE_TIME, {
        preset: 'tiny',
        now: REFERENCE_TIME,
        timeZone: 'UTC',
      }),
      '5:45 PM',
      'shows time for today',
    );

    const yesterday = new Date(REFERENCE_TIME.getTime() - 24 * 60 * 60 * 1000);
    assert.strictEqual(
      formatDateTime(yesterday, {
        preset: 'tiny',
        now: REFERENCE_TIME,
        timeZone: 'UTC',
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
    await render(
      <template>
        {{formatDateTime BASE_DATE locale='en-US' timeZone='UTC'}}
      </template>,
    );

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
    await render(
      <template>
        {{formatDateTime
          BASE_DATE
          locale='en-US'
          timeZone='UTC'
          preset='short'
        }}
      </template>,
    );
    assert.dom().hasText('3/15/24', 'short preset uses short date style');

    await render(
      <template>
        {{formatDateTime BASE_DATE locale='en-US' timeZone='UTC' preset='long'}}
      </template>,
    );
    assert.dom().hasText('March 15, 2024', 'long preset uses long date style');
  });

  test('respects explicit date and time styles with hour cycle', async function (assert) {
    await render(
      <template>
        {{formatDateTime
          BASE_DATE
          locale='en-US'
          dateStyle='medium'
          timeStyle='short'
          timeZone='America/New_York'
          hour12=false
        }}
      </template>,
    );

    assert
      .dom()
      .hasText(
        'Mar 15, 2024, 11:45',
        'renders localized date and time with 24-hour clock',
      );
  });

  test('kind variants format partial dates', async function (assert) {
    await render(
      <template>
        {{formatDateTime BASE_DATE kind='month' locale='en-US' timeZone='UTC'}}
      </template>,
    );
    assert.dom().hasText('March', 'formats month');

    await render(
      <template>
        {{formatDateTime
          BASE_DATE
          kind='monthDay'
          locale='en-US'
          timeZone='UTC'
        }}
      </template>,
    );
    assert.dom().hasText('Mar 15', 'formats month and day');

    await render(
      <template>
        {{formatDateTime
          BASE_DATE
          kind='monthYear'
          locale='en-US'
          timeZone='UTC'
          monthDisplay='long'
        }}
      </template>,
    );
    assert.dom().hasText('March 2024', 'formats month and year');

    await render(
      <template>
        {{formatDateTime BASE_DATE kind='year' locale='en-US' timeZone='UTC'}}
      </template>,
    );
    assert.dom().hasText('2024', 'formats year');

    await render(
      <template>
        {{formatDateTime
          BASE_DATE
          kind='month'
          locale='en-US'
          timeZone='UTC'
          monthDisplay='narrow'
        }}
      </template>,
    );
    assert.dom().hasText('M', 'supports narrow month display');

    await render(
      <template>
        {{formatDateTime BASE_DATE kind='time' locale='en-US' timeZone='UTC'}}
      </template>,
    );
    assert.dom().hasText('3:45 PM', 'formats time-only output');
  });

  test('date and datetime kinds include the expected fields', async function (assert) {
    await render(
      <template>
        {{formatDateTime BASE_DATE kind='date' locale='en-US' timeZone='UTC'}}
      </template>,
    );
    assert.dom().hasText('Mar 15, 2024', 'kind="date" renders date only');

    await render(
      <template>
        {{formatDateTime
          BASE_DATE
          kind='datetime'
          locale='en-US'
          timeZone='UTC'
        }}
      </template>,
    );
    assert
      .dom()
      .hasText('Mar 15, 2024, 3:45 PM', 'kind="datetime" renders date + time');
  });

  test('month display supports numeric, 2-digit, short, and long outputs', async function (assert) {
    await render(
      <template>
        {{formatDateTime
          BASE_DATE
          kind='month'
          locale='en-US'
          timeZone='UTC'
          monthDisplay='numeric'
        }}
      </template>,
    );
    assert.dom().hasText('3', 'numeric month display shows "3"');

    await render(
      <template>
        {{formatDateTime
          BASE_DATE
          kind='month'
          locale='en-US'
          timeZone='UTC'
          monthDisplay='2-digit'
        }}
      </template>,
    );
    assert.dom().hasText('03', '2-digit month display zero pads');

    await render(
      <template>
        {{formatDateTime
          BASE_DATE
          kind='month'
          locale='en-US'
          timeZone='UTC'
          monthDisplay='short'
        }}
      </template>,
    );
    assert.dom().hasText('Mar', 'short month display abbreviates');

    await render(
      <template>
        {{formatDateTime
          BASE_DATE
          kind='monthYear'
          locale='en-US'
          timeZone='UTC'
          monthDisplay='long'
        }}
      </template>,
    );
    assert.dom().hasText('March 2024', 'long month display spells out month');
  });

  test('date and time style permutations', async function (assert) {
    await render(
      <template>
        {{formatDateTime
          BASE_DATE
          locale='en-US'
          timeZone='UTC'
          dateStyle='full'
        }}
      </template>,
    );
    assert
      .dom()
      .hasText('Friday, March 15, 2024', 'full date style includes weekday');

    await render(
      <template>
        {{formatDateTime
          BASE_DATE
          locale='en-US'
          timeZone='UTC'
          timeStyle='medium'
        }}
      </template>,
    );
    assert.dom().includesText('3:45:00', 'medium time style shows seconds');

    await render(
      <template>
        {{formatDateTime
          BASE_DATE
          locale='en-US'
          timeZone='UTC'
          timeStyle='long'
        }}
      </template>,
    );
    assert
      .dom()
      .includesText('3:45:00 PM UTC', 'long time style includes zone');

    await render(
      <template>
        {{formatDateTime
          BASE_DATE
          locale='en-US'
          timeZone='UTC'
          dateStyle='long'
          timeStyle='short'
        }}
      </template>,
    );
    assert.dom().includesText('March 15, 2024', 'combined style shows date');
    assert.dom().includesText('3:45 PM', 'combined style shows time');
  });

  test('hour cycle and hour12 options affect output format', async function (assert) {
    await render(
      <template>
        {{formatDateTime
          BASE_DATE
          locale='en-US'
          timeZone='UTC'
          kind='time'
          hour12=true
        }}
      </template>,
    );
    assert.dom().hasText('3:45 PM', 'explicit hour12 formatting shows AM/PM');

    await render(
      <template>
        {{formatDateTime
          BASE_DATE
          locale='en-US'
          timeZone='UTC'
          kind='time'
          hourCycle='h23'
        }}
      </template>,
    );
    assert.dom().hasText('15:45', 'h23 cycle renders 24-hour clock');

    const MIDNIGHT = new Date('2024-03-15T00:30:00.000Z');
    await render(
      <template>
        {{formatDateTime
          MIDNIGHT
          locale='en-US'
          timeZone='UTC'
          kind='time'
          hourCycle='h11'
        }}
      </template>,
    );
    assert.dom().hasText('0:30 AM', 'h11 cycle emits 0-11 hours with AM');
  });

  test('tiny preset reflects timezone, locale, and future dates', function (assert) {
    assert.strictEqual(
      formatDateTime(BASE_DATE, {
        locale: 'en-US',
        timeZone: 'America/New_York',
        preset: 'tiny',
        now: REFERENCE_TIME,
      }),
      '11:45 AM',
      'tiny preset shows localized time when still today in New York',
    );

    assert.strictEqual(
      formatDateTime(BASE_DATE, {
        locale: 'en-US',
        timeZone: 'Asia/Tokyo',
        preset: 'tiny',
        now: REFERENCE_TIME,
      }),
      '12:45 AM',
      'tiny preset switches to the local day boundary in Tokyo',
    );

    const previousDay = new Date('2024-03-14T12:00:00.000Z');
    assert.strictEqual(
      formatDateTime(previousDay, {
        locale: 'es-ES',
        timeZone: 'UTC',
        preset: 'tiny',
        now: REFERENCE_TIME,
      }),
      '14/3',
      'non-today dates render numeric day/month in the target locale',
    );

    const tomorrow = new Date(REFERENCE_TIME.getTime() + 24 * 60 * 60 * 1000);
    assert.strictEqual(
      formatDateTime(tomorrow, {
        locale: 'en-US',
        timeZone: 'UTC',
        preset: 'tiny',
        now: REFERENCE_TIME,
      }),
      '3/16',
      'future day renders numeric date',
    );
  });

  test('Day.js advanced tokens cover ordinal, weekday, and literal text', async function (assert) {
    await render(
      <template>
        {{formatDateTime
          BASE_DATE
          locale='en'
          timeZone='UTC'
          format='dddd, MMMM Do, YYYY [at] h:mm A'
        }}
      </template>,
    );

    assert
      .dom()
      .hasText(
        'Friday, March 15th, 2024 at 3:45 PM',
        'advanced tokens render ordinal day and literal text',
      );
  });

  test('locale and timezone combinations render localized output', async function (assert) {
    await render(
      <template>
        {{formatDateTime
          BASE_DATE
          locale='es-ES'
          timeZone='Europe/Madrid'
          dateStyle='long'
        }}
      </template>,
    );
    assert
      .dom()
      .hasText(
        '15 de marzo de 2024',
        'Spanish locale uses expected long format',
      );

    await render(
      <template>
        {{formatDateTime
          BASE_DATE
          locale='fr-FR'
          timeZone='Europe/Paris'
          dateStyle='long'
        }}
      </template>,
    );
    assert
      .dom()
      .hasText('15 mars 2024', 'French locale renders localized month');

    await render(
      <template>
        {{formatDateTime
          BASE_DATE
          locale='en-US'
          timeZone='Asia/Tokyo'
          kind='datetime'
          dateStyle='long'
          timeStyle='short'
        }}
      </template>,
    );
    assert
      .dom()
      .includesText('March 16, 2024', 'Tokyo timezone advances the date');
    assert.dom().includesText('12:45 AM', 'Tokyo timezone adjusts the time');

    await render(
      <template>
        {{formatDateTime
          BASE_DATE
          locale='en-US'
          timeZone='America/Los_Angeles'
          kind='datetime'
          dateStyle='long'
          timeStyle='short'
        }}
      </template>,
    );
    assert
      .dom()
      .includesText('March 15, 2024', 'Los Angeles stays on the same day');
    assert
      .dom()
      .includesText('8:45 AM', 'Los Angeles timezone shows morning time');
  });

  test('week and quarter formatting', async function (assert) {
    await render(
      <template>
        {{formatDateTime BASE_DATE kind='week' locale='en-US' timeZone='UTC'}}
      </template>,
    );
    assert.dom().hasText('2024-W11', 'formats ISO week');

    await render(
      <template>
        {{formatDateTime
          BASE_DATE
          kind='week'
          locale='en-US'
          timeZone='UTC'
          weekFormat='label'
        }}
      </template>,
    );
    assert.dom().hasText('week 11, 2024', 'formats localized week label');

    await render(
      <template>
        {{formatDateTime
          BASE_DATE
          kind='quarter'
          locale='en-US'
          timeZone='UTC'
        }}
      </template>,
    );
    assert.dom().hasText('Q1 2024', 'defaults to short quarter format');

    await render(
      <template>
        {{formatDateTime
          BASE_DATE
          kind='quarter'
          locale='en-US'
          timeZone='UTC'
          quarterFormat='long'
        }}
      </template>,
    );
    assert.dom().hasText('quarter 1, 2024', 'supports long quarter labels');
  });

  test('uses Day.js when token format provided', async function (assert) {
    await render(
      <template>
        {{formatDateTime
          BASE_DATE
          locale='en'
          timeZone='UTC'
          format='YYYY/MM/DD'
        }}
      </template>,
    );

    assert.dom().hasText('2024/03/15', 'renders using token format');
  });

  test('supports numeric seconds and Excel serial parsing', async function (assert) {
    const secondsTimestamp = 1_700_000_000;
    const excelSerial = 45365;

    await render(
      <template>
        {{formatDateTime
          secondsTimestamp
          locale='en-US'
          timeZone='UTC'
          unit='s'
        }}
      </template>,
    );
    assert
      .dom()
      .hasText('Nov 14, 2023', 'interprets numeric seconds timestamp');

    await render(
      <template>
        {{formatDateTime excelSerial parse=(hash serialOrigin='excel1900')}}
      </template>,
    );
    assert.dom().hasText('Mar 14, 2024', 'parses Excel 1900 serial dates');

    await render(
      <template>
        {{formatDateTime excelSerial parse=(hash serialOrigin='excel1904')}}
      </template>,
    );
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
    await render(
      <template>
        {{formatDateTime 'not-a-date' fallback='Invalid date'}}
      </template>,
    );
    assert.dom().hasText('Invalid date', 'uses fallback for invalid string');

    await render(
      <template>{{formatDateTime null fallback='Missing'}}</template>,
    );
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
