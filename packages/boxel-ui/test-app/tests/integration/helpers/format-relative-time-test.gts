import { hash } from '@ember/helper';
import { render } from '@ember/test-helpers';
import { module, test } from 'qunit';
import { setupRenderingTest } from 'test-app/tests/helpers';

import {
  formatDateTime,
  formatRelativeTime,
} from '@cardstack/boxel-ui/helpers';

const REFERENCE_TIME = new Date('2024-05-01T12:00:00.000Z');
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

module('Integration | helpers | formatRelativeTime', function (hooks) {
  setupRenderingTest(hooks);

  test('minimal invocation returns non-empty string', function (assert) {
    assert.ok(
      formatRelativeTime(REFERENCE_TIME).length > 0,
      'returns text with defaults',
    );
  });

  test('formats past times using default options', async function (assert) {
    const past = new Date(REFERENCE_TIME.getTime() - 2 * HOUR);

    await render(<template>
      {{formatRelativeTime past locale='en-US' now=REFERENCE_TIME}}
    </template>);

    assert.dom().hasText('2 hours ago', 'shows localized relative time');
  });

  test('supports future times and tiny size', async function (assert) {
    const future = new Date(REFERENCE_TIME.getTime() + 2 * HOUR);

    await render(<template>
      {{formatRelativeTime
        future
        locale='en-US'
        now=REFERENCE_TIME
        size='tiny'
      }}
    </template>);

    assert.dom().hasText('+2h', 'tiny size uses abbreviated format with sign');
  });

  test('long size with numeric always', async function (assert) {
    const future = new Date(REFERENCE_TIME.getTime() + HOUR);

    await render(<template>
      {{formatRelativeTime
        future
        locale='en-US'
        now=REFERENCE_TIME
        size='long'
        numeric='always'
      }}
    </template>);

    assert.dom().hasText('in 1 hour', 'long size spells out units');
  });

  test('short style uses narrow relative time output', async function (assert) {
    const future = new Date(REFERENCE_TIME.getTime() + 3 * HOUR);

    await render(<template>
      {{formatRelativeTime
        future
        locale='en-US'
        now=REFERENCE_TIME
        size='short'
      }}
    </template>);

    assert
      .dom()
      .includesText('3 hr', 'short size uses abbreviated unit from Intl');
  });

  test('short size prefers days for ~last-month spans', function (assert) {
    const twentyEightDaysAgo = new Date(REFERENCE_TIME.getTime() - 28 * DAY);
    const sixtyDaysAgo = new Date(REFERENCE_TIME.getTime() - 60 * DAY);

    assert.strictEqual(
      formatRelativeTime(twentyEightDaysAgo, {
        locale: 'en-US',
        now: REFERENCE_TIME,
        size: 'short',
      }),
      '28 days ago',
      'short size shows days for ~last-month spans',
    );

    assert.strictEqual(
      formatRelativeTime(sixtyDaysAgo, {
        locale: 'en-US',
        now: REFERENCE_TIME,
        size: 'short',
      }),
      '2 months ago',
      'short size falls back to months for larger spans',
    );
  });

  test('multi-unit precision outputs detailed spans', function (assert) {
    const span = 75 * DAY + 10 * HOUR + 30 * MINUTE;
    const past = new Date(REFERENCE_TIME.getTime() - span);

    assert.strictEqual(
      formatRelativeTime(past, {
        locale: 'en-US',
        now: REFERENCE_TIME,
        precision: 2,
      }),
      '2 months, 15 days ago',
      'precision=2 returns the top two units',
    );

    assert.strictEqual(
      formatRelativeTime(past, {
        locale: 'en-US',
        now: REFERENCE_TIME,
        precision: 3,
      }),
      '2 months, 15 days, 10 hours ago',
      'precision=3 adds the next unit',
    );
  });

  test('multi-unit precision supports future and locale-specific output', function (assert) {
    const future = new Date(REFERENCE_TIME.getTime() + 2 * HOUR + 30 * MINUTE);

    assert.strictEqual(
      formatRelativeTime(future, {
        locale: 'en-US',
        now: REFERENCE_TIME,
        precision: 2,
      }),
      'in 2 hours, 30 minutes',
      'future multi-unit renders leading "in"',
    );

    const spanishPast = new Date(REFERENCE_TIME.getTime() - 75 * DAY);
    assert.strictEqual(
      formatRelativeTime(spanishPast, {
        locale: 'es-ES',
        now: REFERENCE_TIME,
        precision: 2,
      }),
      'hace 2 meses, 15 días',
      'non-English locale preserves localized direction words',
    );
  });

  test('multi-unit precision honors tiny size compact output', function (assert) {
    const future = new Date(REFERENCE_TIME.getTime() + 3 * DAY + 4 * HOUR);

    assert.strictEqual(
      formatRelativeTime(future, {
        now: REFERENCE_TIME,
        precision: 2,
        size: 'tiny',
      }),
      '+3d, 4h',
      'tiny size multi-unit uses compact labels',
    );
  });

  test('rounding modes and unit ceilings', async function (assert) {
    const almostThreeHours = new Date(
      REFERENCE_TIME.getTime() - (2 * HOUR + 5 * MINUTE),
    );
    const twoHours = new Date(REFERENCE_TIME.getTime() - 2 * HOUR);

    await render(<template>
      {{formatRelativeTime
        almostThreeHours
        locale='en-US'
        now=REFERENCE_TIME
        round='ceil'
      }}
    </template>);
    assert.dom().hasText('3 hours ago', 'ceil rounding bumps to next hour');

    await render(<template>
      {{formatRelativeTime
        twoHours
        locale='en-US'
        now=REFERENCE_TIME
        unitCeil='minute'
      }}
    </template>);
    assert
      .dom()
      .hasText('120 minutes ago', 'unit ceiling restricts to minutes');
  });

  test('formatDateTime relative forwards numeric and precision options', function (assert) {
    const multiUnitPast = new Date(
      REFERENCE_TIME.getTime() - (75 * DAY + 10 * HOUR),
    );
    const yesterday = new Date(REFERENCE_TIME.getTime() - DAY);

    assert.strictEqual(
      formatDateTime(multiUnitPast, {
        locale: 'en-US',
        now: REFERENCE_TIME,
        precision: 2,
        relative: true,
      }),
      '2 months, 15 days ago',
      'formatDateTime relays precision to the relative helper',
    );

    assert.strictEqual(
      formatDateTime(yesterday, {
        locale: 'en-US',
        now: REFERENCE_TIME,
        relative: true,
      }),
      'yesterday',
      'default relative formatting uses linguistic labels',
    );

    assert.strictEqual(
      formatDateTime(yesterday, {
        locale: 'en-US',
        now: REFERENCE_TIME,
        relative: true,
        numeric: 'always',
      }),
      '1 day ago',
      'numeric flag is forwarded to formatRelativeTime',
    );
  });

  test('unit selection thresholds pivot at 45 seconds and 45 minutes', function (assert) {
    const fortyFourSecondsAgo = new Date(REFERENCE_TIME.getTime() - 44 * 1000);
    const fortyFiveSecondsAgo = new Date(REFERENCE_TIME.getTime() - 45 * 1000);
    const fortyFourMinutesAgo = new Date(
      REFERENCE_TIME.getTime() - 44 * MINUTE,
    );
    const fortyFiveMinutesAgo = new Date(
      REFERENCE_TIME.getTime() - 45 * MINUTE,
    );

    assert.strictEqual(
      formatRelativeTime(fortyFourSecondsAgo, {
        locale: 'en-US',
        now: REFERENCE_TIME,
      }),
      '44 seconds ago',
      'values under 45 seconds stay in seconds',
    );

    assert.strictEqual(
      formatRelativeTime(fortyFiveSecondsAgo, {
        locale: 'en-US',
        now: REFERENCE_TIME,
      }),
      '1 minute ago',
      '45 seconds rounds to 1 minute',
    );

    assert.strictEqual(
      formatRelativeTime(fortyFourMinutesAgo, {
        locale: 'en-US',
        now: REFERENCE_TIME,
      }),
      '44 minutes ago',
      'values under 45 minutes stay in minutes',
    );

    assert.strictEqual(
      formatRelativeTime(fortyFiveMinutesAgo, {
        locale: 'en-US',
        now: REFERENCE_TIME,
      }),
      '1 hour ago',
      '45 minutes rounds to 1 hour',
    );
  });

  test('now threshold collapses near events', async function (assert) {
    const recent = new Date(REFERENCE_TIME.getTime() - 4 * 1000);

    await render(<template>
      {{formatRelativeTime
        recent
        locale='en-US'
        now=REFERENCE_TIME
        nowThresholdMs=5000
      }}
    </template>);

    assert.dom().hasText('now', 'values within threshold render as now');
  });

  test('switches to absolute formatting after threshold', async function (assert) {
    const past = new Date(REFERENCE_TIME.getTime() - 3 * DAY);
    const switchToAbsoluteAfterMs = 2 * DAY;
    const absoluteOptions = {
      dateStyle: 'medium' as const,
      locale: 'en-US',
      timeZone: 'UTC',
    };

    await render(<template>
      {{formatRelativeTime
        past
        locale='en-US'
        now=REFERENCE_TIME
        switchToAbsoluteAfterMs=switchToAbsoluteAfterMs
        absoluteOptions=absoluteOptions
      }}
    </template>);

    assert
      .dom()
      .hasText('Apr 28, 2024', 'uses absolute formatting after cutoff');
  });

  test('supports seconds unit and Excel serial parsing', async function (assert) {
    const pastSeconds = Math.floor(REFERENCE_TIME.getTime() / 1000) - 60 * 60;
    const excelSerial = 45412; // 2024-04-30 (Excel 1900 system)

    await render(<template>
      {{formatRelativeTime
        pastSeconds
        locale='en-US'
        now=REFERENCE_TIME
        unit='s'
      }}
    </template>);
    assert.dom().hasText('1 hour ago', 'interprets numeric seconds timestamps');

    await render(<template>
      {{formatRelativeTime
        excelSerial
        locale='en-US'
        now=REFERENCE_TIME
        parse=(hash serialOrigin='excel1900')
      }}
    </template>);
    assert.dom().hasText('yesterday', 'parses Excel serial values');
  });

  test('falls back for invalid values', async function (assert) {
    await render(<template>
      {{formatRelativeTime 'invalid' fallback='Unknown'}}
    </template>);
    assert.dom().hasText('Unknown', 'uses fallback for invalid strings');

    await render(<template>
      {{formatRelativeTime null fallback='Missing'}}
    </template>);
    assert.dom().hasText('Missing', 'uses fallback for null');
  });

  module('JavaScript function usage', function () {
    test('formatRelativeTime can be called directly', async function (assert) {
      const result = formatRelativeTime(
        new Date(REFERENCE_TIME.getTime() - HOUR),
        {
          locale: 'en-US',
          now: REFERENCE_TIME,
        },
      );
      assert.strictEqual(result, '1 hour ago', 'returns relative text in code');

      const tinyFuture = formatRelativeTime(
        new Date(REFERENCE_TIME.getTime() + HOUR),
        {
          locale: 'en-US',
          now: REFERENCE_TIME,
          size: 'tiny',
        },
      );
      assert.strictEqual(tinyFuture, '+1h', 'supports tiny format in code');
    });
  });

  test('absolute threshold boundary', async function (assert) {
    const past = new Date(REFERENCE_TIME.getTime() - DAY);
    const absoluteOptions = {
      dateStyle: 'medium',
      locale: 'en-US',
      timeZone: 'UTC',
    } as const;
    const expected = formatDateTime(past, absoluteOptions);

    await render(<template>
      {{formatRelativeTime
        past
        locale='en-US'
        now=REFERENCE_TIME
        switchToAbsoluteAfterMs=DAY
        absoluteOptions=absoluteOptions
      }}
    </template>);

    assert.dom().hasText(expected, 'uses absolute formatting at the threshold');
  });

  test('absolute formatting delegates to formatDateTime', async function (assert) {
    const past = new Date(REFERENCE_TIME.getTime() - 5 * DAY);
    const switchToAbsoluteAfterMs = DAY;
    const absoluteOptions = {
      dateStyle: 'long' as const,
      locale: 'en-CA',
      timeZone: 'UTC',
    };

    const expected = formatDateTime(past, absoluteOptions);

    await render(<template>
      {{formatRelativeTime
        past
        locale='en-US'
        now=REFERENCE_TIME
        switchToAbsoluteAfterMs=switchToAbsoluteAfterMs
        absoluteOptions=absoluteOptions
      }}
    </template>);

    assert.dom().hasText(expected, 'uses formatDateTime for absolute fallback');
  });

  test('unit ceiling can force seconds granularity', async function (assert) {
    const past = new Date(REFERENCE_TIME.getTime() - 1500);

    await render(<template>
      {{formatRelativeTime
        past
        locale='en-US'
        now=REFERENCE_TIME
        unitCeil='second'
        nowThresholdMs=0
      }}
    </template>);

    assert.dom().hasText('1 second ago', 'respects smallest unit ceiling');
  });
});
