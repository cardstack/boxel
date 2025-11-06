import { eq } from '@cardstack/boxel-ui/helpers';
// ═══ [EDIT TRACKING: ON] Mark all changes with ⁿ ═══
import {
  CardDef,
  field,
  contains,
  Component,
} from 'https://cardstack.com/base/card-api'; // ¹ Core imports
import StringField from 'https://cardstack.com/base/string';
import { DateField } from '../fields/date'; // ² Import DateField
import { TimeField } from '../fields/time'; // ³ Import TimeField
import { DatetimeField } from '../fields/date-time'; // ⁴ Import DatetimeField
import { DateRangeField } from '../fields/date/date-range'; // ⁵ Import DateRangeField
import { TimeRangeField } from '../fields/time/time-range'; // ⁶ Import TimeRangeField
import { DurationField } from '../fields/time/duration'; // ⁷ Import DurationField
import { RelativeTimeField } from '../fields/time/relative-time'; // ⁸ Import RelativeTimeField
import { MonthDayField } from '../fields/date/month-day'; // ⁹ Import MonthDayField
import { QuarterField } from '../fields/date/quarter'; // ¹⁰ Import QuarterField
import { RecurringPatternField } from '../fields/recurring-pattern'; // ¹¹ Import RecurringPatternField
import { YearField } from '../fields/date/year'; // ¹² Import YearField
import { MonthField } from '../fields/date/month'; // ¹³ Import MonthField
import { MonthYearField } from '../fields/date/month-year'; // ¹⁴ Import MonthYearField
import { WeekField } from '../fields/date/week'; // ¹⁵ Import WeekField
import CalendarIcon from '@cardstack/boxel-icons/calendar';
import { BoxelSelect } from '@cardstack/boxel-ui/components'; // ³ BoxelSelect component
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
export class DateTimePreview extends CardDef {
  // ³ Preview card definition
  static displayName = 'Date & Time Fields Showcase';
  static icon = CalendarIcon;

  @field title = contains(StringField, {
    // ⁴ Card title
    computeVia: function () {
      return 'Date & Time Widget Library';
    },
  });

  // ¹⁶ Playground control fields
  @field playgroundFieldType = contains(StringField);
  @field playgroundPresentation = contains(StringField);

  // ¹⁷ Playground fields - one for each field type
  @field playgroundDate = contains(DateField, {
    configuration: function (this: DateTimePreview) {
      return {
        presentation: this.playgroundPresentation || 'standard',
      };
    },
  });

  @field playgroundTime = contains(TimeField, {
    configuration: function (this: DateTimePreview) {
      return {
        presentation: this.playgroundPresentation || 'standard',
      };
    },
  });

  @field playgroundDatetime = contains(DatetimeField, {
    configuration: function (this: DateTimePreview) {
      return {
        presentation: this.playgroundPresentation || 'standard',
      };
    },
  });

  @field playgroundYear = contains(YearField);
  @field playgroundMonth = contains(MonthField);
  @field playgroundMonthYear = contains(MonthYearField);
  @field playgroundWeek = contains(WeekField);
  @field playgroundDateRange = contains(DateRangeField, {
    configuration: function (this: DateTimePreview) {
      return {
        presentation: this.playgroundPresentation || 'standard',
      };
    },
  });
  @field playgroundTimeRange = contains(TimeRangeField);
  @field playgroundDuration = contains(DurationField);
  @field playgroundRelativeTime = contains(RelativeTimeField);

  // ²⁸ BASIC DATE & TIME INPUTS - Using separate field types

  // ²⁹ Single date picker
  @field appointmentDate = contains(DateField);

  // ³⁰ Time picker
  @field meetingTime = contains(TimeField);

  // ³¹ DateTime picker
  @field eventDateTime = contains(DatetimeField);

  // ⁹ INDEPENDENT SPECIALIZED FIELDS - Now separate FieldDef types

  // ¹⁰ Date range picker - uses independent DateRangeField
  @field campaignPeriod = contains(DateRangeField);

  // ¹¹ Time range picker - uses independent TimeRangeField
  @field workingHours = contains(TimeRangeField);

  // ¹² Duration input - uses independent DurationField
  @field taskDuration = contains(DurationField);

  // ¹³ PARTIAL DATE INPUTS - Mix of unified DateTimeField and independent fields

  // ¹⁴ Birthday picker - uses independent MonthDayField
  @field birthday = contains(MonthDayField);

  // ³² Year picker (fiscal year, graduation, etc.)
  @field fiscalYear = contains(YearField);

