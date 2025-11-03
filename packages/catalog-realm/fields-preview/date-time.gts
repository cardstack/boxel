// ═══ [EDIT TRACKING: ON] Mark all changes with ⁿ ═══
import {
  CardDef,
  field,
  contains,
  Component,
} from 'https://cardstack.com/base/card-api'; // ¹ Core imports
import StringField from 'https://cardstack.com/base/string';
import { DateTimeField } from '../fields/date-time'; // ² Import unified DateTimeField
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

  // ⁴ᵃ Configuration control fields - BoxelSelect updates these
  @field playgroundInputType = contains(StringField);
  @field playgroundPresentation = contains(StringField);

  // ⁴ᵇ PLAYGROUND - Dynamic configuration via function!
  @field playground = contains(DateTimeField, {
    configuration: function (this: DateTimePreview) {
      return {
        inputType: this.playgroundInputType || 'datetime',
        presentation: this.playgroundPresentation || 'standard',
        placeholder: 'Try editing this field!',
      };
    },
  });

  // ⁵ BASIC DATE & TIME INPUTS - Using unified DateTimeField with inputType

  // ⁶ Single date picker
  @field appointmentDate = contains(DateTimeField, {
    configuration: {
      inputType: 'date',
      placeholder: 'Select appointment date',
    },
  });

  // ⁷ Time picker (12-hour)
  @field meetingTime = contains(DateTimeField, {
    configuration: {
      inputType: 'time',
      timeFormat: '12h',
      placeholder: 'Select meeting time',
    },
  });

  // ⁸ DateTime picker
  @field eventDateTime = contains(DateTimeField, {
    configuration: {
      inputType: 'datetime',
      placeholder: 'Select event date and time',
    },
  });

  // ⁹ RANGE INPUTS - Start/End selections

  // ¹⁰ Date range picker
  @field campaignPeriod = contains(DateTimeField, {
    configuration: {
      inputType: 'date-range',
      placeholder: 'Select campaign period',
    },
  });

  // ¹¹ Time range picker (24-hour format)
  @field workingHours = contains(DateTimeField, {
    configuration: {
      inputType: 'time-range',
      timeFormat: '24h',
      placeholder: 'Set working hours',
    },
  });

  // ¹² DURATION INPUT - Hours/Minutes/Seconds

  @field taskDuration = contains(DateTimeField, {
    configuration: {
      inputType: 'duration',
      placeholder: 'Enter task duration',
    },
  });

  // ¹³ PARTIAL DATE INPUTS - Granular selections

  // ¹⁴ Birthday picker (month-day only, privacy-focused)
  @field birthday = contains(DateTimeField, {
    configuration: {
      inputType: 'month-day',
      placeholder: 'Select birthday',
    },
  });

  // ¹⁵ Year picker (fiscal year, graduation, etc.)
  @field fiscalYear = contains(DateTimeField, {
    configuration: {
      inputType: 'year',
      placeholder: 'Select fiscal year',
    },
  });

  // ¹⁶ Month picker (billing month, reports)
  @field billingMonth = contains(DateTimeField, {
    configuration: {
      inputType: 'month',
      placeholder: 'Select billing month',
    },
  });

  // ¹⁷ Month-year picker (payroll, statements)
  @field payPeriod = contains(DateTimeField, {
    configuration: {
      inputType: 'month-year',
      placeholder: 'Select pay period',
    },
  });

  // ¹⁸ Week picker (ISO weeks, timesheets)
  @field workWeek = contains(DateTimeField, {
    configuration: {
      inputType: 'week',
      placeholder: 'Select work week',
    },
  });

  // ¹⁹ Quarter picker (Q1-Q4, financial reports)
  @field financialQuarter = contains(DateTimeField, {
    configuration: {
      inputType: 'quarter',
      placeholder: 'Select financial quarter',
    },
  });

  // ²⁰ RELATIVE TIME INPUT - Human-friendly scheduling

  @field publishIn = contains(DateTimeField, {
    configuration: {
      inputType: 'relative',
      placeholder: 'Publish in...',
    },
  });

  // ²¹ PRESENTATION MODES - Using unified DateTimeField with presentation configuration

  // ²² Countdown timer presentation
  @field productLaunchCountdown = contains(DateTimeField, {
    configuration: {
      inputType: 'datetime',
      presentation: 'countdown',
      countdownOptions: {
        label: 'Product Launch',
        showControls: true,
      },
    },
  });

  // ²³ Relative time display presentation
  @field lastActivityTime = contains(DateTimeField, {
    configuration: {
      inputType: 'datetime',
      presentation: 'timeAgo',
      timeAgoOptions: {
        eventLabel: 'Last Activity',
        updateInterval: 60000,
      },
    },
  });

  // ²⁴ Timeline event presentation
  @field orderPlaced = contains(DateTimeField, {
    configuration: {
      inputType: 'datetime',
      presentation: 'timeline',
      timelineOptions: {
        eventName: 'Order Placed',
        status: 'complete',
      },
    },
  });

  // ²⁵ Age calculator presentation
  @field employeeAge = contains(DateTimeField, {
    configuration: {
      inputType: 'date',
      presentation: 'age',
      ageOptions: {
        showNextBirthday: true,
      },
    },
  });

  // ²⁶ Business days calculator presentation
  @field deliveryCalculation = contains(DateTimeField, {
    configuration: {
      inputType: 'date-range',
      presentation: 'businessDays',
    },
  });

  // ²⁷ Time slot picker presentation
  @field appointmentSlots = contains(DateTimeField, {
    configuration: {
      inputType: 'time',
      presentation: 'timeSlots',
      timeSlotsOptions: {
        availableSlots: [
          '09:00 AM',
          '10:00 AM',
          '11:00 AM',
          '12:00 PM',
          '01:00 PM',
          '02:00 PM',
          '03:00 PM',
          '04:00 PM',
          '05:00 PM',
        ],
      },
    },
  });

  // ²⁸ Expiration warning presentation
  @field tokenExpiry = contains(DateTimeField, {
    configuration: {
      inputType: 'datetime',
      presentation: 'expirationWarning',
      expirationOptions: {
        itemName: 'API Token',
      },
    },
  });

  // ²⁹ Recurring pattern input - migrated from presentation to input type
  @field meetingRecurrence = contains(DateTimeField, {
    configuration: {
      inputType: 'recurring', // ⁶⁶ Now an input type, not presentation
      placeholder: 'Select repeat pattern',
    },
  });

  // ¹⁸ Isolated format - shows edit mode for all components
  static isolated = class Isolated extends Component<typeof this> {
    // ⁴⁸ Compatibility map - defines which presentations work with which input types
    compatibilityMap: Record<string, string[]> = {
      standard: [
        'date',
        'time',
        'datetime',
        'date-range',
        'time-range',
        'duration',
        'month-day',
        'year',
        'month',
        'month-year',
        'week',
        'quarter',
        'relative',
        'recurring', // ⁶⁴ Added recurring to standard presentation
      ],
      countdown: ['datetime', 'date'],
      timeAgo: ['datetime', 'date'],
      age: ['date', 'month-day'],
      businessDays: ['date-range'],
      timeline: ['datetime', 'date'],
      timeSlots: ['time', 'datetime'],
      expirationWarning: ['datetime', 'date'],
    };

    // Initialize from card's field values
    get selectedInputType() {
      const value = this.args.model?.playgroundInputType || 'datetime';
      return this.inputTypeOptions.find((opt) => opt.value === value);
    }

    get selectedPresentation() {
      const value = this.args.model?.playgroundPresentation || 'standard';
      return this.availablePresentationOptions.find(
        (opt) => opt.value === value,
      );
    }

    inputTypeOptions = [
      { value: 'date', label: 'Date' },
      { value: 'time', label: 'Time' },
      { value: 'datetime', label: 'DateTime' },
      { value: 'date-range', label: 'Date Range' },
      { value: 'time-range', label: 'Time Range' },
      { value: 'duration', label: 'Duration' },
      { value: 'month-day', label: 'Birthday (Month-Day)' },
      { value: 'year', label: 'Year' },
      { value: 'month', label: 'Month' },
      { value: 'month-year', label: 'Month-Year' },
      { value: 'week', label: 'Week' },
      { value: 'quarter', label: 'Quarter' },
      { value: 'relative', label: 'Relative Time' },
      { value: 'recurring', label: 'Recurring Pattern' }, // ⁶² Added recurring input type
    ];

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

    // ⁴⁹ Filter presentation options based on selected input type
    get availablePresentationOptions() {
      const inputType = this.args.model?.playgroundInputType || 'datetime';

      return this.allPresentationOptions.filter((option) => {
        const compatibleInputs = this.compatibilityMap[option.value] || [];
        return compatibleInputs.includes(inputType);
      });
    }

    // ⁵⁰ Check if current combination is valid
    get isValidCombination() {
      const inputType = this.args.model?.playgroundInputType || 'datetime';
      const presentation =
        this.args.model?.playgroundPresentation || 'standard';
      const compatibleInputs = this.compatibilityMap[presentation] || [];
      return compatibleInputs.includes(inputType);
    }

    @action
    updateInputType(option: { value: string; label: string } | null) {
      if (option && this.args.model) {
        this.args.model.playgroundInputType = option.value;

        // ⁵¹ Auto-reset presentation to 'standard' if current combo is incompatible
        const currentPresentation =
          this.args.model.playgroundPresentation || 'standard';
        const compatibleInputs =
          this.compatibilityMap[currentPresentation] || [];

        if (!compatibleInputs.includes(option.value)) {
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

    get configCode() {
      const inputType = this.args.model?.playgroundInputType || 'datetime';
      const presentation =
        this.args.model?.playgroundPresentation || 'standard';

      return `@field playground = contains(DateTimeField, {
  configuration: function(this: YourCard) {
    return {
      inputType: '${inputType}',
      presentation: '${presentation}',
      placeholder: 'Try editing this field!'
    };
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

        {{! ³⁰ Playground Section }}
        <section class='playground-section'>
          <div class='playground-header'>
            <h2>Interactive Playground</h2>
            <p>Experiment with different configurations! Change the input type
              and presentation mode to see how the field behaves.</p>
          </div>

          {{! Configuration Controls }}
          <div class='playground-controls'>
            <div class='control-group'>
              <label class='control-label'>Input Type</label>
              <BoxelSelect
                @selected={{this.selectedInputType}}
                @options={{this.inputTypeOptions}}
                @onChange={{this.updateInputType}}
                @placeholder='Select input type'
                class='config-select'
                data-test-input-type-select
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
                <@fields.playground @format='edit' />
              </div>
            </div>
            <div class='playground-divider'></div>
            <div class='playground-column'>
              <h3>Display</h3>
              <p class='playground-hint'>See how it renders</p>
              <div class='playground-demo'>
                {{! Delegated rendering - configuration comes from field definition function }}
                <@fields.playground @format='embedded' />
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
          {{! ⁵² Compatibility info banner }}
          <div
            class='playground-info {{unless this.isValidCombination "warning"}}'
          >
            <svg
              class='info-icon'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='2'
            >
              {{#if this.isValidCombination}}
                <circle cx='12' cy='12' r='10'></circle>
                <line x1='12' y1='16' x2='12' y2='12'></line>
                <line x1='12' y1='8' x2='12.01' y2='8'></line>
              {{else}}
                <path
                  d='M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z'
                ></path>
                <line x1='12' y1='9' x2='12' y2='13'></line>
                <line x1='12' y1='17' x2='12.01' y2='17'></line>
              {{/if}}
            </svg>
            {{#if this.isValidCombination}}
              <span>Try different
                <code>inputType</code>
                and
                <code>presentation</code>
                combinations - only compatible options are shown!</span>
            {{else}}
              <span>⚠️ This combination was reset to
                <code>standard</code>
                - presentation was incompatible with the selected input type</span>
            {{/if}}
          </div>
        </section>

        {{! ³⁰ Basic Date & Time Section }}
        <section class='input-section'>
          <div class='section-header-inline'>
            <h2>Basic Date & Time</h2>
            <p>Single date, time, or combined inputs</p>
          </div>
          <div class='components-grid'>
            <div class='component-card'>
              <div class='component-info'>
                <h3>Date</h3>
                <p>Single date selection</p>
                <code class='config'>inputType: 'date'</code>
                <span class='use-case'>Appointments • Deadlines • Events</span>
              </div>
              <div class='component-demo'>
                <@fields.appointmentDate @format='edit' />
              </div>
            </div>

            <div class='component-card'>
              <div class='component-info'>
                <h3>Time (12h)</h3>
                <p>AM/PM time input</p>
                <code class='config'>inputType: 'time', timeFormat: '12h'</code>
                <span class='use-case'>Meetings • Reminders • Schedules</span>
              </div>
              <div class='component-demo'>
                <@fields.meetingTime @format='edit' />
              </div>
            </div>

            <div class='component-card'>
              <div class='component-info'>
                <h3>DateTime</h3>
                <p>Combined date and time</p>
                <code class='config'>inputType: 'datetime'</code>
                <span class='use-case'>Events • Bookings • Timestamps</span>
              </div>
              <div class='component-demo'>
                <@fields.eventDateTime @format='edit' />
              </div>
            </div>
          </div>
        </section>

        {{! ³¹ Range Inputs Section }}
        <section class='input-section'>
          <div class='section-header-inline'>
            <h2>Range Inputs</h2>
            <p>Start and end selections</p>
          </div>
          <div class='components-grid-half'>
            <div class='component-card'>
              <div class='component-info'>
                <h3>Date Range</h3>
                <p>Start → End dates</p>
                <code class='config'>inputType: 'date-range'</code>
                <span class='use-case'>Campaigns • Projects • Vacations</span>
              </div>
              <div class='component-demo'>
                <@fields.campaignPeriod @format='edit' />
              </div>
            </div>

            <div class='component-card'>
              <div class='component-info'>
                <h3>Time Range</h3>
                <p>Working hours (24h)</p>
                <code class='config'>inputType: 'time-range', timeFormat: '24h'</code>
                <span class='use-case'>Shifts • Operating Hours • Availability</span>
              </div>
              <div class='component-demo'>
                <@fields.workingHours @format='edit' />
              </div>
            </div>
          </div>
        </section>

        {{! ³² Duration Section }}
        <section class='input-section'>
          <div class='section-header-inline'>
            <h2>Duration</h2>
            <p>Time spans and periods</p>
          </div>
          <div class='components-grid-single'>
            <div class='component-card'>
              <div class='component-info'>
                <h3>Duration</h3>
                <p>Hours:Minutes:Seconds</p>
                <code class='config'>inputType: 'duration'</code>
                <span class='use-case'>Tasks • Videos • Timers • Workouts</span>
              </div>
              <div class='component-demo'>
                <@fields.taskDuration @format='edit' />
              </div>
            </div>
          </div>
        </section>

        {{! ³³ Partial Date Inputs Section }}
        <section class='input-section'>
          <div class='section-header-inline'>
            <h2>Partial Date Inputs</h2>
            <p>Granular date component selection</p>
          </div>
          <div class='components-grid'>
            <div class='component-card'>
              <div class='component-info'>
                <h3>Birthday</h3>
                <p>Month + Day only</p>
                <code class='config'>inputType: 'month-day'</code>
              </div>
              <div class='component-demo'>
                <@fields.birthday @format='edit' />
              </div>
            </div>

            <div class='component-card'>
              <div class='component-info'>
                <h3>Year</h3>
                <p>Year-only</p>
                <code class='config'>inputType: 'year'</code>
              </div>
              <div class='component-demo'>
                <@fields.fiscalYear @format='edit' />
              </div>
            </div>

            <div class='component-card'>
              <div class='component-info'>
                <h3>Month</h3>
                <p>Month-only</p>
                <code class='config'>inputType: 'month'</code>
              </div>
              <div class='component-demo'>
                <@fields.billingMonth @format='edit' />
              </div>
            </div>

            <div class='component-card'>
              <div class='component-info'>
                <h3>Month-Year</h3>
                <p>Combined selection</p>
                <code class='config'>inputType: 'month-year'</code>
              </div>
              <div class='component-demo'>
                <@fields.payPeriod @format='edit' />
              </div>
            </div>

            <div class='component-card'>
              <div class='component-info'>
                <h3>Week</h3>
                <p>ISO week</p>
                <code class='config'>inputType: 'week'</code>
              </div>
              <div class='component-demo'>
                <@fields.workWeek @format='edit' />
              </div>
            </div>

            <div class='component-card'>
              <div class='component-info'>
                <h3>Quarter</h3>
                <p>Q1-Q4 + Year</p>
                <code class='config'>inputType: 'quarter'</code>
              </div>
              <div class='component-demo'>
                <@fields.financialQuarter @format='edit' />
              </div>
            </div>
          </div>
        </section>

        {{! ³⁴ Relative Time Section }}
        <section class='input-section'>
          <div class='section-header-inline'>
            <h2>Relative Time</h2>
            <p>Human-friendly time expressions</p>
          </div>
          <div class='components-grid-single'>
            <div class='component-card'>
              <div class='component-info'>
                <h3>Relative Time</h3>
                <p>"In 2 hours", "In 3 days"</p>
                <code class='config'>inputType: 'relative'</code>
                <span class='use-case'>Publish Later • Reminders • Delays</span>
              </div>
              <div class='component-demo'>
                <@fields.publishIn @format='edit' />
              </div>
            </div>
          </div>
        </section>

        {{! ⁶⁷ Recurring Pattern Section }}
        <section class='input-section'>
          <div class='section-header-inline'>
            <h2>Recurring Pattern</h2>
            <p>Event recurrence selector</p>
          </div>
          <div class='components-grid-single'>
            <div class='component-card'>
              <div class='component-info'>
                <h3>Recurring Pattern</h3>
                <p>Daily, weekly, monthly, etc.</p>
                <code class='config'>inputType: 'recurring'</code>
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
          <p>All powered by DateTimeField with presentation configuration -
            auto-updating, interactive, and calculated displays</p>
        </header>

        <div class='components-grid'>
          <div class='component-card'>
            <div class='component-info'>
              <h3>Countdown Timer</h3>
              <p>Live countdown with controls</p>
              <span class='use-case'>Launches • Deadlines • Events</span>
            </div>
            <div class='component-demo'>
              <@fields.productLaunchCountdown @format='embedded' />
            </div>
          </div>

          <div class='component-card'>
            <div class='component-info'>
              <h3>Time Ago Display</h3>
              <p>Auto-updating relative timestamps</p>
              <span class='use-case'>Social • Activity Feeds • Logs</span>
            </div>
            <div class='component-demo'>
              <@fields.lastActivityTime @format='embedded' />
            </div>
          </div>

          <div class='component-card'>
            <div class='component-info'>
              <h3>Timeline Event</h3>
              <p>Status-tracked timeline entries</p>
              <span class='use-case'>Order Tracking • Process Flows</span>
            </div>
            <div class='component-demo'>
              <@fields.orderPlaced @format='embedded' />
            </div>
          </div>

          <div class='component-card'>
            <div class='component-info'>
              <h3>Age Calculator</h3>
              <p>Auto-calculated age from birthdate</p>
              <span class='use-case'>HR • CRM • Healthcare</span>
            </div>
            <div class='component-demo'>
              <@fields.employeeAge @format='embedded' />
            </div>
          </div>

          <div class='component-card'>
            <div class='component-info'>
              <h3>Business Days</h3>
              <p>Working days vs calendar days</p>
              <span class='use-case'>Delivery • SLA • Project Planning</span>
            </div>
            <div class='component-demo'>
              <@fields.deliveryCalculation @format='embedded' />
            </div>
          </div>

          <div class='component-card'>
            <div class='component-info'>
              <h3>Time Slot Picker</h3>
              <p>Visual appointment booking</p>
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
