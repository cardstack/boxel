import { click } from '@ember/test-helpers';

import { module, test } from 'qunit';

import {
  setupBaseRealm,
  DateField,
  DateTimeField,
  DatetimeStampField,
  DayField,
  DateRangeField,
  MonthDayField,
  YearField,
  MonthField,
  MonthYearField,
  WeekField,
  QuarterField,
  TimeField,
  TimeRangeField,
  DurationField,
  RelativeTimeField,
} from '../helpers/base-realm';
import {
  renderField,
  renderConfiguredField,
  buildField,
} from '../helpers/field-test-helpers';
import { setupRenderingTest } from '../helpers/setup';

module('Integration | date-time fields', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);

  test('core date & time fields render their embedded views', async function (assert) {
    await renderField(DateField, '2024-05-01');
    assert.dom('[data-test-date-embedded]').exists();
    assert
      .dom('[data-test-date-embedded]')
      .doesNotContainText('No date set', 'date value is displayed');

    await renderField(TimeField, buildField(TimeField, { value: '14:00' }));
    assert
      .dom('[data-test-time-embedded]')
      .hasTextContaining('2:00 PM', 'time value is formatted to 12-hour clock');

    await renderField(DateTimeField, '2024-05-01T14:30:00');
    assert.dom('[data-test-datetime-embedded]').exists();
    assert
      .dom('[data-test-datetime-embedded]')
      .doesNotContainText('No date/time set', 'datetime value is displayed');
  });

  test('range, duration, and relative fields show formatted summaries', async function (assert) {
    await renderField(
      DateRangeField,
      buildField(DateRangeField, {
        start: '2024-05-01',
        end: '2024-05-10',
      }),
    );
    assert
      .dom('[data-test-date-range-embedded]')
      .hasText('May 1, 2024 → May 10, 2024');

    await renderField(
      TimeRangeField,
      buildField(TimeRangeField, {
        start: buildField(TimeField, { value: '09:00' }),
        end: buildField(TimeField, { value: '17:00' }),
      }),
    );
    assert.dom('[data-test-time-range-embedded]').hasText('09:00 → 17:00');

    await renderField(
      DurationField,
      buildField(DurationField, {
        hours: 1,
        minutes: 30,
        seconds: 0,
      }),
    );
    assert
      .dom('[data-test-duration-embedded]')
      .hasText('1h 30m', 'duration renders in compact notation');

    await renderField(
      RelativeTimeField,
      buildField(RelativeTimeField, { amount: 3, unit: 'hours' }),
    );
    assert.dom('[data-test-relative-time-embedded]').hasText('In 3 hours');
  });

  test('partial calendar fields render friendly labels', async function (assert) {
    await renderField(
      MonthDayField,
      buildField(MonthDayField, { month: '05', day: '15' }),
    );
    assert
      .dom('[data-test-month-day-embedded]')
      .hasText('May 15', 'month/day is spelled out');

    await renderField(YearField, buildField(YearField, { value: 2025 }));
    assert.dom('[data-test-year-embedded]').hasText('2025');

    await renderField(MonthField, buildField(MonthField, { value: 5 }));
    assert.dom('[data-test-month-embedded]').hasText('May');

    await renderField(
      MonthYearField,
      buildField(MonthYearField, { value: '2025-05' }),
    );
    assert.dom('[data-test-month-year-embedded]').hasText('May 2025');

    await renderField(WeekField, buildField(WeekField, { value: '2025-W20' }));
    assert.dom('[data-test-week-embedded]').hasText('week 20, 2025');

    await renderField(
      QuarterField,
      buildField(QuarterField, { quarter: 2, year: 2025 }),
    );
    assert.dom('[data-test-quarter-embedded]').hasText('Q2 2025');
  });

  test('presentation modes render their specialized components', async function (assert) {
    // DateTimeField presentations
    await renderConfiguredField(DateTimeField, '2025-01-01T00:00:00Z', {
      presentation: 'countdown',
      countdownOptions: { label: 'Launch', showControls: true },
    });
    assert.dom('[data-test-countdown]').exists();

    await renderConfiguredField(DateTimeField, '2024-01-01T00:00:00Z', {
      presentation: 'timeAgo',
      timeAgoOptions: { eventLabel: 'Last Activity', updateInterval: 60000 },
    });
    assert.dom('[data-test-relative-time]').exists();

    await renderConfiguredField(DateTimeField, '2024-06-01T10:00:00Z', {
      presentation: 'timeline',
      timelineOptions: { eventName: 'Order Placed', status: 'complete' },
    });
    assert.dom('[data-test-timeline-event]').exists();

    await renderConfiguredField(DateTimeField, '2025-06-01T10:00:00Z', {
      presentation: 'expirationWarning',
      expirationOptions: { itemName: 'API Token' },
    });
    assert.dom('[data-test-expiration-warning]').exists();

    // DateField presentation: age
    await renderConfiguredField(DateField, '1990-05-01', {
      presentation: 'age',
      ageOptions: { showNextBirthday: true },
    });
    assert.dom('[data-test-age-calculator]').exists();

    // DateRangeField presentation: businessDays (needs instance)
    await renderConfiguredField(
      DateRangeField,
      buildField(DateRangeField, {
        start: '2024-05-01',
        end: '2024-05-10',
      }),
      { presentation: 'businessDays' },
    );
    assert.dom('[data-test-business-days]').exists();

    // TimeField presentation: timeSlots (needs instance)
    await renderConfiguredField(
      TimeField,
      buildField(TimeField, {
        value: '09:00',
      }),
      {
        presentation: 'timeSlots',
        timeSlotsOptions: { availableSlots: ['09:00', '10:00'] },
      },
    );
    assert.dom('[data-test-time-slots]').exists();
  });

  test('missing values render placeholders in embedded and atom modes', async function (assert) {
    await renderField(DateField, undefined);
    assert.dom('[data-test-date-embedded]').hasText('No date set');

    await renderField(DateField, undefined, 'atom');
    assert.dom('[data-test-date-atom]').hasTextContaining('No date');

    await renderField(TimeField, buildField(TimeField, {}));
    assert.dom('[data-test-time-embedded]').hasText('No time set');

    await renderField(TimeField, buildField(TimeField, {}), 'atom');
    assert.dom('[data-test-time-atom]').hasTextContaining('No time');

    await renderField(DateTimeField, undefined);
    assert
      .dom('[data-test-datetime-embedded]')
      .hasTextContaining('No date/time set');

    await renderField(DateTimeField, undefined, 'atom');
    assert.dom('[data-test-datetime-atom]').hasTextContaining('No date/time');
  });

  test('datetime supports custom format and invalid fallback', async function (assert) {
    await renderConfiguredField(DateTimeField, '2024-05-01T14:30:00', {
      presentation: 'standard',
      format: 'YYYY-MM-DD HH:mm',
    });
    assert
      .dom('[data-test-datetime-embedded]')
      .hasTextContaining('2024-05-01 14:30');

    await renderConfiguredField(DateTimeField, 'not-a-date', {
      presentation: 'standard',
    });
    assert.dom('[data-test-datetime-embedded]').hasTextContaining('Invalid');
  });

  test('date field supports preset and custom format', async function (assert) {
    await renderConfiguredField(DateField, '2024-05-01', {
      presentation: 'standard',
      format: 'YYYY/MM/DD',
    });
    assert.dom('[data-test-date-embedded]').hasText('2024/05/01');

    await renderConfiguredField(DateField, '2024-05-01', {
      presentation: 'standard',
      preset: 'short',
    });
    assert.dom('[data-test-date-embedded]').hasText('5/1/24');
  });

  test('time formatting respects hourCycle/timeStyle options', async function (assert) {
    await renderConfiguredField(
      TimeField,
      buildField(TimeField, { value: '14:00' }),
      {
        presentation: 'standard',
        hourCycle: 'h24',
        timeStyle: 'short',
      },
    );
    assert.dom('[data-test-time-embedded]').hasTextContaining('14');
    assert.dom('[data-test-time-embedded]').doesNotContainText('PM');
  });

  test('open-ended ranges render friendly phrases (date/time ranges)', async function (assert) {
    await renderField(
      DateRangeField,
      buildField(DateRangeField, { start: '2024-05-01' }),
    );
    assert.dom('[data-test-date-range-embedded]').hasText('From May 1, 2024');

    await renderField(
      DateRangeField,
      buildField(DateRangeField, { end: '2024-05-10' }),
    );
    assert.dom('[data-test-date-range-embedded]').hasText('Until May 10, 2024');

    await renderField(DateRangeField, buildField(DateRangeField, {}));
    assert.dom('[data-test-date-range-embedded]').hasText('No date range set');

    await renderField(
      TimeRangeField,
      buildField(TimeRangeField, {
        start: buildField(TimeField, { value: '09:00' }),
      }),
    );
    assert.dom('[data-test-time-range-embedded]').hasText('From 09:00');

    await renderField(
      TimeRangeField,
      buildField(TimeRangeField, {
        end: buildField(TimeField, { value: '17:00' }),
      }),
    );
    assert.dom('[data-test-time-range-embedded]').hasText('Until 17:00');

    await renderField(TimeRangeField, buildField(TimeRangeField, {}));
    assert.dom('[data-test-time-range-embedded]').hasText('No time range set');
  });

  test('atom mode renders compact badges', async function (assert) {
    await renderField(
      DateRangeField,
      buildField(DateRangeField, {
        start: '2024-05-01',
        end: '2024-05-10',
      }),
      'atom',
    );
    assert
      .dom('[data-test-date-range-atom]')
      .hasTextContaining('5/1/24 - 5/10/24');

    await renderField(
      DurationField,
      buildField(DurationField, {
        hours: 1,
        minutes: 5,
        seconds: 0,
      }),
      'atom',
    );
    assert.dom('[data-test-duration-atom]').hasText('1h 5m');

    await renderField(
      MonthYearField,
      buildField(MonthYearField, {
        value: '2025-05',
      }),
      'atom',
    );
    assert.dom('[data-test-month-year-atom]').hasTextContaining('May 2025');

    await renderField(WeekField, buildField(WeekField, {}), 'atom');
    assert.dom('[data-test-week-atom]').hasTextContaining('No week');

    await renderField(MonthField, buildField(MonthField, {}), 'atom');
    assert.dom('[data-test-month-atom]').hasTextContaining('No month');

    await renderField(YearField, buildField(YearField, {}), 'atom');
    assert.dom('[data-test-year-atom]').hasTextContaining('No year');

    await renderField(MonthDayField, buildField(MonthDayField, {}), 'atom');
    assert.dom('[data-test-month-day-atom]').hasTextContaining('No date');
  });

  test('edit mode interactions: time range duration and duration validation', async function (assert) {
    await renderField(
      TimeRangeField,
      buildField(TimeRangeField, {
        start: buildField(TimeField, { value: '09:00' }),
        end: buildField(TimeField, { value: '10:00' }),
      }),
      'edit',
    );
    assert.dom('[data-test-time-input]').exists({ count: 2 });
    assert
      .dom('[data-test-field-container]')
      .hasTextContaining('Duration: 1 hours');

    await renderField(
      DurationField,
      buildField(DurationField, { hours: 1, minutes: 30, seconds: 0 }),
      'edit',
    );
    assert.dom('[data-test-field-container]').hasTextContaining('Hours');
    assert.dom('[data-test-field-container]').hasTextContaining('Minutes');
    assert.dom('[data-test-field-container]').hasTextContaining('Seconds');
  });

  test('edit mode interactions: month/day selects update preview', async function (assert) {
    await renderField(
      MonthDayField,
      buildField(MonthDayField, { month: 5, day: 15 }),
      'edit',
    );
    assert.dom('[data-test-month-select]').exists();
    assert.dom('[data-test-day-select]').exists();
  });

  test('presentation content reflects configuration', async function (assert) {
    await renderConfiguredField(DateTimeField, '2999-01-01T00:00:00Z', {
      presentation: 'countdown',
      countdownOptions: { label: 'Launch', showControls: true },
    });
    assert.dom('[data-test-countdown]').exists();
    assert.dom('[data-test-countdown]').hasTextContaining('Launch');
    assert.dom('[data-test-countdown-toggle]').exists();
    assert.dom('[data-test-countdown-reset]').exists();

    await renderConfiguredField(DateTimeField, '2020-01-01T00:00:00Z', {
      presentation: 'timeAgo',
      timeAgoOptions: { eventLabel: 'Last Activity' },
    });
    assert.dom('[data-test-relative-time]').exists();
    assert.dom('[data-test-relative-time]').hasTextContaining('Last Activity');
    assert.dom('[data-test-relative-time]').hasTextContaining('ago');

    await renderConfiguredField(DateTimeField, '2024-06-01T10:00:00Z', {
      presentation: 'timeline',
      timelineOptions: { eventName: 'Order Placed', status: 'complete' },
    });
    assert.dom('[data-test-timeline-event]').hasTextContaining('Order Placed');

    await renderConfiguredField(DateTimeField, '2000-01-01T00:00:00Z', {
      presentation: 'expirationWarning',
      expirationOptions: { itemName: 'API Token' },
    });
    assert.dom('[data-test-expiration-warning]').exists();
    assert.dom('[data-test-expiration-warning]').hasTextContaining('API Token');
    assert.dom('[data-test-expiration-warning]').hasTextContaining('Expired');

    await renderConfiguredField(
      DateRangeField,
      buildField(DateRangeField, {
        start: '2024-05-06',
        end: '2024-05-10',
      }),
      { presentation: 'businessDays' },
    );
    assert.dom('[data-test-business-days]').exists();
    assert.dom('[data-test-business-days]').hasTextContaining('Calendar Days:');
    assert.dom('[data-test-business-days]').hasTextContaining('Business Days:');

    await renderConfiguredField(
      TimeField,
      buildField(TimeField, { value: '09:00' }),
      {
        presentation: 'timeSlots',
        timeSlotsOptions: { availableSlots: ['09:00 AM', '10:00 AM'] },
      },
    );
    assert.dom('[data-test-time-slots]').exists();
    await click('[data-test-slot="10:00 AM"]');
    assert
      .dom('[data-test-time-slots]')
      .hasTextContaining('Selected: 10:00 AM');
  });

  test('datetime-stamp field renders correctly', async function (assert) {
    await renderField(DatetimeStampField, '2024-05-01T14:30:00Z');
    assert.dom('[data-test-datetime-stamp-embedded]').exists();
    assert
      .dom('[data-test-datetime-stamp-embedded]')
      .doesNotContainText('No timestamp set', 'timestamp value is displayed');

    await renderField(DatetimeStampField, undefined);
    assert
      .dom('[data-test-datetime-stamp-embedded]')
      .hasTextContaining('No timestamp set');

    await renderField(DatetimeStampField, '2024-05-01T14:30:00Z', 'atom');
    assert.dom('[data-test-datetime-stamp-atom]').exists();
    assert
      .dom('[data-test-datetime-stamp-atom]')
      .doesNotContainText('No timestamp');
  });

  test('day field renders correctly', async function (assert) {
    await renderField(DayField, buildField(DayField, { value: 15 }));
    assert.dom('[data-test-day-embedded]').hasText('15th');

    await renderField(DayField, buildField(DayField, {}));
    assert.dom('[data-test-day-embedded]').hasTextContaining('No day set');

    await renderField(DayField, buildField(DayField, { value: 15 }), 'atom');
    assert.dom('[data-test-day-atom]').exists();
    assert.dom('[data-test-day-atom]').hasTextContaining('15');

    await renderField(DayField, buildField(DayField, { value: 15 }), 'edit');
    assert.dom('[data-test-field-container]').exists();
  });

  test('relative time field supports negative offsets', async function (assert) {
    await renderField(
      RelativeTimeField,
      buildField(RelativeTimeField, { amount: 5, unit: 'days' }),
    );
    assert.dom('[data-test-relative-time-embedded]').hasText('In 5 days');

    await renderField(
      RelativeTimeField,
      buildField(RelativeTimeField, { amount: -3, unit: 'hours' }),
    );
    assert.dom('[data-test-relative-time-embedded]').hasText('In -3 hours');

    await renderField(
      RelativeTimeField,
      buildField(RelativeTimeField, { amount: 2, unit: 'weeks' }),
    );
    assert.dom('[data-test-relative-time-embedded]').hasText('In 2 weeks');

    await renderField(
      RelativeTimeField,
      buildField(RelativeTimeField, { amount: 30, unit: 'minutes' }),
    );
    assert.dom('[data-test-relative-time-embedded]').hasText('In 30 minutes');
  });

  test('edit mode for partial calendar fields renders correctly', async function (assert) {
    await renderField(
      YearField,
      buildField(YearField, { value: 2024 }),
      'edit',
    );
    assert.dom('[data-test-field-container]').exists();

    await renderField(MonthField, buildField(MonthField, { value: 5 }), 'edit');
    assert.dom('[data-test-month-select]').exists();

    await renderField(
      QuarterField,
      buildField(QuarterField, { quarter: 2, year: 2025 }),
      'edit',
    );
    assert.dom('[data-test-field-container]').exists();

    await renderField(
      WeekField,
      buildField(WeekField, { value: '2025-W20' }),
      'edit',
    );
    assert.dom('[data-test-field-container]').exists();
  });
});
