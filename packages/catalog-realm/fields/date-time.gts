// ═══ [EDIT TRACKING: ON] Mark all changes with ⁿ ═══
import {
  FieldDef,
  Component,
  field,
  contains,
} from 'https://cardstack.com/base/card-api'; // ¹ Core imports
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { fn, array, concat } from '@ember/helper';
import { add, lt, eq, gt, and, not } from '@cardstack/boxel-ui/helpers'; // ² Helper imports
import { BoxelSelect, DateRangePicker } from '@cardstack/boxel-ui/components'; // ³ BoxelSelect and DateRangePicker components
import CalendarIcon from '@cardstack/boxel-icons/calendar'; // ⁴ Calendar icon
import ClockIcon from '@cardstack/boxel-icons/clock'; // ⁵ Clock icon
import CalendarEventIcon from '@cardstack/boxel-icons/calendar-event'; // ⁶ Calendar event icon
import CalendarStatsIcon from '@cardstack/boxel-icons/calendar-stats'; // ⁷ Calendar stats icon
import ChevronDownIcon from '@cardstack/boxel-icons/chevron-down'; // ⁸ Chevron down icon
import GiftIcon from '@cardstack/boxel-icons/gift'; // ⁹ Gift icon
import HourglassIcon from '@cardstack/boxel-icons/hourglass'; // ¹⁰ Timer/hourglass icon

// ¹¹ Type Definitions for Configuration System

// Input types - what the user enters
type InputType =
  | 'date' // Single date (YYYY-MM-DD)
  | 'time' // Time only (HH:MM)
  | 'datetime' // Date and time (YYYY-MM-DDTHH:MM)
  | 'date-range' // Start and end dates
  | 'time-range' // Start and end times
  | 'duration' // Hours:Minutes:Seconds
  | 'month-day' // Birthday (MM-DD, no year)
  | 'year' // Year only (YYYY)
  | 'month' // Month only (MM)
  | 'month-year' // Month and year (YYYY-MM)
  | 'week' // ISO week (YYYY-Www)
  | 'quarter' // Quarter (Q1-Q4 YYYY)
  | 'relative' // Relative time (2 hours, 3 days)
  | 'recurring'; // ⁵³ Recurring pattern selector (daily, weekly, monthly, etc.)

// Presentation types - how to display the data
type PresentationType =
  | 'standard' // Default display
  | 'countdown' // Live countdown timer
  | 'timeAgo' // "2 hours ago" relative display
  | 'age' // Calculate age from birthdate
  | 'businessDays' // Business days calculation
  | 'timeline' // Timeline event display
  | 'timeSlots' // Visual time slot picker
  | 'expirationWarning'; // Expiration alert

type TimeFormat = '12h' | '24h';
type QuarterValue = 'Q1' | 'Q2' | 'Q3' | 'Q4';

// ¹² Unified configuration interface
interface DateTimeConfiguration {
  // Input settings
  inputType?: InputType;
  timeFormat?: TimeFormat;
  placeholder?: string;
  minDate?: string;
  maxDate?: string;

  // Presentation settings
  presentation?: PresentationType;

  // Countdown-specific options
  countdownOptions?: {
    label?: string;
    showControls?: boolean;
  };

  // Time ago-specific options
  timeAgoOptions?: {
    eventLabel?: string;
    updateInterval?: number; // milliseconds
  };

  // Age-specific options
  ageOptions?: {
    showNextBirthday?: boolean;
  };

  // Timeline-specific options
  timelineOptions?: {
    eventName?: string;
    status?: 'complete' | 'active' | 'pending';
  };

  // Time slots-specific options
  timeSlotsOptions?: {
    availableSlots?: string[];
  };

  // Expiration warning-specific options
  expirationOptions?: {
    itemName?: string;
  };

  // Availability grid-specific options
  availabilityOptions?: {
    availabilityData?: string; // JSON string
  };

  // Legacy support (deprecated, use inputType instead)
  format?: InputType;
  industry?: string; // For documentation/grouping
}

// ⁵ Value types for different formats
interface DateRangeValue {
  start: string;
  end: string;
}

interface TimeRangeValue {
  start: string;
  end: string;
}

interface DurationValue {
  hours: number;
  minutes: number;
  seconds: number;
}

interface MonthDayValue {
  month: string;
  day: string;
}

interface QuarterYearValue {
  quarter: QuarterValue;
  year: string;
}

interface RelativeTimeValue {
  amount: number;
  unit: 'minutes' | 'hours' | 'days' | 'weeks' | 'months';
}

// ⁷⁸ Enhanced recurring pattern value with full recurrence support
interface RecurringValue {
  pattern:
    | 'none'
    | 'daily'
    | 'weekdays'
    | 'weekly'
    | 'biweekly'
    | 'monthly'
    | 'yearly'
    | 'custom';
  // When recurrence starts
  startDate?: string;
  // When recurrence ends (optional - if null, recurs indefinitely)
  endDate?: string | null;
  // Or end after N occurrences (mutually exclusive with endDate)
  occurrences?: number | null;
  // Interval: every N days/weeks/months (e.g., 2 for biweekly)
  interval?: number;
  // For weekly: which days [0=Sun, 1=Mon, ..., 6=Sat]
  daysOfWeek?: number[];
  // For monthly: day of month (1-31)
  dayOfMonth?: number;
  // For yearly: month (1-12)
  monthOfYear?: number;
  // iCal RRULE for advanced custom patterns
  customRule?: string;
}

// ¹³ Main Unified DateTimeField - handles all date/time inputs and presentations
export class DateTimeField extends FieldDef {
  static displayName = 'Date & Time';
  static icon = CalendarIcon;

  // ¹⁴ Core data storage - value stored as string or JSON
  @field value = contains(StringField);