  // ³³ Month picker (billing month, reports)
  @field billingMonth = contains(MonthField);

  // ³⁴ Month-year picker (payroll, statements)
  @field payPeriod = contains(MonthYearField);

  // ³⁵ Week picker (ISO weeks, timesheets)
  @field workWeek = contains(WeekField);

  // ¹⁹ Quarter picker - uses independent QuarterField
  @field financialQuarter = contains(QuarterField);

  // ²⁰ Relative time input - uses independent RelativeTimeField
  @field publishIn = contains(RelativeTimeField);

  // ²¹ PRESENTATION MODES - Using unified DateTimeField with presentation configuration

  // ²² Countdown timer presentation - using DatetimeField
  @field productLaunchCountdown = contains(DatetimeField, {
    configuration: {
      presentation: 'countdown',
      countdownOptions: {
        label: 'Product Launch',
        showControls: true,
      },
    },
  });

  // ²³ Relative time display presentation - using DatetimeField
  @field lastActivityTime = contains(DatetimeField, {
    configuration: {
      presentation: 'timeAgo',
      timeAgoOptions: {
        eventLabel: 'Last Activity',
        updateInterval: 60000,
      },
    },
  });

  // ²⁴ Timeline event presentation - using DatetimeField
  @field orderPlaced = contains(DatetimeField, {
    configuration: {
      presentation: 'timeline',
      timelineOptions: {
        eventName: 'Order Placed',
        status: 'complete',
      },
    },
  });

  // ²⁵ Age calculator presentation - using DateField
  @field employeeAge = contains(DateField, {
    configuration: {
      presentation: 'age',
      ageOptions: {
        showNextBirthday: true,
      },
    },
  });

  // ²⁶ Business days calculator - uses DateRangeField with presentation
  @field deliveryCalculation = contains(DateRangeField, {
    configuration: {
      presentation: 'businessDays',
    },
  });

  // ²⁷ Time slot picker - uses TimeField with presentation
  @field appointmentSlots = contains(TimeField, {
    configuration: {
      presentation: 'timeSlots',
    },
  });

  // ³⁶ Expiration warning presentation - using DatetimeField
  @field tokenExpiry = contains(DatetimeField, {
    configuration: {
      presentation: 'expirationWarning',
      expirationOptions: {
        itemName: 'API Token',
      },
    },
  });

  // ²⁹ Recurring pattern - uses independent RecurringPatternField
  @field meetingRecurrence = contains(RecurringPatternField);

