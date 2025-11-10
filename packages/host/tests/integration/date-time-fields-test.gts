import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { ensureTrailingSlash } from '@cardstack/runtime-common';
import { Loader } from '@cardstack/runtime-common/loader';

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
  let DateRangeFieldClass: any;
  let TimeRangeFieldClass: any;
  let DurationFieldClass: any;
  let RelativeTimeFieldClass: any;
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
    DateFieldClass = dateModule.DateField ?? dateModule.default;

    const timeModule: any = await loader.import(
      `${catalogRealmURL}fields/time`,
    );
    TimeFieldClass = timeModule.TimeField;

    const datetimeModule: any = await loader.import(
      `${catalogRealmURL}fields/date-time`,
    );
    DatetimeFieldClass = datetimeModule.DatetimeField;

    const dateRangeModule: any = await loader.import(
      `${catalogRealmURL}fields/date/date-range`,
    );
    DateRangeFieldClass = dateRangeModule.DateRangeField;

    const timeRangeModule: any = await loader.import(
      `${catalogRealmURL}fields/time/time-range`,
    );
    TimeRangeFieldClass = timeRangeModule.TimeRangeField;

    const durationModule: any = await loader.import(
      `${catalogRealmURL}fields/time/duration`,
    );
    DurationFieldClass = durationModule.DurationField;

    const relativeModule: any = await loader.import(
      `${catalogRealmURL}fields/time/relative-time`,
    );
    RelativeTimeFieldClass = relativeModule.RelativeTimeField;

    const monthDayModule: any = await loader.import(
      `${catalogRealmURL}fields/date/month-day`,
    );
    MonthDayFieldClass = monthDayModule.MonthDayField;

    const yearModule: any = await loader.import(
      `${catalogRealmURL}fields/date/year`,
    );
    YearFieldClass = yearModule.YearField;

    const monthModule: any = await loader.import(
      `${catalogRealmURL}fields/date/month`,
    );
    MonthFieldClass = monthModule.MonthField;

    const monthYearModule: any = await loader.import(
      `${catalogRealmURL}fields/date/month-year`,
    );
    MonthYearFieldClass = monthYearModule.MonthYearField;

    const weekModule: any = await loader.import(
      `${catalogRealmURL}fields/date/week`,
    );
    WeekFieldClass = weekModule.WeekField;

    const quarterModule: any = await loader.import(
      `${catalogRealmURL}fields/date/quarter`,
    );
    QuarterFieldClass = quarterModule.QuarterField;

    const recurringModule: any = await loader.import(
      `${catalogRealmURL}fields/recurring-pattern`,
    );
    RecurringPatternFieldClass = recurringModule.RecurringPatternField;
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
    presentation: string,
    extraConfig: Record<string, unknown> = {},
  ) {
    const fieldType = FieldClass;
    const configuration = { presentation, ...extraConfig } as Record<
      string,
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

  function buildField(FieldClass: any, attrs: Record<string, unknown>) {
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
      .hasText('2024-05-01 → 2024-05-10');

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
      buildField(YearFieldClass, { value: '2025' }),
    );
    assert.dom('[data-test-year-embedded]').hasText('2025');

    await renderField(
      MonthFieldClass,
      buildField(MonthFieldClass, { value: '05' }),
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
    assert.dom('[data-test-week-embedded]').hasText('Week 20 of 2025');

    await renderField(
      QuarterFieldClass,
      buildField(QuarterFieldClass, { quarter: 'Q2', year: '2025' }),
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
});