  // ¹⁵ Helper method to format date display
  static formatDate(dateStr: string, inputType: InputType = 'date'): string {
    if (!dateStr) return '';

    try {
      // ⁹² Handle time-only values (HH:MM format)
      if (inputType === 'time') {
        // Time values are stored as "HH:MM" (24-hour format)
        const [hours, minutes] = dateStr.split(':').map(Number);
        if (isNaN(hours) || isNaN(minutes)) return dateStr;

        // Convert to 12-hour format with AM/PM
        const period = hours >= 12 ? 'PM' : 'AM';
        const displayHours = hours % 12 || 12; // Convert 0 to 12 for midnight
        const displayMinutes = minutes.toString().padStart(2, '0');

        return `${displayHours}:${displayMinutes} ${period}`;
      }

      const date = new Date(dateStr);

      switch (inputType) {
        case 'date':
          return date.toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          });
        case 'datetime':
          return date.toLocaleString('en-US', {
            weekday: 'short',
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
          });
        case 'month-year':
          return date.toLocaleDateString('en-US', {
            month: 'long',
            year: 'numeric',
          });
        default:
          return dateStr;
      }
    } catch {
      return dateStr;
    }
  }

  // ⁹ Embedded format - routes to presentation or displays value
  static embedded = class Embedded extends Component<typeof this> {
    get config(): DateTimeConfiguration | undefined {
      return this.args.configuration as DateTimeConfiguration | undefined;
    }

    get inputType(): InputType {
      return this.config?.inputType ?? this.config?.format ?? 'date';
    }

    get presentation(): PresentationType {
      return this.config?.presentation ?? 'standard';
    }

    get displayValue() {
      const value = this.args.model?.value;

      if (!value) return this.config?.placeholder ?? 'Not set';

      // Handle complex values
      if (this.inputType === 'date-range' || this.inputType === 'time-range') {
        try {
          const parsed = JSON.parse(value);
          return `${parsed.start} → ${parsed.end}`;
        } catch {
          return value;
        }
      }

      if (this.inputType === 'duration') {
        try {
          const parsed = JSON.parse(value);
          return `${parsed.hours}h ${parsed.minutes}m ${parsed.seconds}s`;
        } catch {
          return value;
        }
      }

      if (this.inputType === 'month-day') {
        try {
          const parsed = JSON.parse(value);
          const months = [
            'Jan',
            'Feb',
            'Mar',
            'Apr',
            'May',
            'Jun',
            'Jul',
            'Aug',
            'Sep',
            'Oct',
            'Nov',
            'Dec',
          ];
          return `${months[parseInt(parsed.month) - 1]} ${parseInt(
            parsed.day,
          )}`;
        } catch {
          return value;
        }
      }

      if (this.inputType === 'quarter') {
        try {
          const parsed = JSON.parse(value);
          return `${parsed.quarter} ${parsed.year}`;
        } catch {
          return value;
        }
      }

      if (this.inputType === 'relative') {
        try {
          const parsed = JSON.parse(value);
          return `In ${parsed.amount} ${parsed.unit}`;
        } catch {
          return value;
        }
      }

      if (this.inputType === 'recurring') {
        // ⁷⁹ Enhanced recurring pattern display with full details
        try {
          const parsed = JSON.parse(value) as RecurringValue;
          const patternLabels = {
            none: 'Does not repeat',
            daily: 'Daily',
            weekdays: 'Every weekday (Mon-Fri)',
            weekly: 'Weekly',
            biweekly: 'Every 2 weeks',
            monthly: 'Monthly',
            yearly: 'Yearly',
            custom: 'Custom recurrence',
          };

          let display =
            patternLabels[parsed.pattern as keyof typeof patternLabels] ||
            parsed.pattern;

          // Add interval if specified
          if (parsed.interval && parsed.interval > 1) {
            display = `Every ${parsed.interval} ${
              parsed.pattern === 'weekly'
                ? 'weeks'
                : parsed.pattern === 'monthly'
                ? 'months'
                : 'days'
            }`;
          }

          // Add end condition
          if (parsed.endDate) {
            display += ` until ${new Date(parsed.endDate).toLocaleDateString(
              'en-US',
              { month: 'short', day: 'numeric', year: 'numeric' },
            )}`;
          } else if (parsed.occurrences) {
            display += ` (${parsed.occurrences} times)`;
          }

          return display;
        } catch {
          return value;
        }
      }

      return DateTimeField.formatDate(value, this.inputType);
    }

    <template>
      {{#if (eq this.presentation 'countdown')}}
        <CountdownPresentation @model={{@model}} @config={{this.config}} />
      {{else if (eq this.presentation 'timeAgo')}}
        <TimeAgoPresentation @model={{@model}} @config={{this.config}} />
      {{else if (eq this.presentation 'age')}}
        <AgePresentation @model={{@model}} @config={{this.config}} />
      {{else if (eq this.presentation 'businessDays')}}
        <BusinessDaysPresentation @model={{@model}} @config={{this.config}} />
      {{else if (eq this.presentation 'timeline')}}
        <TimelinePresentation @model={{@model}} @config={{this.config}} />
      {{else if (eq this.presentation 'timeSlots')}}
        <TimeSlotsPresentation @model={{@model}} @config={{this.config}} />
      {{else if (eq this.presentation 'expirationWarning')}}
        <ExpirationWarningPresentation
          @model={{@model}}
          @config={{this.config}}
        />
      {{else}}
        {{! Standard presentation - just show the value }}
        <div class='datetime-embedded' data-test-datetime-embedded>
          <span class='datetime-value'>{{this.displayValue}}</span>
        </div>
      {{/if}}

      <style scoped>
        .datetime-embedded {
          display: flex;
          align-items: center;
          padding: 0.5rem;
          font-size: 0.875rem;
          color: var(--foreground, #1a1a1a);
        }

        .datetime-value {
          font-weight: 500;
        }
      </style>
    </template>
  };

  // ¹⁰ Atom format - compact display
  static atom = class Atom extends Component<typeof this> {
    get config(): DateTimeConfiguration | undefined {
      return this.args.configuration as DateTimeConfiguration | undefined;
    }

    get inputType(): InputType {
      return this.config?.inputType ?? this.config?.format ?? 'date';
    }

    get displayValue() {
      const value = this.args.model?.value;

      if (!value) return this.config?.placeholder ?? 'Not set';

      return DateTimeField.formatDate(value, this.inputType);
    }

    get icon() {
      switch (this.inputType) {
        case 'time':
        case 'time-range':
          return ClockIcon;
        case 'duration':
          return HourglassIcon;
        case 'month-day':
          return GiftIcon;
        case 'week':
        case 'month':
        case 'month-year':
        case 'year':
          return CalendarEventIcon;
        case 'date-range':
          return CalendarStatsIcon;
        default:
          return CalendarIcon;
      }
    }

    <template>
      <span class='datetime-atom' data-test-datetime-atom>
        <this.icon class='datetime-icon' />
        <span class='datetime-value'>{{this.displayValue}}</span>
      </span>

      <style scoped>
        .datetime-atom {
          display: inline-flex;
          align-items: center;
          gap: 0.375rem;
          padding: 0.25rem 0.5rem;
          background: var(--primary, #3b82f6);
          color: var(--primary-foreground, #ffffff);
          border-radius: var(--radius, 0.375rem);
          font-size: 0.8125rem;
          font-weight: 500;
        }

        .datetime-icon {
          width: 0.875rem;
          height: 0.875rem;
          flex-shrink: 0;
        }

        .datetime-value {
          white-space: nowrap;
        }
      </style>
    </template>
  };

  // ¹¹ Edit format - routes to appropriate input based on configuration
  static edit = class Edit extends Component<typeof this> {
    get config(): DateTimeConfiguration | undefined {
      return this.args.configuration as DateTimeConfiguration | undefined;
    }

    get inputType(): InputType {
      return this.config?.inputType ?? this.config?.format ?? 'date';
    }

    get timeFormat(): TimeFormat {
      return this.config?.timeFormat ?? '12h';
    }

    get placeholder(): string {
      return this.config?.placeholder ?? this.defaultPlaceholder;
    }

    get defaultPlaceholder(): string {
      switch (this.inputType) {
        case 'date':
          return 'Select date';
        case 'time':
          return 'Select time';
        case 'datetime':
          return 'Select date and time';
        case 'date-range':
          return 'Select date range';
        case 'time-range':
          return 'Select time range';
        case 'duration':
          return 'Enter duration';
        case 'month-day':
          return 'Select birthday';
        case 'year':
          return 'Select year';
        case 'month':
          return 'Select month';
        case 'month-year':
          return 'Select month and year';
        case 'week':
          return 'Select week';
        case 'quarter':
          return 'Select quarter';
        case 'relative':
          return 'Enter relative time';
        case 'recurring': // ⁵⁶ Recurring pattern placeholder
          return 'Select repeat pattern';
        default:
          return 'Enter value';
      }
    }

    <template>
      <div class='datetime-edit' data-test-datetime-edit>
        {{#if (eq this.inputType 'date')}}
          <DateInput @model={{@model}} @placeholder={{this.placeholder}} />
        {{else if (eq this.inputType 'time')}}
          <TimeInput
            @model={{@model}}
            @placeholder={{this.placeholder}}
            @format={{this.timeFormat}}
          />
        {{else if (eq this.inputType 'datetime')}}
          <DateTimeInput @model={{@model}} @placeholder={{this.placeholder}} />
        {{else if (eq this.inputType 'date-range')}}
          <DateRangeInput @model={{@model}} @placeholder={{this.placeholder}} />
        {{else if (eq this.inputType 'time-range')}}
          <TimeRangeInput
            @model={{@model}}
            @placeholder={{this.placeholder}}
            @format={{this.timeFormat}}
          />
        {{else if (eq this.inputType 'duration')}}
          <DurationInput @model={{@model}} @placeholder={{this.placeholder}} />
        {{else if (eq this.inputType 'month-day')}}
          <MonthDayInput @model={{@model}} @placeholder={{this.placeholder}} />
        {{else if (eq this.inputType 'year')}}
          <YearInput @model={{@model}} @placeholder={{this.placeholder}} />
        {{else if (eq this.inputType 'month')}}
          <MonthInput @model={{@model}} @placeholder={{this.placeholder}} />
        {{else if (eq this.inputType 'month-year')}}
          <MonthYearInput @model={{@model}} @placeholder={{this.placeholder}} />
        {{else if (eq this.inputType 'week')}}
          <WeekInput @model={{@model}} @placeholder={{this.placeholder}} />
        {{else if (eq this.inputType 'quarter')}}
          <QuarterInput @model={{@model}} @placeholder={{this.placeholder}} />
        {{else if (eq this.inputType 'relative')}}
          <RelativeTimeInput
            @model={{@model}}
            @placeholder={{this.placeholder}}
          />
        {{else if (eq this.inputType 'recurring')}}
          <RecurringInput @model={{@model}} @placeholder={{this.placeholder}} />
        {{else}}
          <DateInput @model={{@model}} @placeholder={{this.placeholder}} />
        {{/if}}
      </div>

      <style scoped>
        .datetime-edit {
          width: 100%;
        }
      </style>
    </template>
  };
}

// ¹² Date Input Component
class DateInput extends Component {
  @action
  updateValue(event: Event) {
    const target = event.target as HTMLInputElement;
    this.args.model.value = target.value;
  }

  <template>
    <div class='input-wrapper'>
      <div class='input-icon'>
        <CalendarIcon class='icon' />
      </div>
      <input
        type='date'
        value={{@model.value}}
        placeholder={{@placeholder}}
        {{on 'change' this.updateValue}}
        class='datetime-input'
        data-test-date-input
      />
    </div>

    <style scoped>
      .input-wrapper {
        position: relative;
        width: 100%;
      }

      .input-icon {
        position: absolute;
        left: 0.75rem;
        top: 50%;
        transform: translateY(-50%);
        pointer-events: none;
        display: flex;
        align-items: center;
        color: var(--muted-foreground, #9ca3af);
      }

      .icon {
        width: 1.25rem;
        height: 1.25rem;
      }

      .datetime-input {
        width: 100%;
        padding: 0.5rem 0.75rem 0.5rem 2.5rem;
        border: 1px solid var(--border, #e0e0e0);
        border-radius: var(--radius, 0.375rem);
        font-family: var(--font-sans, system-ui, sans-serif);
        font-size: 0.875rem;
        color: var(--foreground, #1a1a1a);
        background: var(--input, #ffffff);
        transition: all 0.15s ease;
      }

      .datetime-input:focus {
        outline: none;
        border-color: var(--ring, #3b82f6);
        box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
      }

      .datetime-input::placeholder {
        color: var(--muted-foreground, #9ca3af);
      }
    </style>
  </template>
}

// ²⁵ PRESENTATION COMPONENTS - For use with DateTimeField presentation configuration

// ²⁶ Countdown Presentation Component (converted from CountdownTimerField)
class CountdownPresentation extends Component {
  @tracked currentTime = Date.now();
  @tracked isRunning = true;
  private intervalId: number | null = null;

  constructor(owner: unknown, args: any) {
    super(owner, args);
    this.startTimer();
  }

  willDestroy() {
    super.willDestroy();
    this.stopTimer();
  }

  startTimer() {
    if (this.intervalId) return;
    this.intervalId = window.setInterval(() => {
      if (this.isRunning) {
        this.currentTime = Date.now();
      }
    }, 1000);
  }

  stopTimer() {
    if (this.intervalId) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  @action
  toggleTimer() {
    this.isRunning = !this.isRunning;
  }

  @action
  resetTimer() {
    this.currentTime = Date.now();
    this.isRunning = true;
  }

  get config(): DateTimeConfiguration | undefined {
    return this.args.config as DateTimeConfiguration | undefined;
  }

  get targetDate() {
    return this.args.model?.value;
  }

  get label() {
    return this.config?.countdownOptions?.label || '';
  }

  get showControls() {
    return this.config?.countdownOptions?.showControls ?? true;
  }

  get timeRemaining() {
    const target = this.targetDate;
    if (!target)
      return {
        days: 0,
        hours: 0,
        minutes: 0,
        seconds: 0,
        expired: true,
      };

    const targetTime = new Date(target).getTime();
    const remaining = Math.max(0, targetTime - this.currentTime);

    if (remaining === 0) {
      return {
        days: 0,
        hours: 0,
        minutes: 0,
        seconds: 0,
        expired: true,
      };
    }

    return {
      days: Math.floor(remaining / (1000 * 60 * 60 * 24)),
      hours: Math.floor((remaining % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)),
      minutes: Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60)),
      seconds: Math.floor((remaining % (1000 * 60)) / 1000),
      expired: false,
    };
  }

  get formattedTime() {
    const { days, hours, minutes, seconds, expired } = this.timeRemaining;
    if (expired) return 'Expired';

    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    parts.push(`${String(hours).padStart(2, '0')}h`);
    parts.push(`${String(minutes).padStart(2, '0')}m`);
    parts.push(`${String(seconds).padStart(2, '0')}s`);

    return parts.join(' ');
  }

  <template>
    <div class='countdown-wrapper' data-test-countdown>
      {{#if this.label}}
        <div class='countdown-label'>{{this.label}}</div>
      {{/if}}
      <div
        class='countdown-display {{if this.timeRemaining.expired "expired" ""}}'
      >
        <div class='countdown-time'>{{this.formattedTime}}</div>
        {{#if (and (not this.timeRemaining.expired) this.showControls)}}
          <div class='countdown-controls'>
            <button
              type='button'
              {{on 'click' this.toggleTimer}}
              class='countdown-btn'
              data-test-countdown-toggle
            >
              {{#if this.isRunning}}
                Pause
              {{else}}
                Resume
              {{/if}}
            </button>
            <button
              type='button'
              {{on 'click' this.resetTimer}}
              class='countdown-btn'
              data-test-countdown-reset
            >
              Reset
            </button>
          </div>
        {{/if}}
      </div>
    </div>

    <style scoped>
      .countdown-wrapper {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }

      .countdown-label {
        font-size: 0.875rem;
        font-weight: 600;
        color: var(--foreground, #1a1a1a);
      }

      .countdown-display {
        background: linear-gradient(
          135deg,
          var(--primary, #3b82f6) 0%,
          var(--accent, #60a5fa) 100%
        );
        padding: 1.5rem;
        border-radius: var(--radius, 0.5rem);
        box-shadow: var(--shadow-md, 0 4px 6px -1px rgb(0 0 0 / 0.1));
      }

      .countdown-display.expired {
        background: linear-gradient(
          135deg,
          var(--muted, #6b7280) 0%,
          var(--muted-foreground, #9ca3af) 100%
        );
      }

      .countdown-time {
        font-size: 2rem;
        font-weight: 700;
        font-family: var(--font-mono, monospace);
        color: var(--primary-foreground, #ffffff);
        text-align: center;
        margin-bottom: 0.75rem;
      }

      .countdown-controls {
        display: flex;
        gap: 0.5rem;
        justify-content: center;
      }

      .countdown-btn {
        padding: 0.375rem 0.75rem;
        font-size: 0.8125rem;
        font-weight: 500;
        color: var(--primary, #3b82f6);
        background: var(--primary-foreground, #ffffff);
        border: none;
        border-radius: var(--radius, 0.375rem);
        cursor: pointer;
        transition: all 0.15s ease;
      }

      .countdown-btn:hover {
        background: var(--accent-foreground, #f0f9ff);
      }

      .countdown-btn:active {
        transform: scale(0.98);
      }
    </style>
  </template>
}

// ²⁷ TimeAgo Presentation Component (converted from RelativeTimeDisplayField)
class TimeAgoPresentation extends Component {
  @tracked currentTime = Date.now();
  private intervalId: number | null = null;

  constructor(owner: unknown, args: any) {
    super(owner, args);
    this.intervalId = window.setInterval(() => {
      this.currentTime = Date.now();
    }, 60000); // Update every minute
  }

  willDestroy() {
    super.willDestroy();
    if (this.intervalId) {
      window.clearInterval(this.intervalId);
    }
  }

  get config(): DateTimeConfiguration | undefined {
    return this.args.config as DateTimeConfiguration | undefined;
  }

  get timestamp() {
    return this.args.model?.value;
  }

  get eventLabel() {
    return this.config?.timeAgoOptions?.eventLabel || 'Activity';
  }

  get relativeTime() {
    if (!this.timestamp) return 'Unknown time';

    const past = new Date(this.timestamp).getTime();
    const diff = this.currentTime - past;

    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    const weeks = Math.floor(days / 7);
    const months = Math.floor(days / 30);
    const years = Math.floor(days / 365);

    if (seconds < 60) return 'just now';
    if (minutes < 60) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
    if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    if (days < 7) return `${days} day${days > 1 ? 's' : ''} ago`;
    if (weeks < 4) return `${weeks} week${weeks > 1 ? 's' : ''} ago`;
    if (months < 12) return `${months} month${months > 1 ? 's' : ''} ago`;
    return `${years} year${years > 1 ? 's' : ''} ago`;
  }

  <template>
    <div class='relative-time-item' data-test-relative-time>
      <div class='relative-time-icon'>
        <ClockIcon class='icon' />
      </div>
      <div class='relative-time-content'>
        <div class='relative-time-label'>{{this.eventLabel}}</div>
        <div class='relative-time-ago'>{{this.relativeTime}}</div>
      </div>
    </div>

    <style scoped>
      .relative-time-item {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.75rem;
        background: var(--muted, #f5f5f5);
        border-radius: var(--radius, 0.375rem);
      }

      .relative-time-icon {
        flex-shrink: 0;
        width: 2.5rem;
        height: 2.5rem;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--background, #ffffff);
        border-radius: var(--radius, 0.375rem);
        color: var(--muted-foreground, #9ca3af);
      }

      .icon {
        width: 1.25rem;
        height: 1.25rem;
      }

      .relative-time-content {
        flex: 1;
        min-width: 0;
      }

      .relative-time-label {
        font-size: 0.875rem;
        font-weight: 500;
        color: var(--foreground, #1a1a1a);
        margin-bottom: 0.125rem;
      }

      .relative-time-ago {
        font-size: 0.75rem;
        color: var(--muted-foreground, #9ca3af);
      }
    </style>
  </template>
}

// ²⁸ Stub Presentation Components (to be fully implemented)

class AgePresentation extends Component {
  get config(): DateTimeConfiguration | undefined {
    return this.args.config as DateTimeConfiguration | undefined;
  }

  get birthDate() {
    return this.args.model?.value;
  }

  get showNextBirthday() {
    return this.config?.ageOptions?.showNextBirthday ?? true;
  }

  get age() {
    if (!this.birthDate) return null;

    try {
      const birth = new Date(this.birthDate);
      const today = new Date();
      let age = today.getFullYear() - birth.getFullYear();
      const monthDiff = today.getMonth() - birth.getMonth();

      if (
        monthDiff < 0 ||
        (monthDiff === 0 && today.getDate() < birth.getDate())
      ) {
        age--;
      }

      return age;
    } catch {
      return null;
    }
  }

  get nextBirthday() {
    if (!this.birthDate) return null;

    try {
      const birth = new Date(this.birthDate);
      const today = new Date();
      const nextBday = new Date(
        today.getFullYear(),
        birth.getMonth(),
        birth.getDate(),
      );

      if (nextBday < today) {
        nextBday.setFullYear(today.getFullYear() + 1);
      }

      const diff = nextBday.getTime() - today.getTime();
      const days = Math.ceil(diff / (1000 * 60 * 60 * 24));

      return days;
    } catch {
      return null;
    }
  }

  get birthDateDisplay() {
    if (!this.birthDate) return '';

    try {
      return new Date(this.birthDate).toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      });
    } catch {
      return '';
    }
  }

  <template>
    <div class='age-calculator' data-test-age-calculator>
      {{#if this.age}}
        <div class='age-display'>
          <div class='age-value'>{{this.age}} years old</div>
          <div class='age-meta'>
            Born
            {{this.birthDateDisplay}}
            {{#if (and this.nextBirthday this.showNextBirthday)}}
              • Next birthday in
              {{this.nextBirthday}}
              days
            {{/if}}
          </div>
        </div>
      {{else}}
        <div class='age-placeholder'>No birth date set</div>
      {{/if}}
    </div>

    <style scoped>
      .age-calculator {
        padding: 0.75rem;
        background: linear-gradient(
          135deg,
          rgba(59, 130, 246, 0.1),
          rgba(147, 197, 253, 0.1)
        );
        border: 1px solid rgba(59, 130, 246, 0.2);
        border-radius: var(--radius, 0.375rem);
      }

      .age-display {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
      }

      .age-value {
        font-size: 1.125rem;
        font-weight: 700;
        color: var(--primary, #3b82f6);
      }

      .age-meta {
        font-size: 0.75rem;
        color: var(--muted-foreground, #9ca3af);
      }

      .age-placeholder {
        font-size: 0.875rem;
        color: var(--muted-foreground, #9ca3af);
        font-style: italic;
      }
    </style>
  </template>
}

class BusinessDaysPresentation extends Component {
  get config(): DateTimeConfiguration | undefined {
    return this.args.config as DateTimeConfiguration | undefined;
  }

  get value() {
    // Expecting JSON: {start: "date", end: "date"}
    try {
      const val = this.args.model?.value;
      if (!val) return null;
      return JSON.parse(val);
    } catch {
      return null;
    }
  }

  get calendarDays() {
    if (!this.value?.start || !this.value?.end) return 0;

    try {
      const startTime = new Date(this.value.start).getTime();
      const endTime = new Date(this.value.end).getTime();
      return Math.ceil((endTime - startTime) / (1000 * 60 * 60 * 24));
    } catch {
      return 0;
    }
  }

  get businessDays() {
    if (!this.value?.start || !this.value?.end) return 0;

    try {
      const startDate = new Date(this.value.start);
      const endDate = new Date(this.value.end);
      let count = 0;
      const current = new Date(startDate);

      while (current <= endDate) {
        const dayOfWeek = current.getDay();
        if (dayOfWeek !== 0 && dayOfWeek !== 6) {
          count++;
        }
        current.setDate(current.getDate() + 1);
      }

      return count;
    } catch {
      return 0;
    }
  }

  get startDisplay() {
    if (!this.value?.start) return 'Not set';

    try {
      return new Date(this.value.start).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    } catch {
      return 'Invalid date';
    }
  }

  get endDisplay() {
    if (!this.value?.end) return 'Not set';

    try {
      return new Date(this.value.end).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    } catch {
      return 'Invalid date';
    }
  }

  <template>
    <div class='business-days-calc' data-test-business-days>
      <div class='date-range-display'>
        <div class='date-item'>
          <div class='date-label'>Start Date</div>
          <div class='date-value'>{{this.startDisplay}}</div>
        </div>
        <div class='date-arrow'>→</div>
        <div class='date-item'>
          <div class='date-label'>End Date</div>
          <div class='date-value'>{{this.endDisplay}}</div>
        </div>
      </div>

      {{#if (gt this.calendarDays 0)}}
        <div class='days-summary'>
          <div class='days-row'>
            <span class='days-label'>Calendar Days:</span>
            <span class='days-value'>{{this.calendarDays}} days</span>
          </div>
          <div class='days-row business'>
            <span class='days-label'>Business Days:</span>
            <span class='days-value business-value'>
              {{this.businessDays}}
              days
            </span>
          </div>
        </div>
      {{/if}}
    </div>

    <style scoped>
      .business-days-calc {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        padding: 0.75rem;
        background: var(--muted, #f5f5f5);
        border: 1px solid var(--border, #e0e0e0);
        border-radius: var(--radius, 0.375rem);
      }

      .date-range-display {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        justify-content: space-between;
      }

      .date-item {
        flex: 1;
      }

      .date-label {
        font-size: 0.75rem;
        color: var(--muted-foreground, #9ca3af);
        margin-bottom: 0.25rem;
      }

      .date-value {
        font-size: 0.875rem;
        font-weight: 500;
        color: var(--foreground, #1a1a1a);
      }

      .date-arrow {
        color: var(--muted-foreground, #9ca3af);
        font-size: 1.25rem;
      }

      .days-summary {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
        padding-top: 0.75rem;
        border-top: 1px solid var(--border, #e0e0e0);
      }

      .days-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: 0.875rem;
      }

      .days-label {
        color: var(--muted-foreground, #9ca3af);
      }

      .days-value {
        font-weight: 600;
        color: var(--foreground, #1a1a1a);
      }

      .business-value {
        color: var(--chart2, #10b981);
      }
    </style>
  </template>
}

// Timeline, TimeSlots, ExpirationWarning, RecurringPattern, and AvailabilityGrid
// presentations are more complex and will be converted from their full field implementations
// in follow-up work. For now, they show placeholder messages.

class TimelinePresentation extends Component {
  get config(): DateTimeConfiguration | undefined {
    return this.args.config as DateTimeConfiguration | undefined;
  }

  get eventName() {
    return this.config?.timelineOptions?.eventName || 'Event';
  }

  get eventTime() {
    return this.args.model?.value;
  }

  get status() {
    return this.config?.timelineOptions?.status || 'pending';
  }

  get statusColor() {
    switch (this.status) {
      case 'complete':
        return 'var(--chart2, #10b981)';
      case 'active':
        return 'var(--primary, #3b82f6)';
      default:
        return 'var(--muted-foreground, #9ca3af)';
    }
  }

  get timeDisplay() {
    if (!this.eventTime) return 'Pending';

    try {
      return new Date(this.eventTime).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
    } catch {
      return 'Pending';
    }
  }

  <template>
    <div class='timeline-event' data-test-timeline-event>
      <div
        class='timeline-marker'
        style={{concat 'background-color: ' this.statusColor}}
      ></div>
      <div class='timeline-content'>
        <div class='timeline-name'>{{this.eventName}}</div>
        <div class='timeline-time'>{{this.timeDisplay}}</div>
      </div>
    </div>

    <style scoped>
      .timeline-event {
        position: relative;
        padding-left: 1.5rem;
        padding-bottom: 1rem;
      }

      .timeline-marker {
        position: absolute;
        left: 0;
        top: 0.25rem;
        width: 0.75rem;
        height: 0.75rem;
        border-radius: 50%;
        border: 2px solid var(--background, #ffffff);
      }

      .timeline-content {
        padding-left: 0.5rem;
      }

      .timeline-name {
        font-size: 0.875rem;
        font-weight: 500;
        color: var(--foreground, #1a1a1a);
        margin-bottom: 0.125rem;
      }

      .timeline-time {
        font-size: 0.75rem;
        color: var(--muted-foreground, #9ca3af);
      }
    </style>
  </template>
}

class TimeSlotsPresentation extends Component {
  @tracked selectedSlot: string | null = null;

  get config(): DateTimeConfiguration | undefined {
    return this.args.config as DateTimeConfiguration | undefined;
  }

  get slots(): string[] {
    const configSlots = this.config?.timeSlotsOptions?.availableSlots;
    if (configSlots) return configSlots;

    return [
      '09:00 AM',
      '10:00 AM',
      '11:00 AM',
      '12:00 PM',
      '01:00 PM',
      '02:00 PM',
      '03:00 PM',
      '04:00 PM',
      '05:00 PM',
    ];
  }

  constructor(owner: unknown, args: any) {
    super(owner, args);
    this.selectedSlot = this.args.model?.value || null;
  }

  @action
  selectSlot(slot: string) {
    this.selectedSlot = slot;
    if (this.args.model) {
      this.args.model.value = slot;
    }
  }

  <template>
    <div class='time-slots' data-test-time-slots>
      <label class='slots-label'>Available Time Slots</label>
      <div class='slots-grid'>
        {{#each this.slots as |slot|}}
          <button
            type='button'
            {{on 'click' (fn this.selectSlot slot)}}
            class='slot-button {{if (eq this.selectedSlot slot) "selected" ""}}'
            data-test-slot={{slot}}
          >
            {{slot}}
          </button>
        {{/each}}
      </div>
      {{#if this.selectedSlot}}
        <div class='selected-indicator'>
          <svg
            class='check-icon'
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            stroke-width='2'
          >
            <polyline points='20 6 9 17 4 12'></polyline>
          </svg>
          Selected:
          {{this.selectedSlot}}
        </div>
      {{/if}}
    </div>

    <style scoped>
      .time-slots {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }

      .slots-label {
        font-size: 0.875rem;
        font-weight: 600;
        color: var(--foreground, #1a1a1a);
      }

      .slots-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 0.5rem;
      }

      .slot-button {
        padding: 0.5rem 0.75rem;
        font-size: 0.8125rem;
        border: 1px solid var(--border, #e0e0e0);
        border-radius: var(--radius, 0.375rem);
        background: var(--background, #ffffff);
        color: var(--foreground, #1a1a1a);
        cursor: pointer;
        transition: all 0.15s ease;
      }

      .slot-button:hover {
        border-color: var(--primary, #3b82f6);
      }

      .slot-button.selected {
        background: var(--primary, #3b82f6);
        color: var(--primary-foreground, #ffffff);
        border-color: var(--primary, #3b82f6);
      }

      .selected-indicator {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        font-size: 0.75rem;
        color: var(--chart2, #10b981);
      }

      .check-icon {
        width: 0.875rem;
        height: 0.875rem;
      }
    </style>
  </template>
}

class ExpirationWarningPresentation extends Component {
  @tracked currentTime = Date.now();
  private intervalId: number | null = null;

  constructor(owner: unknown, args: any) {
    super(owner, args);
    this.intervalId = window.setInterval(() => {
      this.currentTime = Date.now();
    }, 60000); // Update every minute
  }

  willDestroy() {
    super.willDestroy();
    if (this.intervalId) {
      window.clearInterval(this.intervalId);
    }
  }

  get config(): DateTimeConfiguration | undefined {
    return this.args.config as DateTimeConfiguration | undefined;
  }

  get expirationDate() {
    return this.args.model?.value;
  }

  get itemName() {
    return this.config?.expirationOptions?.itemName || 'Your access';
  }

  get timeUntilExpiration() {
    if (!this.expirationDate) return null;

    const expirationTime = new Date(this.expirationDate).getTime();
    const remaining = expirationTime - this.currentTime;

    if (remaining <= 0) return { expired: true, text: 'Expired' };

    const hours = Math.floor(remaining / (1000 * 60 * 60));
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));

    if (days > 0) {
      return {
        expired: false,
        text: `${days} day${days > 1 ? 's' : ''} ${remainingHours} hour${
          remainingHours > 1 ? 's' : ''
        }`,
      };
    }
    if (hours > 0) {
      return {
        expired: false,
        text: `${hours} hour${hours > 1 ? 's' : ''} ${minutes} minute${
          minutes > 1 ? 's' : ''
        }`,
      };
    }
    return {
      expired: false,
      text: `${minutes} minute${minutes > 1 ? 's' : ''}`,
    };
  }

  get severity() {
    if (!this.expirationDate) return 'info';

    const expirationTime = new Date(this.expirationDate).getTime();
    const remaining = expirationTime - this.currentTime;
    const hours = remaining / (1000 * 60 * 60);

    if (remaining <= 0) return 'expired';
    if (hours < 24) return 'critical';
    if (hours < 72) return 'warning';
    return 'info';
  }

  <template>
    <div
      class='expiration-warning {{this.severity}}'
      data-test-expiration-warning
    >
      <div class='warning-icon'>
        <svg
          class='icon'
          viewBox='0 0 24 24'
          fill='none'
          stroke='currentColor'
          stroke-width='2'
        >
          <circle cx='12' cy='12' r='10'></circle>
          <line x1='12' y1='8' x2='12' y2='12'></line>
          <line x1='12' y1='16' x2='12.01' y2='16'></line>
        </svg>
      </div>
      <div class='warning-content'>
        <div class='warning-title'>
          {{#if this.timeUntilExpiration.expired}}
            Expired
          {{else}}
            Expires Soon
          {{/if}}
        </div>
        <div class='warning-message'>
          {{this.itemName}}
          {{#if this.timeUntilExpiration.expired}}
            has expired
          {{else}}
            expires in
            <strong>{{this.timeUntilExpiration.text}}</strong>
          {{/if}}
        </div>
        {{#unless this.timeUntilExpiration.expired}}
          <button type='button' class='renew-button'>
            Renew Now →
          </button>
        {{/unless}}
      </div>
    </div>

    <style scoped>
      .expiration-warning {
        display: flex;
        align-items: flex-start;
        gap: 0.75rem;
        padding: 1rem;
        border-radius: var(--radius, 0.5rem);
        border-left: 4px solid;
      }

      .expiration-warning.info {
        background: rgba(59, 130, 246, 0.1);
        border-left-color: var(--primary, #3b82f6);
      }

      .expiration-warning.warning {
        background: rgba(251, 146, 60, 0.1);
        border-left-color: var(--chart3, #fb923c);
      }

      .expiration-warning.critical {
        background: rgba(239, 68, 68, 0.1);
        border-left-color: var(--destructive, #ef4444);
      }

      .expiration-warning.expired {
        background: rgba(107, 114, 128, 0.1);
        border-left-color: var(--muted-foreground, #6b7280);
      }

      .warning-icon {
        flex-shrink: 0;
        width: 1.25rem;
        height: 1.25rem;
        margin-top: 0.125rem;
      }

      .icon {
        width: 100%;
        height: 100%;
      }

      .expiration-warning.info .icon {
        color: var(--primary, #3b82f6);
      }

      .expiration-warning.warning .icon {
        color: var(--chart3, #fb923c);
      }

      .expiration-warning.critical .icon,
      .expiration-warning.expired .icon {
        color: var(--destructive, #ef4444);
      }

      .warning-content {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }

      .warning-title {
        font-weight: 600;
        font-size: 0.875rem;
      }

      .expiration-warning.info .warning-title {
        color: var(--primary, #3b82f6);
      }

      .expiration-warning.warning .warning-title {
        color: var(--chart3, #fb923c);
      }

      .expiration-warning.critical .warning-title,
      .expiration-warning.expired .warning-title {
        color: var(--destructive, #ef4444);
      }

      .warning-message {
        font-size: 0.8125rem;
        color: var(--foreground, #1a1a1a);
      }

      .renew-button {
        align-self: flex-start;
        padding: 0.25rem 0;
        background: none;
        border: none;
        font-size: 0.8125rem;
        font-weight: 500;
        cursor: pointer;
        transition: opacity 0.15s ease;
      }

      .expiration-warning.info .renew-button {
        color: var(--primary, #3b82f6);
      }

      .expiration-warning.warning .renew-button {
        color: var(--chart3, #fb923c);
      }

      .expiration-warning.critical .renew-button {
        color: var(--destructive, #ef4444);
      }

      .renew-button:hover {
        opacity: 0.8;
      }
    </style>
  </template>
}

// ¹³ Time Input Component
class TimeInput extends Component {
  @action
  updateValue(event: Event) {
    const target = event.target as HTMLInputElement;
    this.args.model.value = target.value;
  }

  <template>
    <div class='input-wrapper'>
      <div class='input-icon'>
        <ClockIcon class='icon' />
      </div>
      <input
        type='time'
        value={{@model.value}}
        placeholder={{@placeholder}}
        {{on 'change' this.updateValue}}
        class='datetime-input'
        data-test-time-input
      />
    </div>

    <style scoped>
      .input-wrapper {
        position: relative;
        width: 100%;
      }

      .input-icon {
        position: absolute;
        left: 0.75rem;
        top: 50%;
        transform: translateY(-50%);
        pointer-events: none;
        display: flex;
        align-items: center;
        color: var(--muted-foreground, #9ca3af);
      }

      .icon {
        width: 1.25rem;
        height: 1.25rem;
      }

      .datetime-input {
        width: 100%;
        padding: 0.5rem 0.75rem 0.5rem 2.5rem;
        border: 1px solid var(--border, #e0e0e0);
        border-radius: var(--radius, 0.375rem);
        font-family: var(--font-sans, system-ui, sans-serif);
        font-size: 0.875rem;
        color: var(--foreground, #1a1a1a);
        background: var(--input, #ffffff);
        transition: all 0.15s ease;
      }

      .datetime-input:focus {
        outline: none;
        border-color: var(--ring, #3b82f6);
        box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
      }
    </style>
  </template>
}

// ¹⁴ DateTime Input Component
class DateTimeInput extends Component {
  @action
  updateValue(event: Event) {
    const target = event.target as HTMLInputElement;
    this.args.model.value = target.value;
  }

  <template>
    <div class='input-wrapper'>
      <div class='input-icon'>
        <CalendarIcon class='icon' />
      </div>
      <input
        type='datetime-local'
        value={{@model.value}}
        placeholder={{@placeholder}}
        {{on 'change' this.updateValue}}
        class='datetime-input'
        data-test-datetime-input
      />
    </div>

    <style scoped>
      .input-wrapper {
        position: relative;
        width: 100%;
      }

      .input-icon {
        position: absolute;
        left: 0.75rem;
        top: 50%;
        transform: translateY(-50%);
        pointer-events: none;
        display: flex;
        align-items: center;
        color: var(--muted-foreground, #9ca3af);
      }

      .icon {
        width: 1.25rem;
        height: 1.25rem;
      }

      .datetime-input {
        width: 100%;
        padding: 0.5rem 0.75rem 0.5rem 2.5rem;
        border: 1px solid var(--border, #e0e0e0);
        border-radius: var(--radius, 0.375rem);
        font-family: var(--font-sans, system-ui, sans-serif);
        font-size: 0.875rem;
        color: var(--foreground, #1a1a1a);
        background: var(--input, #ffffff);
        transition: all 0.15s ease;
      }

      .datetime-input:focus {
        outline: none;
        border-color: var(--ring, #3b82f6);
        box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
      }
    </style>
  </template>
}

// ⁸⁰ Date Range Input Component - using Boxel UI DateRangePicker with correct API
class DateRangeInput extends Component {
  @tracked startDate: Date | null = null;
  @tracked endDate: Date | null = null;

  constructor(owner: unknown, args: any) {
    super(owner, args);
    // ⁸⁵ Initialize tracked dates from model value
    try {
      const value = this.args.model?.value;

      if (!value) {
        const today = new Date();
        const nextWeek = new Date(today);
        nextWeek.setDate(today.getDate() + 7);
        this.startDate = today;
        this.endDate = nextWeek;
        return;
      }

      const parsed = JSON.parse(value);

      if (parsed.start && parsed.end) {
        this.startDate = new Date(parsed.start);
        this.endDate = new Date(parsed.end);
      } else {
        const today = new Date();
        const nextWeek = new Date(today);
        nextWeek.setDate(today.getDate() + 7);
        this.startDate = today;
        this.endDate = nextWeek;
      }
    } catch {
      const today = new Date();
      const nextWeek = new Date(today);
      nextWeek.setDate(today.getDate() + 7);
      this.startDate = today;
      this.endDate = nextWeek;
    }
  }

  // ⁸⁹ Computed selected range object for DateRangePicker
  get selectedRange() {
    return {
      start: this.startDate,
      end: this.endDate,
    };
  }

  @action
  onSelect(selected: { date: { start: Date | null; end: Date | null } }) {
    // ⁹⁰ Update tracked state for partial selections, save to model only when complete
    this.startDate = selected.date.start;
    this.endDate = selected.date.end;

    // Only update model when BOTH dates are selected (complete range)
    if (selected.date.start && selected.date.end) {
      const start = selected.date.start.toISOString().split('T')[0];
      const end = selected.date.end.toISOString().split('T')[0];
      this.args.model.value = JSON.stringify({ start, end });
    }
  }

  get daysDuration() {
    if (!this.startDate || !this.endDate) return 0;
    return Math.ceil(
      (this.endDate.getTime() - this.startDate.getTime()) /
        (1000 * 60 * 60 * 24),
    );
  }

  <template>
    <div class='date-range-wrapper'>
      {{! ⁹¹ Use @selected prop with range object - matches DateRangePicker API }}
      <DateRangePicker
        @selected={{this.selectedRange}}
        @onSelect={{this.onSelect}}
        data-test-date-range-picker
      />
      {{#if (gt this.daysDuration 0)}}
        <p class='range-info'>Duration: {{this.daysDuration}} days</p>
      {{/if}}
    </div>

    <style scoped>
      .date-range-wrapper {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }

      .range-info {
        font-size: 0.75rem;
        color: var(--muted-foreground, #9ca3af);
        margin: 0;
      }
    </style>
  </template>
}

// ¹⁶ Time Range Input Component
class TimeRangeInput extends Component {
  @tracked startTime = '';
  @tracked endTime = '';

  constructor(owner: unknown, args: any) {
    super(owner, args);
    try {
      const parsed = JSON.parse(this.args.model?.value || '{}');
      this.startTime = parsed.start || '';
      this.endTime = parsed.end || '';
    } catch {
      this.startTime = '';
      this.endTime = '';
    }
  }

  @action
  updateStart(event: Event) {
    const target = event.target as HTMLInputElement;
    this.startTime = target.value;
    this.updateModelValue();
  }

  @action
  updateEnd(event: Event) {
    const target = event.target as HTMLInputElement;
    this.endTime = target.value;
    this.updateModelValue();
  }

  updateModelValue() {
    this.args.model.value = JSON.stringify({
      start: this.startTime,
      end: this.endTime,
    });
  }

  <template>
    <div class='time-range-wrapper'>
      <div class='range-inputs'>
        <div class='input-wrapper'>
          <label class='input-label'>Start</label>
          <input
            type='time'
            value={{this.startTime}}
            {{on 'change' this.updateStart}}
            class='datetime-input'
            data-test-time-range-start
          />
        </div>
        <span class='range-arrow'>→</span>
        <div class='input-wrapper'>
          <label class='input-label'>End</label>
          <input
            type='time'
            value={{this.endTime}}
            {{on 'change' this.updateEnd}}
            class='datetime-input'
            data-test-time-range-end
          />
        </div>
      </div>
    </div>

    <style scoped>
      .time-range-wrapper {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }

      .range-inputs {
        display: flex;
        align-items: flex-end;
        gap: 0.5rem;
      }

      .input-wrapper {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
      }

      .input-label {
        font-size: 0.75rem;
        color: var(--muted-foreground, #9ca3af);
        font-weight: 500;
      }

      .datetime-input {
        width: 100%;
        padding: 0.5rem 0.75rem;
        border: 1px solid var(--border, #e0e0e0);
        border-radius: var(--radius, 0.375rem);
        font-family: var(--font-sans, system-ui, sans-serif);
        font-size: 0.875rem;
        color: var(--foreground, #1a1a1a);
        background: var(--input, #ffffff);
        transition: all 0.15s ease;
      }

      .datetime-input:focus {
        outline: none;
        border-color: var(--ring, #3b82f6);
        box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
      }

      .range-arrow {
        color: var(--muted-foreground, #9ca3af);
        font-size: 1.5rem;
        padding-bottom: 0.5rem;
      }
    </style>
  </template>
}

// ⁷¹ Duration Input Component with proper validation
class DurationInput extends Component {
  @tracked hours = 0;
  @tracked minutes = 0;
  @tracked seconds = 0;
  @tracked validationError = '';

  constructor(owner: unknown, args: any) {
    super(owner, args);
    try {
      const parsed = JSON.parse(this.args.model?.value || '{}');
      // ⁷² Normalize values on load (e.g., 3330 seconds → 55 minutes, 30 seconds)
      let totalSeconds =
        (parsed.hours || 0) * 3600 +
        (parsed.minutes || 0) * 60 +
        (parsed.seconds || 0);

      this.hours = Math.floor(totalSeconds / 3600);
      totalSeconds %= 3600;
      this.minutes = Math.floor(totalSeconds / 60);
      this.seconds = totalSeconds % 60;
    } catch {
      this.hours = 0;
      this.minutes = 0;
      this.seconds = 0;
    }
  }

  @action
  updateHours(event: Event) {
    const target = event.target as HTMLInputElement;
    const value = parseInt(target.value);

    // ⁷³ Validate hours (0-23 for time-of-day, or unlimited for durations)
    if (isNaN(value) || value < 0) {
      this.validationError = 'Hours must be 0 or greater';
      return;
    }

    this.hours = value;
    this.validationError = '';
    this.updateModelValue();
  }

  @action
  updateMinutes(event: Event) {
    const target = event.target as HTMLInputElement;
    const value = parseInt(target.value);

    // ⁷⁴ Validate minutes (0-59)
    if (isNaN(value) || value < 0 || value > 59) {
      this.validationError = 'Minutes must be between 0-59';
      return;
    }

    this.minutes = value;
    this.validationError = '';
    this.updateModelValue();
  }

  @action
  updateSeconds(event: Event) {
    const target = event.target as HTMLInputElement;
    const value = parseInt(target.value);

    // ⁷⁵ Validate seconds (0-59)
    if (isNaN(value) || value < 0 || value > 59) {
      this.validationError = 'Seconds must be between 0-59';
      return;
    }

    this.seconds = value;
    this.validationError = '';
    this.updateModelValue();
  }

  updateModelValue() {
    this.args.model.value = JSON.stringify({
      hours: this.hours,
      minutes: this.minutes,
      seconds: this.seconds,
    });
  }

  get totalMinutes() {
    return (this.hours * 60 + this.minutes + this.seconds / 60).toFixed(1);
  }

  get totalSeconds() {
    return this.hours * 3600 + this.minutes * 60 + this.seconds;
  }

  <template>
    <div class='duration-wrapper'>
      {{#if this.validationError}}
        <div class='validation-error' data-test-validation-error>
          <svg
            class='error-icon'
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            stroke-width='2'
          >
            <circle cx='12' cy='12' r='10'></circle>
            <line x1='12' y1='8' x2='12' y2='12'></line>
            <line x1='12' y1='16' x2='12.01' y2='16'></line>
          </svg>
          {{this.validationError}}
        </div>
      {{/if}}
      <div class='duration-inputs'>
        <div class='duration-field'>
          <label class='input-label'>Hours</label>
          <input
            type='number'
            value={{this.hours}}
            min='0'
            {{on 'input' this.updateHours}}
            class='duration-input {{if this.validationError "error" ""}}'
            data-test-duration-hours
          />
        </div>
        <span class='duration-separator'>:</span>
        <div class='duration-field'>
          <label class='input-label'>Minutes</label>
          <input
            type='number'
            value={{this.minutes}}
            min='0'
            max='59'
            {{on 'input' this.updateMinutes}}
            class='duration-input {{if this.validationError "error" ""}}'
            data-test-duration-minutes
          />
        </div>
        <span class='duration-separator'>:</span>
        <div class='duration-field'>
          <label class='input-label'>Seconds</label>
          <input
            type='number'
            value={{this.seconds}}
            min='0'
            max='59'
            {{on 'input' this.updateSeconds}}
            class='duration-input {{if this.validationError "error" ""}}'
            data-test-duration-seconds
          />
        </div>
      </div>
      <div class='duration-info'>
        <span class='info-text'>Total:
          {{this.hours}}h
          {{this.minutes}}m
          {{this.seconds}}s</span>
        <span class='info-text'>=
          {{this.totalMinutes}}
          minutes ({{this.totalSeconds}}s)</span>
      </div>
    </div>

    <style scoped>
      .duration-wrapper {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }

      .duration-inputs {
        display: flex;
        align-items: flex-end;
        gap: 0.5rem;
      }

      .duration-field {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
      }

      .input-label {
        font-size: 0.75rem;
        color: var(--muted-foreground, #9ca3af);
        font-weight: 500;
      }

      .duration-input {
        width: 100%;
        padding: 0.5rem 0.75rem;
        border: 1px solid var(--border, #e0e0e0);
        border-radius: var(--radius, 0.375rem);
        font-family: var(--font-sans, system-ui, sans-serif);
        font-size: 0.875rem;
        color: var(--foreground, #1a1a1a);
        background: var(--input, #ffffff);
        text-align: center;
        transition: all 0.15s ease;
      }

      .duration-input:focus {
        outline: none;
        border-color: var(--ring, #3b82f6);
        box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
      }

      .duration-input.error {
        border-color: var(--destructive, #ef4444);
      }

      .duration-input.error:focus {
        box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.1);
      }

      .validation-error {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        padding: 0.5rem 0.75rem;
        background: rgba(239, 68, 68, 0.1);
        border: 1px solid var(--destructive, #ef4444);
        border-radius: var(--radius, 0.375rem);
        font-size: 0.75rem;
        color: var(--destructive, #ef4444);
      }

      .error-icon {
        width: 1rem;
        height: 1rem;
        flex-shrink: 0;
      }

      .duration-separator {
        font-size: 1.5rem;
        color: var(--muted-foreground, #9ca3af);
        padding-bottom: 0.5rem;
      }

      .duration-info {
        display: flex;
        justify-content: space-between;
        font-size: 0.75rem;
        color: var(--muted-foreground, #9ca3af);
      }

      .info-text {
        margin: 0;
      }
    </style>
  </template>
}

// ¹⁸ Month-Day Input Component (Birthday)
class MonthDayInput extends Component {
  @tracked month = '01';
  @tracked day = '01';

  months = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];

  constructor(owner: unknown, args: any) {
    super(owner, args);
    try {
      const parsed = JSON.parse(this.args.model?.value || '{}');
      this.month = parsed.month || '01';
      this.day = parsed.day || '01';
    } catch {
      this.month = '01';
      this.day = '01';
    }
  }

  @action
  updateMonth(event: Event) {
    const target = event.target as HTMLSelectElement;
    this.month = target.value;
    this.updateModelValue();
  }

  @action
  updateDay(event: Event) {
    const target = event.target as HTMLSelectElement;
    this.day = target.value;
    this.updateModelValue();
  }

  updateModelValue() {
    this.args.model.value = JSON.stringify({
      month: this.month,
      day: this.day,
    });
  }

  get displayValue() {
    const monthName = this.months[parseInt(this.month) - 1];
    return `${monthName} ${parseInt(this.day)}`;
  }

  <template>
    <div class='month-day-wrapper'>
      <div class='month-day-inputs'>
        <div class='select-wrapper month-select'>
          <div class='input-icon'>
            <GiftIcon class='icon' />
          </div>
          <select
            value={{this.month}}
            {{on 'change' this.updateMonth}}
            class='datetime-select'
            data-test-month-select
          >
            {{#each this.months as |monthName index|}}
              <option
                value={{if
                  (lt (add index 1) 10)
                  (concat '0' (add index 1))
                  (add index 1)
                }}
              >
                {{monthName}}
              </option>
            {{/each}}
          </select>
          <div class='select-icon'>
            <svg
              class='icon'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='2'
            >
              <polyline points='6 9 12 15 18 9'></polyline>
            </svg>
          </div>
        </div>
        <div class='select-wrapper day-select'>
          <select
            value={{this.day}}
            {{on 'change' this.updateDay}}
            class='datetime-select'
            data-test-day-select
          >
            {{#each
              (array
                1
                2
                3
                4
                5
                6
                7
                8
                9
                10
                11
                12
                13
                14
                15
                16
                17
                18
                19
                20
                21
                22
                23
                24
                25
                26
                27
                28
                29
                30
                31
              )
              as |dayNum|
            }}
              <option value={{if (lt dayNum 10) (concat '0' dayNum) dayNum}}>
                {{dayNum}}
              </option>
            {{/each}}
          </select>
          <div class='select-icon'>
            <svg
              class='icon'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='2'
            >
              <polyline points='6 9 12 15 18 9'></polyline>
            </svg>
          </div>
        </div>
      </div>
      <p class='month-day-display'>Birthday: {{this.displayValue}}</p>
    </div>

    <style scoped>
      .month-day-wrapper {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }

      .month-day-inputs {
        display: flex;
        gap: 0.5rem;
      }

      .select-wrapper {
        position: relative;
      }

      .month-select {
        flex: 1;
      }

      .day-select {
        width: 6rem;
      }

      .input-icon {
        position: absolute;
        left: 0.75rem;
        top: 50%;
        transform: translateY(-50%);
        pointer-events: none;
        display: flex;
        align-items: center;
        color: var(--muted-foreground, #9ca3af);
      }

      .select-icon {
        position: absolute;
        right: 0.75rem;
        top: 50%;
        transform: translateY(-50%);
        pointer-events: none;
        display: flex;
        align-items: center;
        color: var(--muted-foreground, #9ca3af);
      }

      .icon {
        width: 1.25rem;
        height: 1.25rem;
      }

      .datetime-select {
        width: 100%;
        padding: 0.5rem 2rem 0.5rem 0.75rem;
        border: 1px solid var(--border, #e0e0e0);
        border-radius: var(--radius, 0.375rem);
        font-family: var(--font-sans, system-ui, sans-serif);
        font-size: 0.875rem;
        color: var(--foreground, #1a1a1a);
        background: var(--input, #ffffff);
        appearance: none;
        cursor: pointer;
        transition: all 0.15s ease;
      }

      .month-select .datetime-select {
        padding-left: 2.5rem;
      }

      .datetime-select:focus {
        outline: none;
        border-color: var(--ring, #3b82f6);
        box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
      }

      .month-day-display {
        font-size: 0.75rem;
        color: var(--muted-foreground, #9ca3af);
        margin: 0;
      }
    </style>
  </template>
}

// ¹⁹ Year Input Component
class YearInput extends Component {
  @action
  updateValue(event: Event) {
    const target = event.target as HTMLSelectElement;
    this.args.model.value = target.value;
  }

  get years() {
    return Array.from({ length: 20 }, (_, i) => 2015 + i).reverse();
  }

  <template>
    <div class='select-wrapper'>
      <div class='input-icon'>
        <CalendarEventIcon class='icon' />
      </div>
      <select
        value={{@model.value}}
        {{on 'change' this.updateValue}}
        class='datetime-select'
        data-test-year-select
      >
        {{#each this.years as |year|}}
          <option value={{year}}>{{year}}</option>
        {{/each}}
      </select>
      <div class='select-icon'>
        <ChevronDownIcon class='icon' />
      </div>
    </div>

    <style scoped>
      .select-wrapper {
        position: relative;
        width: 100%;
      }

      .input-icon {
        position: absolute;
        left: 0.75rem;
        top: 50%;
        transform: translateY(-50%);
        pointer-events: none;
        display: flex;
        align-items: center;
        color: var(--muted-foreground, #9ca3af);
      }

      .select-icon {
        position: absolute;
        right: 0.75rem;
        top: 50%;
        transform: translateY(-50%);
        pointer-events: none;
        display: flex;
        align-items: center;
        color: var(--muted-foreground, #9ca3af);
      }

      .icon {
        width: 1.25rem;
        height: 1.25rem;
      }

      .datetime-select {
        width: 100%;
        padding: 0.5rem 2.5rem;
        border: 1px solid var(--border, #e0e0e0);
        border-radius: var(--radius, 0.375rem);
        font-family: var(--font-sans, system-ui, sans-serif);
        font-size: 0.875rem;
        color: var(--foreground, #1a1a1a);
        background: var(--input, #ffffff);
        appearance: none;
        cursor: pointer;
        transition: all 0.15s ease;
      }

      .datetime-select:focus {
        outline: none;
        border-color: var(--ring, #3b82f6);
        box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
      }
    </style>
  </template>
}

// ²⁰ Month Input Component
class MonthInput extends Component {
  months = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];

  @action
  updateValue(event: Event) {
    const target = event.target as HTMLSelectElement;
    this.args.model.value = target.value;
  }

  <template>
    <div class='select-wrapper'>
      <div class='input-icon'>
        <CalendarIcon class='icon' />
      </div>
      <select
        value={{@model.value}}
        {{on 'change' this.updateValue}}
        class='datetime-select'
        data-test-month-select
      >
        {{#each this.months as |monthName index|}}
          <option
            value={{if
              (lt (add index 1) 10)
              (concat '0' (add index 1))
              (add index 1)
            }}
          >
            {{monthName}}
          </option>
        {{/each}}
      </select>
      <div class='select-icon'>
        <ChevronDownIcon class='icon' />
      </div>
    </div>

    <style scoped>
      .select-wrapper {
        position: relative;
        width: 100%;
      }

      .input-icon {
        position: absolute;
        left: 0.75rem;
        top: 50%;
        transform: translateY(-50%);
        pointer-events: none;
        display: flex;
        align-items: center;
        color: var(--muted-foreground, #9ca3af);
      }

      .select-icon {
        position: absolute;
        right: 0.75rem;
        top: 50%;
        transform: translateY(-50%);
        pointer-events: none;
        display: flex;
        align-items: center;
        color: var(--muted-foreground, #9ca3af);
      }

      .icon {
        width: 1.25rem;
        height: 1.25rem;
      }

      .datetime-select {
        width: 100%;
        padding: 0.5rem 2.5rem;
        border: 1px solid var(--border, #e0e0e0);
        border-radius: var(--radius, 0.375rem);
        font-family: var(--font-sans, system-ui, sans-serif);
        font-size: 0.875rem;
        color: var(--foreground, #1a1a1a);
        background: var(--input, #ffffff);
        appearance: none;
        cursor: pointer;
        transition: all 0.15s ease;
      }

      .datetime-select:focus {
        outline: none;
        border-color: var(--ring, #3b82f6);
        box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
      }
    </style>
  </template>
}

// ²¹ Month-Year Input Component
class MonthYearInput extends Component {
  @action
  updateValue(event: Event) {
    const target = event.target as HTMLInputElement;
    this.args.model.value = target.value;
  }

  get displayValue() {
    if (!this.args.model?.value) return '';
    try {
      const date = new Date(this.args.model.value + '-01');
      return date.toLocaleDateString('en-US', {
        month: 'long',
        year: 'numeric',
      });
    } catch {
      return '';
    }
  }

  <template>
    <div class='month-year-wrapper'>
      <div class='input-wrapper'>
        <div class='input-icon'>
          <CalendarEventIcon class='icon' />
        </div>
        <input
          type='month'
          value={{@model.value}}
          {{on 'change' this.updateValue}}
          class='datetime-input'
          data-test-month-year-input
        />
      </div>
      {{#if this.displayValue}}
        <p class='display-value'>{{this.displayValue}}</p>
      {{/if}}
    </div>

    <style scoped>
      .month-year-wrapper {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }

      .input-wrapper {
        position: relative;
        width: 100%;
      }

      .input-icon {
        position: absolute;
        left: 0.75rem;
        top: 50%;
        transform: translateY(-50%);
        pointer-events: none;
        display: flex;
        align-items: center;
        color: var(--muted-foreground, #9ca3af);
      }

      .icon {
        width: 1.25rem;
        height: 1.25rem;
      }

      .datetime-input {
        width: 100%;
        padding: 0.5rem 0.75rem 0.5rem 2.5rem;
        border: 1px solid var(--border, #e0e0e0);
        border-radius: var(--radius, 0.375rem);
        font-family: var(--font-sans, system-ui, sans-serif);
        font-size: 0.875rem;
        color: var(--foreground, #1a1a1a);
        background: var(--input, #ffffff);
        transition: all 0.15s ease;
      }

      .datetime-input:focus {
        outline: none;
        border-color: var(--ring, #3b82f6);
        box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
      }

      .display-value {
        font-size: 0.75rem;
        color: var(--muted-foreground, #9ca3af);
        margin: 0;
      }
    </style>
  </template>
}

// ²² Week Input Component
class WeekInput extends Component {
  @action
  updateValue(event: Event) {
    const target = event.target as HTMLInputElement;
    this.args.model.value = target.value;
  }

  get weekDisplay() {
    if (!this.args.model?.value) return '';
    const [year, week] = this.args.model.value.split('-W');
    return `Week ${week} of ${year}`;
  }

  <template>
    <div class='week-wrapper'>
      <div class='input-wrapper'>
        <div class='input-icon'>
          <CalendarEventIcon class='icon' />
        </div>
        <input
          type='week'
          value={{@model.value}}
          {{on 'change' this.updateValue}}
          class='datetime-input'
          data-test-week-input
        />
      </div>
      {{#if this.weekDisplay}}
        <p class='display-value'>{{this.weekDisplay}}</p>
      {{/if}}
    </div>

    <style scoped>
      .week-wrapper {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }

      .input-wrapper {
        position: relative;
        width: 100%;
      }

      .input-icon {
        position: absolute;
        left: 0.75rem;
        top: 50%;
        transform: translateY(-50%);
        pointer-events: none;
        display: flex;
        align-items: center;
        color: var(--muted-foreground, #9ca3af);
      }

      .icon {
        width: 1.25rem;
        height: 1.25rem;
      }

      .datetime-input {
        width: 100%;
        padding: 0.5rem 0.75rem 0.5rem 2.5rem;
        border: 1px solid var(--border, #e0e0e0);
        border-radius: var(--radius, 0.375rem);
        font-family: var(--font-sans, system-ui, sans-serif);
        font-size: 0.875rem;
        color: var(--foreground, #1a1a1a);
        background: var(--input, #ffffff);
        transition: all 0.15s ease;
      }

      .datetime-input:focus {
        outline: none;
        border-color: var(--ring, #3b82f6);
        box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
      }

      .display-value {
        font-size: 0.75rem;
        color: var(--muted-foreground, #9ca3af);
        margin: 0;
      }
    </style>
  </template>
}

// ²³ Quarter Input Component
class QuarterInput extends Component {
  @tracked quarter = 'Q1';
  @tracked year = '2024';

  constructor(owner: unknown, args: any) {
    super(owner, args);
    try {
      const parsed = JSON.parse(this.args.model?.value || '{}');
      this.quarter = parsed.quarter || 'Q1';
      this.year = parsed.year || '2024';
    } catch {
      this.quarter = 'Q1';
      this.year = '2024';
    }
  }

  @action
  updateQuarter(event: Event) {
    const target = event.target as HTMLSelectElement;
    this.quarter = target.value as QuarterValue;
    this.updateModelValue();
  }

  @action
  updateYear(event: Event) {
    const target = event.target as HTMLSelectElement;
    this.year = target.value;
    this.updateModelValue();
  }

  updateModelValue() {
    this.args.model.value = JSON.stringify({
      quarter: this.quarter,
      year: this.year,
    });
  }

  get years() {
    return Array.from({ length: 10 }, (_, i) => 2020 + i).reverse();
  }

  <template>
    <div class='quarter-wrapper'>
      <div class='quarter-inputs'>
        <div class='select-wrapper'>
          <select
            value={{this.quarter}}
            {{on 'change' this.updateQuarter}}
            class='datetime-select'
            data-test-quarter-select
          >
            <option value='Q1'>Q1 (Jan-Mar)</option>
            <option value='Q2'>Q2 (Apr-Jun)</option>
            <option value='Q3'>Q3 (Jul-Sep)</option>
            <option value='Q4'>Q4 (Oct-Dec)</option>
          </select>
          <div class='select-icon'>
            <ChevronDownIcon class='icon' />
          </div>
        </div>
        <div class='select-wrapper'>
          <select
            value={{this.year}}
            {{on 'change' this.updateYear}}
            class='datetime-select'
            data-test-quarter-year-select
          >
            {{#each this.years as |yearValue|}}
              <option value={{yearValue}}>{{yearValue}}</option>
            {{/each}}
          </select>
          <div class='select-icon'>
            <ChevronDownIcon class='icon' />
          </div>
        </div>
      </div>
      <p class='display-value'>{{this.quarter}} {{this.year}}</p>
    </div>

    <style scoped>
      .quarter-wrapper {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }

      .quarter-inputs {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 0.5rem;
      }

      .select-wrapper {
        position: relative;
      }

      .select-icon {
        position: absolute;
        right: 0.75rem;
        top: 50%;
        transform: translateY(-50%);
        pointer-events: none;
        display: flex;
        align-items: center;
        color: var(--muted-foreground, #9ca3af);
      }

      .icon {
        width: 1.25rem;
        height: 1.25rem;
      }

      .datetime-select {
        width: 100%;
        padding: 0.5rem 2rem 0.5rem 0.75rem;
        border: 1px solid var(--border, #e0e0e0);
        border-radius: var(--radius, 0.375rem);
        font-family: var(--font-sans, system-ui, sans-serif);
        font-size: 0.875rem;
        color: var(--foreground, #1a1a1a);
        background: var(--input, #ffffff);
        appearance: none;
        cursor: pointer;
        transition: all 0.15s ease;
      }

      .datetime-select:focus {
        outline: none;
        border-color: var(--ring, #3b82f6);
        box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
      }

      .display-value {
        font-size: 0.75rem;
        color: var(--muted-foreground, #9ca3af);
        margin: 0;
      }
    </style>
  </template>
}

// ⁸² Enhanced Recurring Pattern Input Component with full recurrence support
class RecurringInput extends Component {
  @tracked pattern = 'none';
  @tracked startDate = '';
  @tracked endDate = '';
  @tracked occurrences: number | null = null;
  @tracked interval = 1;
  @tracked daysOfWeek: number[] = [];
  @tracked dayOfMonth = 1;
  @tracked monthOfYear = 1;
  @tracked showAdvanced = false;

  patterns = [
    { value: 'none', label: 'Does not repeat' },
    { value: 'daily', label: 'Daily' },
    { value: 'weekdays', label: 'Every weekday (Mon-Fri)' },
    { value: 'weekly', label: 'Weekly' },
    { value: 'biweekly', label: 'Every 2 weeks' },
    { value: 'monthly', label: 'Monthly' },
    { value: 'yearly', label: 'Yearly' },
    { value: 'custom', label: 'Custom...' },
  ];

  weekDays = [
    { value: 0, label: 'Sun' },
    { value: 1, label: 'Mon' },
    { value: 2, label: 'Tue' },
    { value: 3, label: 'Wed' },
    { value: 4, label: 'Thu' },
    { value: 5, label: 'Fri' },
    { value: 6, label: 'Sat' },
  ];

  constructor(owner: unknown, args: any) {
    super(owner, args);
    this.loadFromModel();
  }

  loadFromModel() {
    try {
      const value = this.args.model?.value;
      if (!value) return;

      const parsed = JSON.parse(value) as RecurringValue;
      this.pattern = parsed.pattern || 'none';
      this.startDate = parsed.startDate || '';
      this.endDate = parsed.endDate || '';
      this.occurrences = parsed.occurrences ?? null;
      this.interval = parsed.interval || 1;
      this.daysOfWeek = parsed.daysOfWeek || [];
      this.dayOfMonth = parsed.dayOfMonth || 1;
      this.monthOfYear = parsed.monthOfYear || 1;
    } catch (e) {
      console.warn('RecurringInput: Failed to parse value', e);
    }
  }

  get selectedPattern() {
    return (
      this.patterns.find((p) => p.value === this.pattern) || this.patterns[0]
    );
  }

  get needsWeekdays() {
    return this.pattern === 'weekly' || this.pattern === 'biweekly';
  }

  get needsDayOfMonth() {
    return this.pattern === 'monthly';
  }

  get needsMonthOfYear() {
    return this.pattern === 'yearly';
  }

  get hasEndCondition() {
    return this.pattern !== 'none';
  }

  @action
  updatePattern(selected: { value: string; label: string } | null) {
    if (!selected) return;

    this.pattern = selected.value;

    // Set smart defaults based on pattern
    if (selected.value === 'weekdays') {
      this.daysOfWeek = [1, 2, 3, 4, 5]; // Mon-Fri
    } else if (selected.value === 'weekly') {
      const today = new Date().getDay();
      this.daysOfWeek = [today]; // Current day of week
    } else if (selected.value === 'biweekly') {
      this.interval = 2;
      const today = new Date().getDay();
      this.daysOfWeek = [today];
    } else if (selected.value === 'monthly') {
      this.dayOfMonth = new Date().getDate(); // Current day of month
    } else if (selected.value === 'yearly') {
      this.monthOfYear = new Date().getMonth() + 1; // Current month
      this.dayOfMonth = new Date().getDate();
    }

    this.updateModelValue();
  }

  @action
  updateStartDate(event: Event) {
    const target = event.target as HTMLInputElement;
    this.startDate = target.value;
    this.updateModelValue();
  }

  @action
  updateEndDate(event: Event) {
    const target = event.target as HTMLInputElement;
    this.endDate = target.value;
    this.occurrences = null; // Clear occurrences when end date is set
    this.updateModelValue();
  }

  @action
  updateOccurrences(event: Event) {
    const target = event.target as HTMLInputElement;
    const value = parseInt(target.value);
    this.occurrences = isNaN(value) ? null : value;
    if (this.occurrences) {
      this.endDate = ''; // Clear end date when occurrences is set
    }
    this.updateModelValue();
  }

  @action
  updateInterval(event: Event) {
    const target = event.target as HTMLInputElement;
    this.interval = parseInt(target.value) || 1;
    this.updateModelValue();
  }

  @action
  toggleWeekday(day: number) {
    if (this.daysOfWeek.includes(day)) {
      this.daysOfWeek = this.daysOfWeek.filter((d) => d !== day);
    } else {
      this.daysOfWeek = [...this.daysOfWeek, day].sort();
    }
    this.updateModelValue();
  }

  @action
  updateDayOfMonth(event: Event) {
    const target = event.target as HTMLInputElement;
    this.dayOfMonth = parseInt(target.value) || 1;
    this.updateModelValue();
  }

  @action
  updateMonthOfYear(event: Event) {
    const target = event.target as HTMLSelectElement;
    this.monthOfYear = parseInt(target.value) || 1;
    this.updateModelValue();
  }

  @action
  toggleAdvanced() {
    this.showAdvanced = !this.showAdvanced;
  }

  updateModelValue() {
    const recurringValue: RecurringValue = {
      pattern: this.pattern as RecurringValue['pattern'],
    };

    if (this.startDate) recurringValue.startDate = this.startDate;
    if (this.endDate) recurringValue.endDate = this.endDate;
    if (this.occurrences) recurringValue.occurrences = this.occurrences;
    if (this.interval > 1) recurringValue.interval = this.interval;
    if (this.daysOfWeek.length > 0) recurringValue.daysOfWeek = this.daysOfWeek;
    if (this.needsDayOfMonth) recurringValue.dayOfMonth = this.dayOfMonth;
    if (this.needsMonthOfYear) recurringValue.monthOfYear = this.monthOfYear;

    this.args.model.value = JSON.stringify(recurringValue);
  }

  get summary() {
    if (this.pattern === 'none') return 'Does not repeat';

    const parts: string[] = [];

    if (this.interval > 1) {
      parts.push(`Every ${this.interval}`);
    }

    parts.push(this.selectedPattern.label);

    if (this.needsWeekdays && this.daysOfWeek.length > 0) {
      const dayNames = this.daysOfWeek
        .map((d) => this.weekDays[d].label)
        .join(', ');
      parts.push(`on ${dayNames}`);
    }

    if (this.endDate) {
      parts.push(
        `until ${new Date(this.endDate).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
        })}`,
      );
    } else if (this.occurrences) {
      parts.push(`${this.occurrences} times`);
    }

    return parts.join(' ');
  }

  <template>
    <div class='recurring-input-wrapper'>
      <label class='input-label'>Repeat Pattern</label>
      <BoxelSelect
        @selected={{this.selectedPattern}}
        @options={{this.patterns}}
        @onChange={{this.updatePattern}}
        @placeholder={{@placeholder}}
        class='recurring-select'
        data-test-recurring-select
        as |option|
      >
        <div class='pattern-option'>
          <svg
            class='repeat-icon'
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            stroke-width='2'
          >
            <path d='M17 2v4'></path>
            <path d='M7 2v4'></path>
            <rect x='3' y='4' width='18' height='18' rx='2'></rect>
            <path d='M3 10h18'></path>
            <path d='M8 14h.01'></path>
            <path d='M12 14h.01'></path>
            <path d='M16 14h.01'></path>
            <path d='M8 18h.01'></path>
            <path d='M12 18h.01'></path>
            <path d='M16 18h.01'></path>
          </svg>
          {{option.label}}
        </div>
      </BoxelSelect>

      {{#if (not (eq this.pattern 'none'))}}
        <div class='recurrence-details'>
          {{! Start Date }}
          <div class='detail-field'>
            <label class='detail-label'>Starts on</label>
            <input
              type='date'
              value={{this.startDate}}
              {{on 'change' this.updateStartDate}}
              class='detail-input'
              data-test-recurring-start
            />
          </div>

          {{! Weekly: Day selection }}
          {{#if this.needsWeekdays}}
            <div class='detail-field'>
              <label class='detail-label'>Repeat on</label>
              <div class='weekday-buttons'>
                {{#each this.weekDays as |day|}}
                  <button
                    type='button'
                    {{on 'click' (fn this.toggleWeekday day.value)}}
                    class='weekday-btn
                      {{if (array this.daysOfWeek day.value) "selected" ""}}'
                    data-test-weekday={{day.value}}
                  >
                    {{day.label}}
                  </button>
                {{/each}}
              </div>
            </div>
          {{/if}}

          {{! Monthly: Day of month }}
          {{#if this.needsDayOfMonth}}
            <div class='detail-field'>
              <label class='detail-label'>Day of month</label>
              <input
                type='number'
                value={{this.dayOfMonth}}
                min='1'
                max='31'
                {{on 'input' this.updateDayOfMonth}}
                class='detail-input'
                data-test-day-of-month
              />
            </div>
          {{/if}}

          {{! Yearly: Month }}
          {{#if this.needsMonthOfYear}}
            <div class='detail-field'>
              <label class='detail-label'>Month</label>
              <select
                value={{this.monthOfYear}}
                {{on 'change' this.updateMonthOfYear}}
                class='detail-select'
                data-test-month-of-year
              >
                <option value='1'>January</option>
                <option value='2'>February</option>
                <option value='3'>March</option>
                <option value='4'>April</option>
                <option value='5'>May</option>
                <option value='6'>June</option>
                <option value='7'>July</option>
                <option value='8'>August</option>
                <option value='9'>September</option>
                <option value='10'>October</option>
                <option value='11'>November</option>
                <option value='12'>December</option>
              </select>
            </div>
          {{/if}}

          {{! End Condition }}
          <div class='detail-field'>
            <label class='detail-label'>Ends</label>
            <div class='end-options'>
              <div class='end-option'>
                <label class='radio-label'>
                  <input
                    type='radio'
                    name='endType'
                    checked={{this.endDate}}
                    {{on 'change' (fn (mut this.occurrences) null)}}
                  />
                  <span>On date</span>
                </label>
                <input
                  type='date'
                  value={{this.endDate}}
                  {{on 'change' this.updateEndDate}}
                  class='detail-input'
                  disabled={{this.occurrences}}
                  data-test-recurring-end
                />
              </div>
              <div class='end-option'>
                <label class='radio-label'>
                  <input
                    type='radio'
                    name='endType'
                    checked={{this.occurrences}}
                    {{on 'change' (fn (mut this.endDate) '')}}
                  />
                  <span>After</span>
                </label>
                <div class='occurrence-input'>
                  <input
                    type='number'
                    value={{this.occurrences}}
                    min='1'
                    {{on 'input' this.updateOccurrences}}
                    class='detail-input occurrence-number'
                    disabled={{this.endDate}}
                    data-test-recurring-occurrences
                  />
                  <span class='occurrence-label'>occurrences</span>
                </div>
              </div>
            </div>
          </div>

          {{! Summary }}
          <div class='recurrence-summary'>
            <svg
              class='summary-icon'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='2'
            >
              <circle cx='12' cy='12' r='10'></circle>
              <line x1='12' y1='16' x2='12' y2='12'></line>
              <line x1='12' y1='8' x2='12.01' y2='8'></line>
            </svg>
            {{this.summary}}
          </div>
        </div>
      {{/if}}
    </div>

    <style scoped>
      .recurring-input-wrapper {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }

      .input-label {
        font-size: 0.875rem;
        font-weight: 600;
        color: var(--foreground, #1a1a1a);
      }

      .recurring-select {
        width: 100%;
      }

      .pattern-option {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }

      .repeat-icon {
        width: 1rem;
        height: 1rem;
        color: var(--primary, #3b82f6);
      }

      .recurrence-details {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        padding: 0.75rem;
        background: var(--muted, #f8fafc);
        border: 1px solid var(--border, #e2e8f0);
        border-radius: var(--radius, 0.375rem);
      }

      .detail-field {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
      }

      .detail-label {
        font-size: 0.75rem;
        font-weight: 500;
        color: var(--muted-foreground, #64748b);
      }

      .detail-input,
      .detail-select {
        padding: 0.375rem 0.5rem;
        border: 1px solid var(--border, #e0e0e0);
        border-radius: var(--radius, 0.25rem);
        font-size: 0.8125rem;
        color: var(--foreground, #1a1a1a);
        background: var(--input, #ffffff);
        transition: all 0.15s ease;
      }

      .detail-input:focus,
      .detail-select:focus {
        outline: none;
        border-color: var(--ring, #3b82f6);
        box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.1);
      }

      .detail-input:disabled {
        background: var(--muted, #f1f5f9);
        color: var(--muted-foreground, #94a3b8);
        cursor: not-allowed;
      }

      .weekday-buttons {
        display: grid;
        grid-template-columns: repeat(7, 1fr);
        gap: 0.25rem;
      }

      .weekday-btn {
        padding: 0.375rem;
        font-size: 0.75rem;
        border: 1px solid var(--border, #e0e0e0);
        border-radius: var(--radius, 0.25rem);
        background: var(--background, #ffffff);
        color: var(--foreground, #1a1a1a);
        cursor: pointer;
        transition: all 0.15s ease;
      }

      .weekday-btn:hover {
        border-color: var(--primary, #3b82f6);
      }

      .weekday-btn.selected {
        background: var(--primary, #3b82f6);
        color: var(--primary-foreground, #ffffff);
        border-color: var(--primary, #3b82f6);
      }

      .end-options {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }

      .end-option {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
      }

      .radio-label {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        font-size: 0.8125rem;
        color: var(--foreground, #1a1a1a);
        cursor: pointer;
      }

      .occurrence-input {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }

      .occurrence-number {
        width: 5rem;
      }

      .occurrence-label {
        font-size: 0.8125rem;
        color: var(--muted-foreground, #64748b);
      }

      .recurrence-summary {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.5rem 0.75rem;
        background: rgba(59, 130, 246, 0.1);
        border-left: 3px solid var(--primary, #3b82f6);
        border-radius: var(--radius, 0.25rem);
        font-size: 0.8125rem;
        color: var(--foreground, #1a1a1a);
      }

      .summary-icon {
        width: 1rem;
        height: 1rem;
        flex-shrink: 0;
        color: var(--primary, #3b82f6);
      }
    </style>
  </template>
}

// ²⁴ Relative Time Input Component
class RelativeTimeInput extends Component {
  @tracked amount = 2;
  @tracked unit = 'hours';

  constructor(owner: unknown, args: any) {
    super(owner, args);
    try {
      const parsed = JSON.parse(this.args.model?.value || '{}');
      this.amount = parsed.amount || 2;
      this.unit = parsed.unit || 'hours';
    } catch {
      this.amount = 2;
      this.unit = 'hours';
    }
  }

  @action
  updateAmount(event: Event) {
    const target = event.target as HTMLInputElement;
    this.amount = parseInt(target.value) || 0;
    this.updateModelValue();
  }

  @action
  updateUnit(event: Event) {
    const target = event.target as HTMLSelectElement;
    this.unit = target.value;
    this.updateModelValue();
  }

  updateModelValue() {
    this.args.model.value = JSON.stringify({
      amount: this.amount,
      unit: this.unit,
    });
  }

  <template>
    <div class='relative-wrapper'>
      <div class='relative-inputs'>
        <input
          type='number'
          value={{this.amount}}
          min='1'
          {{on 'input' this.updateAmount}}
          class='relative-number'
          data-test-relative-amount
        />
        <div class='select-wrapper'>
          <select
            value={{this.unit}}
            {{on 'change' this.updateUnit}}
            class='datetime-select'
            data-test-relative-unit
          >
            <option value='minutes'>Minutes</option>
            <option value='hours'>Hours</option>
            <option value='days'>Days</option>
            <option value='weeks'>Weeks</option>
            <option value='months'>Months</option>
          </select>
          <div class='select-icon'>
            <ChevronDownIcon class='icon' />
          </div>
        </div>
      </div>
      <p class='display-value'>In {{this.amount}} {{this.unit}}</p>
    </div>

    <style scoped>
      .relative-wrapper {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }

      .relative-inputs {
        display: flex;
        gap: 0.5rem;
      }

      .relative-number {
        width: 6rem;
        padding: 0.5rem 0.75rem;
        border: 1px solid var(--border, #e0e0e0);
        border-radius: var(--radius, 0.375rem);
        font-family: var(--font-sans, system-ui, sans-serif);
        font-size: 0.875rem;
        color: var(--foreground, #1a1a1a);
        background: var(--input, #ffffff);
        transition: all 0.15s ease;
      }

      .relative-number:focus {
        outline: none;
        border-color: var(--ring, #3b82f6);
        box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
      }

      .select-wrapper {
        position: relative;
        flex: 1;
      }

      .select-icon {
        position: absolute;
        right: 0.75rem;
        top: 50%;
        transform: translateY(-50%);
        pointer-events: none;
        display: flex;
        align-items: center;
        color: var(--muted-foreground, #9ca3af);
      }

      .icon {
        width: 1.25rem;
        height: 1.25rem;
      }

      .datetime-select {
        width: 100%;
        padding: 0.5rem 2rem 0.5rem 0.75rem;
        border: 1px solid var(--border, #e0e0e0);
        border-radius: var(--radius, 0.375rem);
        font-family: var(--font-sans, system-ui, sans-serif);
        font-size: 0.875rem;
        color: var(--foreground, #1a1a1a);
        background: var(--input, #ffffff);
        appearance: none;
        cursor: pointer;
        transition: all 0.15s ease;
      }

      .datetime-select:focus {
        outline: none;
        border-color: var(--ring, #3b82f6);
        box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
      }

      .display-value {
        font-size: 0.75rem;
        color: var(--muted-foreground, #9ca3af);
        margin: 0;
      }
    </style>
  </template>
}
