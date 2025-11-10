// ═══ [EDIT TRACKING: ON] Mark all changes with ⁿ ═══
import {
  FieldDef,
  Component,
  field,
  contains,
} from 'https://cardstack.com/base/card-api'; // ¹ Core imports
import NumberField from 'https://cardstack.com/base/number';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import HourglassIcon from '@cardstack/boxel-icons/hourglass'; // ² Hourglass icon

class DurationFieldEdit extends Component<typeof DurationField> {
  @tracked hours = 0;
  @tracked minutes = 0;
  @tracked seconds = 0;
  @tracked validationError = '';

  constructor(owner: any, args: any) {
    super(owner, args);
    // ¹⁰ Initialize from model or set defaults
    this.hours = this.args.model?.hours ?? 0;
    this.minutes = this.args.model?.minutes ?? 0;
    this.seconds = this.args.model?.seconds ?? 0;
  }

  @action
  updateHours(event: Event) {
    const target = event.target as HTMLInputElement;
    const value = parseInt(target.value);

    // ¹¹ Validate hours (0 or greater)
    if (isNaN(value) || value < 0) {
      this.validationError = 'Hours must be 0 or greater';
      return;
    }

    this.hours = value;
    this.validationError = '';
    this.args.model.hours = value;
  }

  @action
  updateMinutes(event: Event) {
    const target = event.target as HTMLInputElement;
    const value = parseInt(target.value);

    // ¹² Validate minutes (0-59)
    if (isNaN(value) || value < 0 || value > 59) {
      this.validationError = 'Minutes must be between 0-59';
      return;
    }

    this.minutes = value;
    this.validationError = '';
    this.args.model.minutes = value;
  }

  @action
  updateSeconds(event: Event) {
    const target = event.target as HTMLInputElement;
    const value = parseInt(target.value);

    // ¹³ Validate seconds (0-59)
    if (isNaN(value) || value < 0 || value > 59) {
      this.validationError = 'Seconds must be between 0-59';
      return;
    }

    this.seconds = value;
    this.validationError = '';
    this.args.model.seconds = value;
  }

  get totalMinutes() {
    return (this.hours * 60 + this.minutes + this.seconds / 60).toFixed(1);
  }

  get totalSeconds() {
    return this.hours * 3600 + this.minutes * 60 + this.seconds;
  }

  <template>
    <div class='duration-edit'>
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
          <label for='duration-hours' class='input-label'>Hours</label>
          <input
            id='duration-hours'
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
          <label for='duration-minutes' class='input-label'>Minutes</label>
          <input
            id='duration-minutes'
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
          <label for='duration-seconds' class='input-label'>Seconds</label>
          <input
            id='duration-seconds'
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
      .duration-edit {
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

// ³ DurationField - Independent FieldDef for time spans
export class DurationField extends FieldDef {
  static displayName = 'Duration';
  static icon = HourglassIcon;

  @field hours = contains(NumberField); // ⁴ Hours component
  @field minutes = contains(NumberField); // ⁵ Minutes component
  @field seconds = contains(NumberField); // ⁶ Seconds component

  // ⁷ Embedded format - formatted duration display
  static embedded = class Embedded extends Component<typeof this> {
    get displayValue() {
      const h = this.args.model?.hours ?? 0;
      const m = this.args.model?.minutes ?? 0;
      const s = this.args.model?.seconds ?? 0;

      if (h === 0 && m === 0 && s === 0) return 'No duration set';

      const parts = [];
      if (h > 0) parts.push(`${h}h`);
      if (m > 0) parts.push(`${m}m`);
      if (s > 0) parts.push(`${s}s`);

      return parts.join(' ');
    }

    <template>
      <div class='duration-embedded' data-test-duration-embedded>
        <span class='duration-value'>{{this.displayValue}}</span>
      </div>

      <style scoped>
        .duration-embedded {
          display: flex;
          align-items: center;
          padding: 0.5rem;
          font-size: 0.875rem;
          color: var(--foreground, #1a1a1a);
        }

        .duration-value {
          font-weight: 500;
        }
      </style>
    </template>
  };

  // ⁸ Atom format - compact duration badge
  static atom = class Atom extends Component<typeof this> {
    get displayValue() {
      const h = this.args.model?.hours ?? 0;
      const m = this.args.model?.minutes ?? 0;
      const s = this.args.model?.seconds ?? 0;

      if (h === 0 && m === 0 && s === 0) return '0s';

      const parts = [];
      if (h > 0) parts.push(`${h}h`);
      if (m > 0) parts.push(`${m}m`);
      if (s > 0) parts.push(`${s}s`);

      return parts.join(' ');
    }

    <template>
      <span class='duration-atom' data-test-duration-atom>
        <HourglassIcon class='duration-icon' />
        <span class='duration-value'>{{this.displayValue}}</span>
      </span>

      <style scoped>
        .duration-atom {
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

        .duration-icon {
          width: 0.875rem;
          height: 0.875rem;
          flex-shrink: 0;
        }

        .duration-value {
          white-space: nowrap;
        }
      </style>
    </template>
  };

  // ⁹ Edit format - hours/minutes/seconds inputs with validation
  static edit = DurationFieldEdit;
}

export default DurationField;