  // ¹⁸ Isolated format - shows edit mode for all components
  static isolated = class Isolated extends Component<typeof this> {
    // ¹⁸ Compatibility map - defines which presentations work with each field type
    compatibilityMap: Record<string, string[]> = {
      date: ['standard', 'countdown', 'timeline', 'age'],
      time: ['standard', 'timeSlots'],
      datetime: [
        'standard',
        'countdown',
        'timeAgo',
        'timeline',
        'expirationWarning',
      ],
      dateRange: ['standard', 'businessDays'],
      year: ['standard'],
      month: ['standard'],
      monthYear: ['standard'],
      week: ['standard'],
      timeRange: ['standard'],
      duration: ['standard'],
      relativeTime: ['standard'],
    };

    // ¹⁹ Field type options
    fieldTypeOptions = [
      { value: 'date', label: 'DateField', fieldName: 'playgroundDate' },
      { value: 'time', label: 'TimeField', fieldName: 'playgroundTime' },
      {
        value: 'datetime',
        label: 'DatetimeField',
        fieldName: 'playgroundDatetime',
      },
      { value: 'year', label: 'YearField', fieldName: 'playgroundYear' },
      { value: 'month', label: 'MonthField', fieldName: 'playgroundMonth' },
      {
        value: 'monthYear',
        label: 'MonthYearField',
        fieldName: 'playgroundMonthYear',
      },
      { value: 'week', label: 'WeekField', fieldName: 'playgroundWeek' },
      {
        value: 'dateRange',
        label: 'DateRangeField',
        fieldName: 'playgroundDateRange',
      },
      {
        value: 'timeRange',
        label: 'TimeRangeField',
        fieldName: 'playgroundTimeRange',
      },
      {
        value: 'duration',
        label: 'DurationField',
        fieldName: 'playgroundDuration',
      },
      {
        value: 'relativeTime',
        label: 'RelativeTimeField',
        fieldName: 'playgroundRelativeTime',
      },
    ];

    // ²⁰ All presentation options
    allPresentationOptions = [
      { value: 'standard', label: 'Standard' },
      { value: 'countdown', label: 'Countdown Timer' },
      { value: 'timeAgo', label: 'Time Ago' },
      { value: 'age', label: 'Age Calculator' },
      { value: 'businessDays', label: 'Business Days' },
      { value: 'timeline', label: 'Timeline Event' },
      { value: 'timeSlots', label: 'Time Slots' },
      { value: 'expirationWarning', label: 'Expiration Warning' },
    ];

    get selectedFieldType() {
      const value = this.args.model?.playgroundFieldType || 'date';
      return this.fieldTypeOptions.find((opt) => opt.value === value);
    }

    get selectedPresentation() {
      const value = this.args.model?.playgroundPresentation || 'standard';
      return this.availablePresentationOptions.find(
        (opt) => opt.value === value,
      );
    }

    // ²¹ Filter presentation options based on selected field type
    get availablePresentationOptions() {
      const fieldType = this.args.model?.playgroundFieldType || 'date';
      const compatiblePresentations = this.compatibilityMap[fieldType] || [
        'standard',
      ];

      return this.allPresentationOptions.filter((option) =>
        compatiblePresentations.includes(option.value),
      );
    }

    // ²² Get the current playground field name
    get currentPlaygroundField() {
      const fieldType = this.args.model?.playgroundFieldType || 'date';
      const option = this.fieldTypeOptions.find(
        (opt) => opt.value === fieldType,
      );
      return option?.fieldName || 'playgroundDate';
    }

    @action
    updateFieldType(option: { value: string; label: string } | null) {
      if (option && this.args.model) {
        this.args.model.playgroundFieldType = option.value;

        // ²³ Auto-reset presentation to 'standard' if incompatible
        const currentPresentation =
          this.args.model.playgroundPresentation || 'standard';
        const compatiblePresentations = this.compatibilityMap[option.value] || [
          'standard',
        ];

        if (!compatiblePresentations.includes(currentPresentation)) {
          this.args.model.playgroundPresentation = 'standard';
        }
      }
    }

    @action
    updatePresentation(option: { value: string; label: string } | null) {
      if (option && this.args.model) {
        this.args.model.playgroundPresentation = option.value;
      }
    }

    // ²⁴ Generate configuration code based on current selection
    get configCode() {
      const fieldType = this.args.model?.playgroundFieldType || 'date';
      const presentation =
        this.args.model?.playgroundPresentation || 'standard';
      const option = this.fieldTypeOptions.find(
        (opt) => opt.value === fieldType,
      );
      const fieldTypeName = option?.label || 'DateField';

      // Fields without presentation support
      const simplFields = [
        'year',
        'month',
        'monthYear',
        'week',
        'timeRange',
        'duration',
        'relativeTime',
      ];

      if (simplFields.includes(fieldType)) {
        return `@field myField = contains(${fieldTypeName});`;
      }

      // Fields with presentation support
      if (presentation === 'standard') {
        return `@field myField = contains(${fieldTypeName});`;
      }

      return `@field myField = contains(${fieldTypeName}, {
  configuration: {
    presentation: '${presentation}'
  }
});`;
    }

    <template>
      <div class='showcase'>
        <header class='showcase-header'>
          <h1>DateTimeField</h1>
          <div class='header-highlight'>
            All powered by
            <code>DateTimeField</code>
            with
            <code>inputType</code>
            configuration
          </div>
        </header>

        {{! ²⁵ Multi-Field Playground Section }}
        <section class='playground-section'>
          <div class='playground-header'>
            <h2>Interactive Playground</h2>
            <p>Experiment with different field types and presentation modes!
              Switch between fields to see their unique capabilities.</p>
          </div>

          {{! Configuration Controls }}
          <div class='playground-controls'>
            <div class='control-group'>
              <label class='control-label'>Field Type</label>
              <BoxelSelect
                @selected={{this.selectedFieldType}}
                @options={{this.fieldTypeOptions}}
                @onChange={{this.updateFieldType}}
                @placeholder='Select field type'
                class='config-select'
                data-test-field-type-select
                as |option|
              >
                {{option.label}}
              </BoxelSelect>
            </div>

            <div class='control-group'>
              <label class='control-label'>Presentation Mode</label>
              <BoxelSelect
                @selected={{this.selectedPresentation}}
                @options={{this.availablePresentationOptions}}
                @onChange={{this.updatePresentation}}
                @placeholder='Select presentation'
                class='config-select'
                data-test-presentation-select
                as |option|
              >
                {{option.label}}
              </BoxelSelect>
            </div>
          </div>

          <div class='playground-card'>
            <div class='playground-column'>
              <h3>Edit Mode</h3>
              <p class='playground-hint'>Change the value below</p>
              <div class='playground-demo'>
                {{! ²⁶ Dynamically render the selected playground field }}
                {{#if (eq this.currentPlaygroundField 'playgroundDate')}}
                  <@fields.playgroundDate @format='edit' />
                {{else if (eq this.currentPlaygroundField 'playgroundTime')}}
                  <@fields.playgroundTime @format='edit' />
                {{else if
                  (eq this.currentPlaygroundField 'playgroundDatetime')
                }}
                  <@fields.playgroundDatetime @format='edit' />
                {{else if (eq this.currentPlaygroundField 'playgroundYear')}}
                  <@fields.playgroundYear @format='edit' />
                {{else if (eq this.currentPlaygroundField 'playgroundMonth')}}
                  <@fields.playgroundMonth @format='edit' />
                {{else if
                  (eq this.currentPlaygroundField 'playgroundMonthYear')
                }}
                  <@fields.playgroundMonthYear @format='edit' />
                {{else if (eq this.currentPlaygroundField 'playgroundWeek')}}
                  <@fields.playgroundWeek @format='edit' />
                {{else if
                  (eq this.currentPlaygroundField 'playgroundDateRange')
                }}
                  <@fields.playgroundDateRange @format='edit' />
                {{else if
                  (eq this.currentPlaygroundField 'playgroundTimeRange')
                }}
                  <@fields.playgroundTimeRange @format='edit' />
                {{else if
                  (eq this.currentPlaygroundField 'playgroundDuration')
                }}
                  <@fields.playgroundDuration @format='edit' />
                {{else if
                  (eq this.currentPlaygroundField 'playgroundRelativeTime')
                }}
                  <@fields.playgroundRelativeTime @format='edit' />
                {{/if}}
              </div>
            </div>
            <div class='playground-divider'></div>
            <div class='playground-column'>
              <h3>Display</h3>
              <p class='playground-hint'>See how it renders</p>
              <div class='playground-demo'>
                {{! ²⁷ Dynamically render the selected playground field in embedded format }}
                {{#if (eq this.currentPlaygroundField 'playgroundDate')}}
                  <@fields.playgroundDate @format='embedded' />
                {{else if (eq this.currentPlaygroundField 'playgroundTime')}}
                  <@fields.playgroundTime @format='embedded' />
                {{else if
                  (eq this.currentPlaygroundField 'playgroundDatetime')
                }}
                  <@fields.playgroundDatetime @format='embedded' />
                {{else if (eq this.currentPlaygroundField 'playgroundYear')}}
                  <@fields.playgroundYear @format='embedded' />
                {{else if (eq this.currentPlaygroundField 'playgroundMonth')}}
                  <@fields.playgroundMonth @format='embedded' />
                {{else if
                  (eq this.currentPlaygroundField 'playgroundMonthYear')
                }}
                  <@fields.playgroundMonthYear @format='embedded' />
                {{else if (eq this.currentPlaygroundField 'playgroundWeek')}}
                  <@fields.playgroundWeek @format='embedded' />
                {{else if
                  (eq this.currentPlaygroundField 'playgroundDateRange')
                }}
                  <@fields.playgroundDateRange @format='embedded' />
                {{else if
                  (eq this.currentPlaygroundField 'playgroundTimeRange')
                }}
                  <@fields.playgroundTimeRange @format='embedded' />
                {{else if
                  (eq this.currentPlaygroundField 'playgroundDuration')
                }}
                  <@fields.playgroundDuration @format='embedded' />
                {{else if
                  (eq this.currentPlaygroundField 'playgroundRelativeTime')
                }}
                  <@fields.playgroundRelativeTime @format='embedded' />
                {{/if}}
              </div>
            </div>
          </div>
          <div class='playground-code'>
            <div class='code-header'>
              <svg
                class='code-icon'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <polyline points='16 18 22 12 16 6'></polyline>
                <polyline points='8 6 2 12 8 18'></polyline>
              </svg>
              <span>Configuration Code</span>
            </div>
            <pre class='code-block'><code>{{this.configCode}}</code></pre>
          </div>
          <div class='playground-info'>
            <svg
              class='info-icon'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='2'
            >
              <circle cx='12' cy='12' r='10'></circle>
              <line x1='12' y1='16' x2='12' y2='12'></line>
              <line x1='12' y1='8' x2='12.01' y2='8'></line>
            </svg>
            <span>Switch between different field types to explore their unique
              capabilities and presentation modes!</span>
          </div>
        </section>

        {{! ³⁷ Core Field Types }}
        <section class='input-section'>
          <div class='section-header-inline'>
            <h2>Core Field Types</h2>
            <p>Basic date, time, and datetime fields</p>
          </div>
          <div class='components-grid'>
            <div class='component-card'>
              <div class='component-info'>
                <h3>DateField</h3>
                <p>Single date selection</p>
                <code class='config'>contains(DateField)</code>
                <span class='use-case'>Appointments • Deadlines • Events</span>
              </div>
              <div class='component-demo'>
                <@fields.appointmentDate @format='edit' />
              </div>
            </div>

            <div class='component-card'>
              <div class='component-info'>
                <h3>TimeField</h3>
                <p>Time input</p>
                <code class='config'>contains(TimeField)</code>
                <span class='use-case'>Meetings • Reminders • Schedules</span>
              </div>
              <div class='component-demo'>
                <@fields.meetingTime @format='edit' />
              </div>
            </div>

            <div class='component-card'>
              <div class='component-info'>
                <h3>DatetimeField</h3>
                <p>Combined date and time</p>
                <code class='config'>contains(DatetimeField)</code>
                <span class='use-case'>Events • Bookings • Timestamps</span>
              </div>
              <div class='component-demo'>
                <@fields.eventDateTime @format='edit' />
              </div>
            </div>
          </div>
        </section>

        {{! ³⁸ Partial Date Fields }}
        <section class='input-section'>
          <div class='section-header-inline'>
            <h2>Partial Date Fields</h2>
            <p>Year, month, week specialized fields</p>
          </div>
          <div class='components-grid'>
            <div class='component-card'>
              <div class='component-info'>
                <h3>YearField</h3>
                <p>Year-only selection</p>
                <code class='config'>contains(YearField)</code>
                <span class='use-case'>Fiscal Year • Graduation • Archives</span>
              </div>
              <div class='component-demo'>
                <@fields.fiscalYear @format='edit' />
              </div>
            </div>

            <div class='component-card'>
              <div class='component-info'>
                <h3>MonthField</h3>
                <p>Month-only selection</p>
                <code class='config'>contains(MonthField)</code>
                <span class='use-case'>Billing • Reports • Planning</span>
              </div>
              <div class='component-demo'>
                <@fields.billingMonth @format='edit' />
              </div>
            </div>

            <div class='component-card'>
              <div class='component-info'>
                <h3>MonthYearField</h3>
                <p>Combined month and year</p>
                <code class='config'>contains(MonthYearField)</code>
                <span class='use-case'>Payroll • Statements • Archives</span>
              </div>
              <div class='component-demo'>
                <@fields.payPeriod @format='edit' />
              </div>
            </div>

            <div class='component-card'>
              <div class='component-info'>
                <h3>WeekField</h3>
                <p>ISO week selection</p>
                <code class='config'>contains(WeekField)</code>
                <span class='use-case'>Timesheets • Sprint Planning • Schedules</span>
              </div>
              <div class='component-demo'>
                <@fields.workWeek @format='edit' />
              </div>
            </div>
          </div>
        </section>

        {{! ³¹ Independent Specialized Fields }}
        <section class='input-section'>
          <div class='section-header-inline'>
            <h2>Independent Specialized Fields</h2>
            <p>Dedicated FieldDef types for complex date/time use cases</p>
          </div>
          <div class='components-grid'>
            <div class='component-card'>
              <div class='component-info'>
                <h3>DateRangeField</h3>
                <p>Independent field for date ranges</p>
                <code class='config'>contains(DateRangeField)</code>
                <span class='use-case'>Campaigns • Projects • Vacations</span>
              </div>
              <div class='component-demo'>
                <@fields.campaignPeriod @format='edit' />
              </div>
            </div>

            <div class='component-card'>
              <div class='component-info'>
                <h3>TimeRangeField</h3>
                <p>Independent field for time ranges</p>
                <code class='config'>contains(TimeRangeField)</code>
                <span class='use-case'>Shifts • Operating Hours • Availability</span>
              </div>
              <div class='component-demo'>
                <@fields.workingHours @format='edit' />
              </div>
            </div>

            <div class='component-card'>
              <div class='component-info'>
                <h3>DurationField</h3>
                <p>Hours:Minutes:Seconds input</p>
                <code class='config'>contains(DurationField)</code>
                <span class='use-case'>Tasks • Videos • Workouts</span>
              </div>
              <div class='component-demo'>
                <@fields.taskDuration @format='edit' />
              </div>
            </div>

            <div class='component-card'>
              <div class='component-info'>
                <h3>MonthDayField</h3>
                <p>Birthday/anniversary (no year)</p>
                <code class='config'>contains(MonthDayField)</code>
                <span class='use-case'>Birthdays • Anniversaries • Holidays</span>
              </div>
              <div class='component-demo'>
                <@fields.birthday @format='edit' />
              </div>
            </div>

            <div class='component-card'>
              <div class='component-info'>
                <h3>QuarterField</h3>
                <p>Fiscal quarter selector</p>
                <code class='config'>contains(QuarterField)</code>
                <span class='use-case'>Financial Reports • Business Planning</span>
              </div>
              <div class='component-demo'>
                <@fields.financialQuarter @format='edit' />
              </div>
            </div>

            <div class='component-card'>
              <div class='component-info'>
                <h3>RelativeTimeField</h3>
                <p>"In X hours/days" scheduler</p>
                <code class='config'>contains(RelativeTimeField)</code>
                <span class='use-case'>Publish Later • Reminders • Delays</span>
              </div>
              <div class='component-demo'>
                <@fields.publishIn @format='edit' />
              </div>
            </div>

            <div class='component-card'>
              <div class='component-info'>
                <h3>RecurringPatternField</h3>
                <p>Full recurrence rules editor</p>
                <code class='config'>contains(RecurringPatternField)</code>
                <span class='use-case'>Calendar Events • Meetings • Schedules</span>
              </div>
              <div class='component-demo'>
                <@fields.meetingRecurrence @format='edit' />
              </div>
            </div>
          </div>
        </section>

        {{! ³¹ Presentation Modes Section }}
        <header class='section-header'>
          <h2>Presentation Modes</h2>
          <p>Use DateField, DatetimeField, TimeField, and DateRangeField with
            presentation configuration for auto-updating, interactive, and
            calculated displays</p>
        </header>

        <div class='components-grid'>
          <div class='component-card'>
            <div class='component-info'>
              <h3>Countdown Timer (DatetimeField)</h3>
              <p>Live countdown with controls</p>
              <code class='config'>DatetimeField with presentation: 'countdown'</code>
              <span class='use-case'>Launches • Deadlines • Events</span>
            </div>
            <div class='component-demo'>
              <@fields.productLaunchCountdown @format='embedded' />
            </div>
          </div>

          <div class='component-card'>
            <div class='component-info'>
              <h3>Time Ago Display (DatetimeField)</h3>
              <p>Auto-updating relative timestamps</p>
              <code class='config'>DatetimeField with presentation: 'timeAgo'</code>
              <span class='use-case'>Social • Activity Feeds • Logs</span>
            </div>
            <div class='component-demo'>
              <@fields.lastActivityTime @format='embedded' />
            </div>
          </div>

          <div class='component-card'>
            <div class='component-info'>
              <h3>Timeline Event (DatetimeField)</h3>
              <p>Status-tracked timeline entries</p>
              <code class='config'>DatetimeField with presentation: 'timeline'</code>
              <span class='use-case'>Order Tracking • Process Flows</span>
            </div>
            <div class='component-demo'>
              <@fields.orderPlaced @format='embedded' />
            </div>
          </div>

          <div class='component-card'>
            <div class='component-info'>
              <h3>Age Calculator (DateField)</h3>
              <p>Auto-calculated age from birthdate</p>
              <code class='config'>DateField with presentation: 'age'</code>
              <span class='use-case'>HR • CRM • Healthcare</span>
            </div>
            <div class='component-demo'>
              <@fields.employeeAge @format='embedded' />
            </div>
          </div>

          <div class='component-card'>
            <div class='component-info'>
              <h3>Business Days (DateRangeField)</h3>
              <p>Working days calculation</p>
              <code class='config'>DateRangeField with presentation:
                'businessDays'</code>
              <span class='use-case'>Delivery • SLA • Project Planning</span>
            </div>
            <div class='component-demo'>
              <@fields.deliveryCalculation @format='embedded' />
            </div>
          </div>

          <div class='component-card'>
            <div class='component-info'>
              <h3>Time Slots (TimeField)</h3>
              <p>Visual slot picker</p>
              <code class='config'>TimeField with presentation: 'timeSlots'</code>
              <span class='use-case'>Scheduling • Booking • Reservations</span>
            </div>
            <div class='component-demo'>
              <@fields.appointmentSlots @format='embedded' />
            </div>
          </div>

          <div class='component-card'>
            <div class='component-info'>
              <h3>Expiration Warning</h3>
              <p>Auto-updating expiry alerts</p>
              <span class='use-case'>Tokens • Licenses • Subscriptions</span>
            </div>
            <div class='component-demo'>
              <@fields.tokenExpiry @format='embedded' />
            </div>
          </div>
        </div>
      </div>

      <style scoped>
        .showcase {
          width: 100%;
          max-width: 767px;
          margin: 0 auto;
          padding: 2rem 1rem;
          background: var(--background, #ffffff);
        }

        .showcase-header {
          text-align: center;
          margin-bottom: 2rem;
        }

        .showcase-header h1 {
          font-size: 1.5rem;
          font-weight: 700;
          color: var(--foreground, #0f172a);
          margin: 0 0 0.5rem;
          letter-spacing: -0.02em;
        }

        .showcase-header p {
          font-size: 0.875rem;
          color: var(--muted-foreground, #64748b);
          margin: 0 0 1rem;
        }

        .header-highlight {
          display: inline-block;
          padding: 0.5rem 0.75rem;
          background: linear-gradient(
            135deg,
            rgba(59, 130, 246, 0.1),
            rgba(147, 51, 234, 0.1)
          );
          border: 1px solid rgba(59, 130, 246, 0.2);
          border-radius: var(--radius, 0.5rem);
          font-size: 0.75rem;
          color: var(--foreground, #0f172a);
        }

        .header-highlight code {
          background: rgba(59, 130, 246, 0.1);
          padding: 0.125rem 0.375rem;
          border-radius: 0.25rem;
          font-family: var(--font-mono, monospace);
          font-size: 0.8125rem;
          color: var(--primary, #3b82f6);
        }

        .playground-section {
          margin-bottom: 3rem;
          padding: 1.5rem;
          background: linear-gradient(
            135deg,
            rgba(59, 130, 246, 0.05),
            rgba(147, 51, 234, 0.05)
          );
          border: 2px solid var(--primary, #3b82f6);
          border-radius: var(--radius, 0.75rem);
        }

        .playground-header {
          text-align: center;
          margin-bottom: 1.5rem;
        }

        .playground-header h2 {
          font-size: 1.25rem;
          font-weight: 700;
          color: var(--foreground, #0f172a);
          margin: 0 0 0.5rem;
        }

        .playground-header p {
          font-size: 0.875rem;
          color: var(--muted-foreground, #64748b);
          margin: 0;
        }

        .playground-controls {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 1rem;
          margin-bottom: 1.5rem;
        }

        .control-group {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .control-label {
          font-size: 0.875rem;
          font-weight: 600;
          color: var(--foreground, #0f172a);
        }

        .config-select {
          width: 100%;
        }

        .playground-card {
          display: grid;
          grid-template-columns: 1fr auto 1fr;
          gap: 1.5rem;
          background: var(--card, #ffffff);
          border: 1px solid var(--border, #e2e8f0);
          border-radius: var(--radius, 0.5rem);
          padding: 1.5rem;
          margin-bottom: 1rem;
        }

        .playground-column {
          display: flex;
          flex-direction: column;
        }

        .playground-column h3 {
          font-size: 0.875rem;
          font-weight: 600;
          color: var(--foreground, #0f172a);
          margin: 0 0 0.25rem;
        }

        .playground-hint {
          font-size: 0.75rem;
          color: var(--muted-foreground, #94a3b8);
          margin: 0 0 1rem;
        }

        .playground-demo {
          flex: 1;
          display: flex;
          align-items: center;
        }

        .playground-divider {
          width: 1px;
          background: linear-gradient(
            to bottom,
            transparent,
            var(--border, #e2e8f0) 20%,
            var(--border, #e2e8f0) 80%,
            transparent
          );
        }

        .playground-info {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.75rem 1rem;
          background: rgba(59, 130, 246, 0.05);
          border: 1px solid rgba(59, 130, 246, 0.2);
          border-radius: var(--radius, 0.375rem);
          font-size: 0.75rem;
          color: var(--muted-foreground, #64748b);
          transition: all 0.3s ease;
        }

        .playground-info.warning {
          background: rgba(251, 146, 60, 0.1);
          border-color: rgba(251, 146, 60, 0.3);
        }

        .playground-info.warning .info-icon {
          color: var(--chart3, #fb923c);
        }

        .info-icon {
          width: 1rem;
          height: 1rem;
          flex-shrink: 0;
          color: var(--primary, #3b82f6);
        }

        .playground-info code {
          background: rgba(59, 130, 246, 0.1);
          padding: 0.125rem 0.375rem;
          border-radius: 0.25rem;
          font-family: var(--font-mono, monospace);
          font-size: 0.6875rem;
          color: var(--primary, #3b82f6);
        }

        .playground-code {
          margin-bottom: 1rem;
          background: var(--muted, #f8fafc);
          border: 1px solid var(--border, #e2e8f0);
          border-radius: var(--radius, 0.5rem);
          overflow: hidden;
        }

        .code-header {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.75rem 1rem;
          background: var(--card, #ffffff);
          border-bottom: 1px solid var(--border, #e2e8f0);
          font-size: 0.75rem;
          font-weight: 600;
          color: var(--foreground, #0f172a);
        }

        .code-icon {
          width: 1rem;
          height: 1rem;
          color: var(--primary, #3b82f6);
        }

        .code-block {
          margin: 0;
          padding: 1rem;
          overflow-x: auto;
        }

        .code-block code {
          font-family: var(--font-mono, 'Courier New', monospace);
          font-size: 0.75rem;
          line-height: 1.6;
          color: var(--foreground, #1e293b);
          white-space: pre;
        }

        .input-section {
          margin-bottom: 2rem;
        }

        .section-header-inline {
          margin-bottom: 1rem;
        }

        .section-header-inline h2 {
          font-size: 1.125rem;
          font-weight: 700;
          color: var(--foreground, #0f172a);
          margin: 0 0 0.25rem;
        }

        .section-header-inline p {
          font-size: 0.875rem;
          color: var(--muted-foreground, #64748b);
          margin: 0;
        }

        .section-header {
          text-align: center;
          margin: 2.5rem 0 2rem;
          padding-top: 2rem;
          border-top: 2px solid var(--border, #e2e8f0);
        }

        .section-header h2 {
          font-size: 1.25rem;
          font-weight: 700;
          color: var(--foreground, #0f172a);
          margin: 0 0 0.5rem;
          letter-spacing: -0.02em;
        }

        .section-header p {
          font-size: 0.8125rem;
          color: var(--muted-foreground, #64748b);
          margin: 0;
        }

        .components-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 1rem;
        }

        .components-grid-half {
          display: grid;
          grid-template-columns: 1fr;
          gap: 1rem;
        }

        .components-grid-single {
          display: grid;
          grid-template-columns: 1fr;
        }

        .component-card.full-width {
          grid-column: 1 / -1;
        }

        .component-card {
          background: var(--card, #ffffff);
          border: 1px solid var(--border, #e2e8f0);
          border-radius: var(--radius, 0.5rem);
          padding: 1rem;
          transition: all 0.2s ease;
        }

        .component-card:hover {
          border-color: var(--ring, #3b82f6);
          box-shadow: var(--shadow-md, 0 4px 6px -1px rgba(0, 0, 0, 0.1));
        }

        .component-info {
          margin-bottom: 0.75rem;
          padding-bottom: 0.75rem;
          border-bottom: 1px solid var(--border, #e2e8f0);
        }

        .component-info h3 {
          font-size: 0.875rem;
          font-weight: 600;
          color: var(--foreground, #0f172a);
          margin: 0 0 0.25rem;
        }

        .component-info p {
          font-size: 0.875rem;
          color: var(--muted-foreground, #64748b);
          margin: 0 0 0.5rem;
        }

        .component-info code.config {
          display: inline-block;
          font-size: 0.6875rem;
          font-family: var(--font-mono, monospace);
          background: rgba(59, 130, 246, 0.1);
          color: var(--primary, #3b82f6);
          padding: 0.125rem 0.375rem;
          border-radius: 0.25rem;
          margin-top: 0.25rem;
        }

        .component-info .use-case {
          display: block;
          font-size: 0.6875rem;
          color: var(--muted-foreground, #94a3b8);
          margin-top: 0.5rem;
          font-style: italic;
        }

        .component-demo {
          min-height: 3rem;
        }

        @media (max-width: 768px) {
          .showcase {
            padding: 2rem 1rem;
          }

          .showcase-header h1 {
            font-size: 1.75rem;
          }

          .showcase-header p {
            font-size: 1rem;
          }

          .playground-section {
            padding: 1rem;
          }

          .playground-card {
            grid-template-columns: 1fr;
            gap: 1rem;
            padding: 1rem;
          }

          .playground-divider {
            display: none;
          }

          .playground-controls {
            grid-template-columns: 1fr;
          }

          .components-grid,
          .components-grid-half {
            grid-template-columns: 1fr;
            gap: 1rem;
          }

          .component-card {
            padding: 1.25rem;
          }
        }
      </style>
    </template>
  };
}
