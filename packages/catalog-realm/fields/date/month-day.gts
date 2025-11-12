import {
  FieldDef,
  Component,
  field,
  contains,
} from 'https://cardstack.com/base/card-api'; // ¹ Core imports
import StringField from 'https://cardstack.com/base/string';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { array, concat } from '@ember/helper';
import { add, lt } from '@cardstack/boxel-ui/helpers'; // ² Helpers
import GiftIcon from '@cardstack/boxel-icons/gift'; // ³ Gift icon
import ChevronDownIcon from '@cardstack/boxel-icons/chevron-down'; // ⁴ Chevron down icon

class MonthDayFieldEdit extends Component<typeof MonthDayField> {
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

  constructor(owner: any, args: any) {
    super(owner, args);
    // ¹¹ Initialize from model or set defaults
    this.month = this.args.model?.month || '01';
    this.day = this.args.model?.day || '01';
  }

  @action
  updateMonth(event: Event) {
    const target = event.target as HTMLSelectElement;
    this.month = target.value;
    this.args.model.month = target.value;
  }

  @action
  updateDay(event: Event) {
    const target = event.target as HTMLSelectElement;
    this.day = target.value;
    this.args.model.day = target.value;
  }

  get displayValue() {
    const monthName = this.months[parseInt(this.month) - 1];
    return `${monthName} ${parseInt(this.day)}`;
  }

  <template>
    <div class='month-day-edit'>
      <div class='month-day-inputs'>
        <div class='select-wrapper month-select'>
          <div class='input-icon'>
            <GiftIcon class='icon' />
          </div>
          <label for='month-select' class='sr-only'>Month</label>
          <select
            id='month-select'
            value={{this.month}}
            {{on 'change' this.updateMonth}}
            class='month-day-select'
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
        <div class='select-wrapper day-select'>
          <label for='day-select' class='sr-only'>Day</label>
          <select
            id='day-select'
            value={{this.day}}
            {{on 'change' this.updateDay}}
            class='month-day-select'
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
            <ChevronDownIcon class='icon' />
          </div>
        </div>
      </div>
      <p class='month-day-display'>Birthday: {{this.displayValue}}</p>
    </div>

    <style scoped>
      .month-day-edit {
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

      .month-day-select {
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

      .month-select .month-day-select {
        padding-left: 2.5rem;
      }

      .month-day-select:focus {
        outline: none;
        border-color: var(--ring, #3b82f6);
        box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
      }

      .month-day-display {
        font-size: 0.75rem;
        color: var(--muted-foreground, #9ca3af);
        margin: 0;
      }

      .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border-width: 0;
      }
    </style>
  </template>
}

// ⁵ MonthDayField - Independent FieldDef for birthdays and anniversaries
export class MonthDayField extends FieldDef {
  static displayName = 'Month-Day';
  static icon = GiftIcon;

  @field month = contains(StringField); // ⁶ Month component (01-12)
  @field day = contains(StringField); // ⁷ Day component (01-31)

  // ⁸ Embedded format - formatted month-day display
  static embedded = class Embedded extends Component<typeof this> {
    get displayValue() {
      const month = this.args.model?.month;
      const day = this.args.model?.day;

      if (!month || !day) return 'No birthday set';

      try {
        const months = [
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
        const monthName = months[parseInt(month) - 1];
        return `${monthName} ${parseInt(day)}`;
      } catch {
        return `${month}-${day}`;
      }
    }

    <template>
      <div class='month-day-embedded' data-test-month-day-embedded>
        <span class='month-day-value'>{{this.displayValue}}</span>
      </div>

      <style scoped>
        .month-day-embedded {
          display: flex;
          align-items: center;
          padding: 0.5rem;
          font-size: 0.875rem;
          color: var(--foreground, #1a1a1a);
        }

        .month-day-value {
          font-weight: 500;
        }
      </style>
    </template>
  };

  // ⁹ Atom format - compact birthday badge
  static atom = class Atom extends Component<typeof this> {
    get displayValue() {
      const month = this.args.model?.month;
      const day = this.args.model?.day;

      if (!month || !day) return 'No date';

      try {
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
        const monthName = months[parseInt(month) - 1];
        return `${monthName} ${parseInt(day)}`;
      } catch {
        return `${month}-${day}`;
      }
    }

    <template>
      <span class='month-day-atom' data-test-month-day-atom>
        <GiftIcon class='month-day-icon' />
        <span class='month-day-value'>{{this.displayValue}}</span>
      </span>

      <style scoped>
        .month-day-atom {
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

        .month-day-icon {
          width: 0.875rem;
          height: 0.875rem;
          flex-shrink: 0;
        }

        .month-day-value {
          white-space: nowrap;
        }
      </style>
    </template>
  };

  // ¹⁰ Edit format - month and day dropdowns
  static edit = MonthDayFieldEdit;
}

export default MonthDayField;
