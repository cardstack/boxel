import { click } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { ensureTrailingSlash } from '@cardstack/runtime-common';
import type { Loader } from '@cardstack/runtime-common/loader';

import ENV from '@cardstack/host/config/environment';

import {
  setupBaseRealm,
  field,
  contains,
  CardDef,
  Component,
} from '../helpers/base-realm';
import { renderCard } from '../helpers/render-component';
import { setupRenderingTest } from '../helpers/setup';

type FieldFormat = 'embedded' | 'atom' | 'edit';

module('Integration | date-time fields', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);

  let loader: Loader;
  let catalogRealmURL = ensureTrailingSlash(ENV.resolvedCatalogRealmURL);

  let DateFieldClass: any;
  let TimeFieldClass: any;
  let DatetimeFieldClass: any;
  let DatetimeStampFieldClass: any;
  let DayFieldClass: any;
  let DateRangeFieldClass: any;
  let TimeRangeFieldClass: any;
  let DurationFieldClass: any;
  let RelativeTimeFieldClass: any;
  let TimePeriodFieldClass: any;
  let MonthDayFieldClass: any;
  let YearFieldClass: any;
  let MonthFieldClass: any;
  let MonthYearFieldClass: any;
  let WeekFieldClass: any;
  let QuarterFieldClass: any;
  let RecurringPatternFieldClass: any;

  let catalogFieldsLoaded = false;

  hooks.beforeEach(async function () {
    loader = getService('loader-service').loader;
    if (!catalogFieldsLoaded) {
      await loadCatalogFields();
      catalogFieldsLoaded = true;
    }
  });

  async function loadCatalogFields() {
    const dateModule: any = await loader.import(
      `${catalogRealmURL}fields/date`,
    );
    DateFieldClass = dateModule.default;

    const timeModule: any = await loader.import(
      `${catalogRealmURL}fields/time`,
    );
    TimeFieldClass = timeModule.default;

    const datetimeModule: any = await loader.import(
      `${catalogRealmURL}fields/date-time`,
    );
    DatetimeFieldClass = datetimeModule.default;

    const datetimeStampModule: any = await loader.import(
      `${catalogRealmURL}fields/datetime-stamp`,
    );
    DatetimeStampFieldClass = datetimeStampModule.default;

    const dayModule: any = await loader.import(
      `${catalogRealmURL}fields/date/day`,
    );
    DayFieldClass = dayModule.default;

    const dateRangeModule: any = await loader.import(
      `${catalogRealmURL}fields/date/date-range`,
    );
    DateRangeFieldClass = dateRangeModule.default;

    const timeRangeModule: any = await loader.import(
      `${catalogRealmURL}fields/time/time-range`,
    );
    TimeRangeFieldClass = timeRangeModule.default;

    const durationModule: any = await loader.import(
      `${catalogRealmURL}fields/time/duration`,
    );
    DurationFieldClass = durationModule.default;

    const relativeModule: any = await loader.import(
      `${catalogRealmURL}fields/time/relative-time`,
    );
    RelativeTimeFieldClass = relativeModule.default;

    const timePeriodModule: any = await loader.import(
      `${catalogRealmURL}fields/time-period`,
    );
    TimePeriodFieldClass = timePeriodModule.default;

    const monthDayModule: any = await loader.import(
      `${catalogRealmURL}fields/date/month-day`,
    );
    MonthDayFieldClass = monthDayModule.default;

    const yearModule: any = await loader.import(
      `${catalogRealmURL}fields/date/year`,
    );
    YearFieldClass = yearModule.default;

    const monthModule: any = await loader.import(
      `${catalogRealmURL}fields/date/month`,
    );
    MonthFieldClass = monthModule.default;

    const monthYearModule: any = await loader.import(
      `${catalogRealmURL}fields/date/month-year`,
    );
    MonthYearFieldClass = monthYearModule.default;

    const weekModule: any = await loader.import(
      `${catalogRealmURL}fields/date/week`,
    );
    WeekFieldClass = weekModule.default;

    const quarterModule: any = await loader.import(
      `${catalogRealmURL}fields/date/quarter`,
    );
    QuarterFieldClass = quarterModule.default;

    const recurringModule: any = await loader.import(
      `${catalogRealmURL}fields/recurring-pattern`,
    );
    RecurringPatternFieldClass = recurringModule.default;
  }

  async function renderField(
    FieldClass: any,
    value: unknown,
    format: FieldFormat = 'embedded',
  ) {
    const fieldFormat = format;
    const fieldType = FieldClass;

    class TestCard extends CardDef {
      @field sample = contains(fieldType);

      static isolated = class Isolated extends Component<typeof this> {
        format: FieldFormat = fieldFormat;

        <template>
          <div data-test-field-container>
            <@fields.sample @format={{this.format}} />
          </div>
        </template>
      };
    }

    let card = new TestCard({ sample: value });
    await renderCard(loader, card, 'isolated');
  }

  async function renderConfiguredField(
    FieldClass: any,
    value: unknown,
    presentation: any,
    extraConfig: Record<any, unknown> = {},
  ) {
    const fieldType = FieldClass;
    const configuration = { presentation, ...extraConfig } as Record<
      any,
      unknown
    >;

    class TestCard extends CardDef {
      @field sample = contains(fieldType, { configuration });

      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <div data-test-field-container>
            <@fields.sample @format='embedded' />
          </div>
        </template>
      };
    }

    let card = new TestCard({ sample: value });
    await renderCard(loader, card, 'isolated');
  }

  function buildField(FieldClass: any, attrs: Record<any, unknown>) {
    return new FieldClass(attrs);
  }

  test('core date & time fields render their embedded views', async function (assert) {
    await renderField(DateFieldClass, '2024-05-01');
    assert.dom('[data-test-date-embedded]').exists();
    assert
      .dom('[data-test-date-embedded]')
      .doesNotContainText('No date set', 'date value is displayed');

    await renderField(
      TimeFieldClass,
      buildField(TimeFieldClass, { value: '14:00' }),
    );
    assert
      .dom('[data-test-time-embedded]')
      .hasTextContaining('2:00 PM', 'time value is formatted to 12-hour clock');

    await renderField(DatetimeFieldClass, '2024-05-01T14:30:00');
    assert.dom('[data-test-datetime-embedded]').exists();
    assert
      .dom('[data-test-datetime-embedded]')
      .doesNotContainText('No date/time set', 'datetime value is displayed');
  });

  test('range, duration, and relative fields show formatted summaries', async function (assert) {
    await renderField(
      DateRangeFieldClass,
      buildField(DateRangeFieldClass, {
        start: '2024-05-01',
        end: '2024-05-10',
      }),
    );
    assert
      .dom('[data-test-date-range-embedded]')
      .hasText('May 1, 2024 → May 10, 2024');

    await renderField(
      TimeRangeFieldClass,
      buildField(TimeRangeFieldClass, {
        start: buildField(TimeFieldClass, { value: '09:00' }),
        end: buildField(TimeFieldClass, { value: '17:00' }),
      }),
    );
    assert.dom('[data-test-time-range-embedded]').hasText('09:00 → 17:00');

    await renderField(
      DurationFieldClass,
      buildField(DurationFieldClass, {
        hours: 1,
        minutes: 30,
        seconds: 0,
      }),
    );
    assert
      .dom('[data-test-duration-embedded]')
      .hasText('1h 30m', 'duration renders in compact notation');

    await renderField(
      RelativeTimeFieldClass,
      buildField(RelativeTimeFieldClass, { amount: 3, unit: 'hours' }),
    );
    assert.dom('[data-test-relative-time-embedded]').hasText('In 3 hours');

    await renderField(
      RecurringPatternFieldClass,
      buildField(RecurringPatternFieldClass, {
        pattern: 'weekly',
        startDate: '2024-05-01',
        endDate: '2024-06-01',
      }),
    );
    assert
      .dom('[data-test-recurring-embedded]')
      .hasTextContaining(
        'Weekly',
        'recurring pattern summarizes the configured schedule',
      );
  });

  test('partial calendar fields render friendly labels', async function (assert) {
    await renderField(
      MonthDayFieldClass,
      buildField(MonthDayFieldClass, { month: '05', day: '15' }),
    );
    assert
      .dom('[data-test-month-day-embedded]')
      .hasText('May 15', 'month/day is spelled out');

    await renderField(
      YearFieldClass,
      buildField(YearFieldClass, { value: 2025 }),
    );
    assert.dom('[data-test-year-embedded]').hasText('2025');

    await renderField(
      MonthFieldClass,
      buildField(MonthFieldClass, { value: 5 }),
    );
    assert.dom('[data-test-month-embedded]').hasText('May');

    await renderField(
      MonthYearFieldClass,
      buildField(MonthYearFieldClass, { value: '2025-05' }),
    );
    assert.dom('[data-test-month-year-embedded]').hasText('May 2025');

    await renderField(
      WeekFieldClass,
      buildField(WeekFieldClass, { value: '2025-W20' }),
    );
    assert.dom('[data-test-week-embedded]').hasText('week 20, 2025');

    await renderField(
      QuarterFieldClass,
      buildField(QuarterFieldClass, { quarter: 2, year: 2025 }),
    );
    assert.dom('[data-test-quarter-embedded]').hasText('Q2 2025');
  });

  test('presentation modes render their specialized components', async function (assert) {
    // DatetimeField presentations
    await renderConfiguredField(
      DatetimeFieldClass,
      '2025-01-01T00:00:00Z',
      'countdown',
      { countdownOptions: { label: 'Launch', showControls: true } },
    );
    assert.dom('[data-test-countdown]').exists();

    await renderConfiguredField(
      DatetimeFieldClass,
      '2024-01-01T00:00:00Z',
      'timeAgo',
      {
        timeAgoOptions: { eventLabel: 'Last Activity', updateInterval: 60000 },
      },
    );
    assert.dom('[data-test-relative-time]').exists();

    await renderConfiguredField(
      DatetimeFieldClass,
      '2024-06-01T10:00:00Z',
      'timeline',
      { timelineOptions: { eventName: 'Order Placed', status: 'complete' } },
    );
    assert.dom('[data-test-timeline-event]').exists();

    await renderConfiguredField(
      DatetimeFieldClass,
      '2025-06-01T10:00:00Z',
      'expirationWarning',
      { expirationOptions: { itemName: 'API Token' } },
    );
    assert.dom('[data-test-expiration-warning]').exists();

    // DateField presentation: age
    await renderConfiguredField(DateFieldClass, '1990-05-01', 'age', {
      ageOptions: { showNextBirthday: true },
    });
    assert.dom('[data-test-age-calculator]').exists();

    // DateRangeField presentation: businessDays (needs instance)
    await renderConfiguredField(
      DateRangeFieldClass,
      buildField(DateRangeFieldClass, {
        start: '2024-05-01',
        end: '2024-05-10',
      }),
      'businessDays',
    );
    assert.dom('[data-test-business-days]').exists();

    // TimeField presentation: timeSlots (needs instance)
    await renderConfiguredField(
      TimeFieldClass,
      buildField(TimeFieldClass, {
        value: '09:00',
      }),
      'timeSlots',
      { timeSlotsOptions: { availableSlots: ['09:00', '10:00'] } },
    );
    assert.dom('[data-test-time-slots]').exists();
  });

  test('missing values render placeholders in embedded and atom modes', async function (assert) {
    await renderField(DateFieldClass, undefined);
    assert.dom('[data-test-date-embedded]').hasText('No date set');

    await renderField(DateFieldClass, undefined, 'atom');
    assert.dom('[data-test-date-atom]').hasTextContaining('No date');

    await renderField(TimeFieldClass, buildField(TimeFieldClass, {}));
    assert.dom('[data-test-time-embedded]').hasText('No time set');

    await renderField(TimeFieldClass, buildField(TimeFieldClass, {}), 'atom');
    assert.dom('[data-test-time-atom]').hasTextContaining('No time');

    await renderField(DatetimeFieldClass, undefined);
    assert
      .dom('[data-test-datetime-embedded]')
      .hasTextContaining('No date/time set');

    await renderField(DatetimeFieldClass, undefined, 'atom');
    assert.dom('[data-test-datetime-atom]').hasTextContaining('No date/time');
  });

  test('datetime supports custom format and invalid fallback', async function (assert) {
    await renderConfiguredField(
      DatetimeFieldClass,
      '2024-05-01T14:30:00',
      'standard',
      { format: 'YYYY-MM-DD HH:mm' },
    );
    assert
      .dom('[data-test-datetime-embedded]')
      .hasTextContaining('2024-05-01 14:30');

    await renderConfiguredField(DatetimeFieldClass, 'not-a-date', 'standard');
    assert.dom('[data-test-datetime-embedded]').hasTextContaining('Invalid');
  });

  test('date field supports preset and custom format', async function (assert) {
    await renderConfiguredField(DateFieldClass, '2024-05-01', 'standard', {
      format: 'YYYY/MM/DD',
    });
    assert.dom('[data-test-date-embedded]').hasText('2024/05/01');

    await renderConfiguredField(DateFieldClass, '2024-05-01', 'standard', {
      preset: 'short',
    });
    assert.dom('[data-test-date-embedded]').hasText('5/1/24');
  });

  test('time formatting respects hourCycle/timeStyle options', async function (assert) {
    await renderConfiguredField(
      TimeFieldClass,
      buildField(TimeFieldClass, { value: '14:00' }),
      'standard',
      { hourCycle: 'h24', timeStyle: 'short' },
    );
    assert.dom('[data-test-time-embedded]').hasTextContaining('14');
    assert.dom('[data-test-time-embedded]').doesNotContainText('PM');
  });

  test('open-ended ranges render friendly phrases (date/time ranges)', async function (assert) {
    await renderField(
      DateRangeFieldClass,
      buildField(DateRangeFieldClass, { start: '2024-05-01' }),
    );
    assert.dom('[data-test-date-range-embedded]').hasText('From May 1, 2024');

    await renderField(
      DateRangeFieldClass,
      buildField(DateRangeFieldClass, { end: '2024-05-10' }),
    );
    assert.dom('[data-test-date-range-embedded]').hasText('Until May 10, 2024');

    await renderField(DateRangeFieldClass, buildField(DateRangeFieldClass, {}));
    assert.dom('[data-test-date-range-embedded]').hasText('No date range set');

    await renderField(
      TimeRangeFieldClass,
      buildField(TimeRangeFieldClass, {
        start: buildField(TimeFieldClass, { value: '09:00' }),
      }),
    );
    assert.dom('[data-test-time-range-embedded]').hasText('From 09:00');

    await renderField(
      TimeRangeFieldClass,
      buildField(TimeRangeFieldClass, {
        end: buildField(TimeFieldClass, { value: '17:00' }),
      }),
    );
    assert.dom('[data-test-time-range-embedded]').hasText('Until 17:00');

    await renderField(TimeRangeFieldClass, buildField(TimeRangeFieldClass, {}));
    assert.dom('[data-test-time-range-embedded]').hasText('No time range set');
  });

  test('atom mode renders compact badges', async function (assert) {
    await renderField(
      DateRangeFieldClass,
      buildField(DateRangeFieldClass, {
        start: '2024-05-01',
        end: '2024-05-10',
      }),
      'atom',
    );
    assert
      .dom('[data-test-date-range-atom]')
      .hasTextContaining('5/1/24 - 5/10/24');

    await renderField(
      DurationFieldClass,
      buildField(DurationFieldClass, {
        hours: 1,
        minutes: 5,
        seconds: 0,
      }),
      'atom',
    );
    assert.dom('[data-test-duration-atom]').hasText('1h 5m');

    await renderField(
      MonthYearFieldClass,
      buildField(MonthYearFieldClass, {
        value: '2025-05',
      }),
      'atom',
    );
    assert.dom('[data-test-month-year-atom]').hasTextContaining('May 2025');

    await renderField(WeekFieldClass, buildField(WeekFieldClass, {}), 'atom');
    assert.dom('[data-test-week-atom]').hasTextContaining('No week');

    await renderField(MonthFieldClass, buildField(MonthFieldClass, {}), 'atom');
    assert.dom('[data-test-month-atom]').hasTextContaining('No month');

    await renderField(YearFieldClass, buildField(YearFieldClass, {}), 'atom');
    assert.dom('[data-test-year-atom]').hasTextContaining('No year');

    await renderField(
      MonthDayFieldClass,
      buildField(MonthDayFieldClass, {}),
      'atom',
    );
    assert.dom('[data-test-month-day-atom]').hasTextContaining('No date');
  });

  test('edit mode interactions: time range duration and duration validation', async function (assert) {
    await renderField(
      TimeRangeFieldClass,
      buildField(TimeRangeFieldClass, {
        start: buildField(TimeFieldClass, { value: '09:00' }),
        end: buildField(TimeFieldClass, { value: '10:00' }),
      }),
      'edit',
    );
    assert.dom('[data-test-time-input]').exists({ count: 2 });
    assert
      .dom('[data-test-field-container]')
      .hasTextContaining('Duration: 1 hours');

    await renderField(
      DurationFieldClass,
      buildField(DurationFieldClass, { hours: 1, minutes: 30, seconds: 0 }),
      'edit',
    );
    assert.dom('[data-test-field-container]').hasTextContaining('Hours');
    assert.dom('[data-test-field-container]').hasTextContaining('Minutes');
    assert.dom('[data-test-field-container]').hasTextContaining('Seconds');
  });

  test('edit mode interactions: month/day selects update preview', async function (assert) {
    await renderField(
      MonthDayFieldClass,
      buildField(MonthDayFieldClass, { month: 5, day: 15 }),
      'edit',
    );
    assert.dom('[data-test-month-select]').exists();
    assert.dom('[data-test-day-select]').exists();
  });

  test('presentation content reflects configuration', async function (assert) {
    await renderConfiguredField(
      DatetimeFieldClass,
      '2999-01-01T00:00:00Z',
      'countdown',
      { countdownOptions: { label: 'Launch', showControls: true } },
    );
    assert.dom('[data-test-countdown]').exists();
    assert.dom('[data-test-countdown]').hasTextContaining('Launch');
    assert.dom('[data-test-countdown-toggle]').exists();
    assert.dom('[data-test-countdown-reset]').exists();

    await renderConfiguredField(
      DatetimeFieldClass,
      '2020-01-01T00:00:00Z',
      'timeAgo',
      { timeAgoOptions: { eventLabel: 'Last Activity' } },
    );
    assert.dom('[data-test-relative-time]').exists();
    assert.dom('[data-test-relative-time]').hasTextContaining('Last Activity');
    assert.dom('[data-test-relative-time]').hasTextContaining('ago');

    await renderConfiguredField(
      DatetimeFieldClass,
      '2024-06-01T10:00:00Z',
      'timeline',
      { timelineOptions: { eventName: 'Order Placed', status: 'complete' } },
    );
    assert.dom('[data-test-timeline-event]').hasTextContaining('Order Placed');

    await renderConfiguredField(
      DatetimeFieldClass,
      '2000-01-01T00:00:00Z',
      'expirationWarning',
      { expirationOptions: { itemName: 'API Token' } },
    );
    assert.dom('[data-test-expiration-warning]').exists();
    assert.dom('[data-test-expiration-warning]').hasTextContaining('API Token');
    assert.dom('[data-test-expiration-warning]').hasTextContaining('Expired');

    await renderConfiguredField(
      DateRangeFieldClass,
      buildField(DateRangeFieldClass, {
        start: '2024-05-06',
        end: '2024-05-10',
      }),
      'businessDays',
    );
    assert.dom('[data-test-business-days]').exists();
    assert.dom('[data-test-business-days]').hasTextContaining('Calendar Days:');
    assert.dom('[data-test-business-days]').hasTextContaining('Business Days:');

    await renderConfiguredField(
      TimeFieldClass,
      buildField(TimeFieldClass, { value: '09:00' }),
      'timeSlots',
      { timeSlotsOptions: { availableSlots: ['09:00 AM', '10:00 AM'] } },
    );
    assert.dom('[data-test-time-slots]').exists();
    await click('[data-test-slot="10:00 AM"]');
    assert
      .dom('[data-test-time-slots]')
      .hasTextContaining('Selected: 10:00 AM');
  });

  test('datetime-stamp field renders correctly', async function (assert) {
    await renderField(DatetimeStampFieldClass, '2024-05-01T14:30:00Z');
    assert.dom('[data-test-datetime-stamp-embedded]').exists();
    assert
      .dom('[data-test-datetime-stamp-embedded]')
      .doesNotContainText('No timestamp set', 'timestamp value is displayed');

    await renderField(DatetimeStampFieldClass, undefined);
    assert
      .dom('[data-test-datetime-stamp-embedded]')
      .hasTextContaining('No timestamp set');

    await renderField(DatetimeStampFieldClass, '2024-05-01T14:30:00Z', 'atom');
    assert.dom('[data-test-datetime-stamp-atom]').exists();
    assert
      .dom('[data-test-datetime-stamp-atom]')
      .doesNotContainText('No timestamp');
  });

  test('day field renders correctly', async function (assert) {
    await renderField(DayFieldClass, buildField(DayFieldClass, { value: 15 }));
    assert.dom('[data-test-day-embedded]').hasText('15th');

    await renderField(DayFieldClass, buildField(DayFieldClass, {}));
    assert.dom('[data-test-day-embedded]').hasTextContaining('No day set');

    await renderField(
      DayFieldClass,
      buildField(DayFieldClass, { value: 15 }),
      'atom',
    );
    assert.dom('[data-test-day-atom]').exists();
    assert.dom('[data-test-day-atom]').hasTextContaining('15');

    await renderField(
      DayFieldClass,
      buildField(DayFieldClass, { value: 15 }),
      'edit',
    );
    assert.dom('[data-test-field-container]').exists();
  });

  test('time-period field renders correctly', async function (assert) {
    await renderField(
      TimePeriodFieldClass,
      buildField(TimePeriodFieldClass, {
        periodLabel: 'Q2 2024',
      }),
    );
    assert.dom('[data-test-time-period-embedded]').exists();
    assert.dom('[data-test-time-period-embedded]').hasTextContaining('Q2 2024');

    await renderField(
      TimePeriodFieldClass,
      buildField(TimePeriodFieldClass, {}),
    );
    assert
      .dom('[data-test-time-period-embedded]')
      .hasTextContaining('No period set');

    await renderField(
      TimePeriodFieldClass,
      buildField(TimePeriodFieldClass, {
        periodLabel: 'Q2 2024',
      }),
      'atom',
    );
    assert.dom('[data-test-time-period-atom]').exists();
    assert.dom('[data-test-time-period-atom]').hasTextContaining('Q2 2024');
  });

  test('time-period field recognizes calendar year format', async function (assert) {
    await renderField(
      TimePeriodFieldClass,
      buildField(TimePeriodFieldClass, {
        periodLabel: '2024',
      }),
    );
    assert
      .dom('[data-test-time-period-embedded]')
      .hasTextContaining('Calendar Year');
    assert.dom('[data-test-time-period-embedded]').hasTextContaining('2024');
  });

  test('time-period field recognizes fiscal year format', async function (assert) {
    await renderField(
      TimePeriodFieldClass,
      buildField(TimePeriodFieldClass, {
        periodLabel: '2023-2024',
      }),
    );
    assert
      .dom('[data-test-time-period-embedded]')
      .hasTextContaining('Fiscal Year');
    assert
      .dom('[data-test-time-period-embedded]')
      .hasTextContaining('2023-2024');

    // Short format
    await renderField(
      TimePeriodFieldClass,
      buildField(TimePeriodFieldClass, {
        periodLabel: '2023-24',
      }),
    );
    assert
      .dom('[data-test-time-period-embedded]')
      .hasTextContaining('Fiscal Year');
  });

  test('time-period field recognizes quarter format', async function (assert) {
    await renderField(
      TimePeriodFieldClass,
      buildField(TimePeriodFieldClass, {
        periodLabel: 'Q1 2024',
      }),
    );
    assert.dom('[data-test-time-period-embedded]').hasTextContaining('Quarter');
    assert.dom('[data-test-time-period-embedded]').hasTextContaining('Q1 2024');

    // Reverse format
    await renderField(
      TimePeriodFieldClass,
      buildField(TimePeriodFieldClass, {
        periodLabel: '2024 Q3',
      }),
    );
    assert.dom('[data-test-time-period-embedded]').hasTextContaining('Quarter');
  });

  test('time-period field recognizes month format', async function (assert) {
    await renderField(
      TimePeriodFieldClass,
      buildField(TimePeriodFieldClass, {
        periodLabel: 'January 2024',
      }),
    );
    assert.dom('[data-test-time-period-embedded]').hasTextContaining('Month');

    // Abbreviated
    await renderField(
      TimePeriodFieldClass,
      buildField(TimePeriodFieldClass, {
        periodLabel: 'Jan 2024',
      }),
    );
    assert.dom('[data-test-time-period-embedded]').hasTextContaining('Month');

    // With period
    await renderField(
      TimePeriodFieldClass,
      buildField(TimePeriodFieldClass, {
        periodLabel: 'Feb. 2024',
      }),
    );
    assert.dom('[data-test-time-period-embedded]').hasTextContaining('Month');
  });

  test('time-period field recognizes week format', async function (assert) {
    await renderField(
      TimePeriodFieldClass,
      buildField(TimePeriodFieldClass, {
        periodLabel: 'Week 12 2025',
      }),
    );
    assert.dom('[data-test-time-period-embedded]').hasTextContaining('Week');

    // Abbreviated format
    await renderField(
      TimePeriodFieldClass,
      buildField(TimePeriodFieldClass, {
        periodLabel: 'Wk12 2025',
      }),
    );
    assert.dom('[data-test-time-period-embedded]').hasTextContaining('Week');

    // Reverse format
    await renderField(
      TimePeriodFieldClass,
      buildField(TimePeriodFieldClass, {
        periodLabel: '2025 Wk12',
      }),
    );
    assert.dom('[data-test-time-period-embedded]').hasTextContaining('Week');
  });

  test('time-period field recognizes session format', async function (assert) {
    await renderField(
      TimePeriodFieldClass,
      buildField(TimePeriodFieldClass, {
        periodLabel: 'Fall 2024',
      }),
    );
    assert.dom('[data-test-time-period-embedded]').hasTextContaining('Session');

    await renderField(
      TimePeriodFieldClass,
      buildField(TimePeriodFieldClass, {
        periodLabel: 'Spring 2025',
      }),
    );
    assert.dom('[data-test-time-period-embedded]').hasTextContaining('Session');

    await renderField(
      TimePeriodFieldClass,
      buildField(TimePeriodFieldClass, {
        periodLabel: 'Summer 2024',
      }),
    );
    assert.dom('[data-test-time-period-embedded]').hasTextContaining('Session');
  });

  test('time-period field recognizes session week format', async function (assert) {
    await renderField(
      TimePeriodFieldClass,
      buildField(TimePeriodFieldClass, {
        periodLabel: 'Wk4 Spring 2025',
      }),
    );
    assert
      .dom('[data-test-time-period-embedded]')
      .hasTextContaining('Session Week');
  });

  test('time-period field auto-normalizes partial inputs with current year', async function (assert) {
    const currentYear = new Date().getFullYear().toString();

    // Quarter without year
    await renderField(
      TimePeriodFieldClass,
      buildField(TimePeriodFieldClass, {
        periodLabel: 'Q1',
      }),
    );
    assert.dom('[data-test-time-period-embedded]').hasTextContaining('Quarter');
    assert
      .dom('[data-test-time-period-embedded]')
      .hasTextContaining(currentYear);

    // Month without year
    await renderField(
      TimePeriodFieldClass,
      buildField(TimePeriodFieldClass, {
        periodLabel: 'March',
      }),
    );
    assert.dom('[data-test-time-period-embedded]').hasTextContaining('Month');
    assert
      .dom('[data-test-time-period-embedded]')
      .hasTextContaining(currentYear);

    // Season without year
    await renderField(
      TimePeriodFieldClass,
      buildField(TimePeriodFieldClass, {
        periodLabel: 'Fall',
      }),
    );
    assert.dom('[data-test-time-period-embedded]').hasTextContaining('Session');
    assert
      .dom('[data-test-time-period-embedded]')
      .hasTextContaining(currentYear);

    // Week without year
    await renderField(
      TimePeriodFieldClass,
      buildField(TimePeriodFieldClass, {
        periodLabel: 'Week 12',
      }),
    );
    assert.dom('[data-test-time-period-embedded]').hasTextContaining('Week');
    assert
      .dom('[data-test-time-period-embedded]')
      .hasTextContaining(currentYear);
  });

  test('time-period field displays date range for recognized formats', async function (assert) {
    // Quarter shows date range
    await renderField(
      TimePeriodFieldClass,
      buildField(TimePeriodFieldClass, {
        periodLabel: 'Q2 2024',
      }),
    );
    assert.dom('[data-test-time-period-embedded]').hasTextContaining('Apr');
    assert.dom('[data-test-time-period-embedded]').hasTextContaining('Jun');

    // Month shows date range
    await renderField(
      TimePeriodFieldClass,
      buildField(TimePeriodFieldClass, {
        periodLabel: 'May 2024',
      }),
    );
    assert.dom('[data-test-time-period-embedded]').hasTextContaining('May 1');
    assert.dom('[data-test-time-period-embedded]').hasTextContaining('31');
  });

  test('time-period field edit mode allows custom input', async function (assert) {
    await renderField(
      TimePeriodFieldClass,
      buildField(TimePeriodFieldClass, {
        periodLabel: 'Q3 2024',
      }),
      'edit',
    );
    assert.dom('[data-test-time-period-input]').exists();
    assert.dom('[data-test-time-period-input]').hasValue('Q3 2024');
  });

  test('relative time field handles future and past times', async function (assert) {
    // Future time
    await renderField(
      RelativeTimeFieldClass,
      buildField(RelativeTimeFieldClass, { amount: 5, unit: 'days' }),
    );
    assert.dom('[data-test-relative-time-embedded]').hasText('In 5 days');

    // Negative amount
    await renderField(
      RelativeTimeFieldClass,
      buildField(RelativeTimeFieldClass, { amount: -3, unit: 'hours' }),
    );
    assert.dom('[data-test-relative-time-embedded]').hasText('In -3 hours');

    // Different units
    await renderField(
      RelativeTimeFieldClass,
      buildField(RelativeTimeFieldClass, { amount: 2, unit: 'weeks' }),
    );
    assert.dom('[data-test-relative-time-embedded]').hasText('In 2 weeks');

    await renderField(
      RelativeTimeFieldClass,
      buildField(RelativeTimeFieldClass, { amount: 30, unit: 'minutes' }),
    );
    assert.dom('[data-test-relative-time-embedded]').hasText('In 30 minutes');
  });

  test('recurring pattern field displays pattern details', async function (assert) {
    // Daily pattern
    await renderField(
      RecurringPatternFieldClass,
      buildField(RecurringPatternFieldClass, {
        pattern: 'daily',
        startDate: '2024-05-01',
        endDate: '2024-05-31',
      }),
    );
    assert.dom('[data-test-recurring-embedded]').hasTextContaining('Daily');

    // Monthly pattern
    await renderField(
      RecurringPatternFieldClass,
      buildField(RecurringPatternFieldClass, {
        pattern: 'monthly',
        startDate: '2024-05-01',
      }),
    );
    assert.dom('[data-test-recurring-embedded]').hasTextContaining('Monthly');

    // Custom pattern with interval
    await renderField(
      RecurringPatternFieldClass,
      buildField(RecurringPatternFieldClass, {
        pattern: 'custom',
        interval: 2,
        unit: 'days',
        startDate: '2024-05-01',
      }),
    );
    assert
      .dom('[data-test-recurring-embedded]')
      .hasTextContaining('Every 2 days');
  });

  test('edit mode for partial calendar fields renders correctly', async function (assert) {
    // Year field edit mode
    await renderField(
      YearFieldClass,
      buildField(YearFieldClass, { value: 2024 }),
      'edit',
    );
    assert.dom('[data-test-field-container]').exists();

    // Month field edit mode
    await renderField(
      MonthFieldClass,
      buildField(MonthFieldClass, { value: 5 }),
      'edit',
    );
    assert.dom('[data-test-month-select]').exists();

    // Quarter field edit mode
    await renderField(
      QuarterFieldClass,
      buildField(QuarterFieldClass, { quarter: 2, year: 2025 }),
      'edit',
    );
    assert.dom('[data-test-field-container]').exists();

    // Week field edit mode
    await renderField(
      WeekFieldClass,
      buildField(WeekFieldClass, { value: '2025-W20' }),
      'edit',
    );
    assert.dom('[data-test-field-container]').exists();
  });
});
