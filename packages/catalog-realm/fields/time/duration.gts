// ═══ [EDIT TRACKING: ON] Mark all changes with ⁿ ═══
import {
  FieldDef,
  Component,
  field,
  contains,
} from 'https://cardstack.com/base/card-api'; // ¹ Core imports
import NumberField from 'https://cardstack.com/base/number';
import { tracked } from '@glimmer/tracking';
import HourglassIcon from '@cardstack/boxel-icons/hourglass'; // ² Hourglass icon
import AlertCircleIcon from '@cardstack/boxel-icons/alert-circle';

class DurationFieldEdit extends Component<typeof DurationField> {
  @tracked validationError = '';

  get totalMinutes() {
    const h = this.args.model?.hours ?? 0;
    const m = this.args.model?.minutes ?? 0;
    const s = this.args.model?.seconds ?? 0;
    return (h * 60 + m + s / 60).toFixed(1);
  }

  get totalSeconds() {
    const h = this.args.model?.hours ?? 0;
    const m = this.args.model?.minutes ?? 0;
    const s = this.args.model?.seconds ?? 0;
    return h * 3600 + m * 60 + s;
  }

  <template>
    <div class='duration-edit'>
      {{#if this.validationError}}
        <div class='validation-error' data-test-validation-error>
          <AlertCircleIcon class='error-icon' />
          {{this.validationError}}
        </div>
      {{/if}}
      <div class='duration-inputs'>
        <div class='duration-field'>
          <label class='input-label'>Hours</label>
          <@fields.hours @format='edit' />
        </div>
        <span class='duration-separator'>:</span>
        <div class='duration-field'>
          <label class='input-label'>Minutes</label>
          <@fields.minutes @format='edit' />
        </div>
        <span class='duration-separator'>:</span>
        <div class='duration-field'>
          <label class='input-label'>Seconds</label>
          <@fields.seconds @format='edit' />
        </div>
      </div>
      <div class='duration-info'>
        <span class='info-text'>Total:
          {{@model.hours}}h
          {{@model.minutes}}m
          {{@model.seconds}}s</span>
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
