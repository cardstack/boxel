import {
  FieldDef,
  Component,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';
import NumberField from 'https://cardstack.com/base/number';
import { tracked } from '@glimmer/tracking';
import HourglassIcon from '@cardstack/boxel-icons/hourglass';
import AlertCircleIcon from '@cardstack/boxel-icons/alert-circle';

interface DurationConfiguration {
  includeYears?: boolean;
  includeMonths?: boolean;
  includeDays?: boolean;
  includeHours?: boolean;
  includeMinutes?: boolean;
  includeSeconds?: boolean;
}

class DurationFieldEdit extends Component<typeof DurationField> {
  @tracked validationError = '';

  get config(): DurationConfiguration | undefined {
    return this.args.configuration as DurationConfiguration | undefined;
  }

  get showYears() {
    return this.config?.includeYears ?? false;
  }

  get showMonths() {
    return this.config?.includeMonths ?? false;
  }

  get showDays() {
    return this.config?.includeDays ?? false;
  }

  get showHours() {
    return this.config?.includeHours ?? true;
  }

  get showMinutes() {
    return this.config?.includeMinutes ?? true;
  }

  get showSeconds() {
    return this.config?.includeSeconds ?? true;
  }

  <template>
    <div class='duration-edit'>
      {{#if this.validationError}}
        <div class='validation-error' data-test-validation-error>
          <AlertCircleIcon class='error-icon' />
          {{this.validationError}}
        </div>
      {{/if}}
      <div class='duration-chips'>
        {{#if this.showYears}}
          <div class='duration-chip'>
            <label class='chip-label'>Years</label>
            <@fields.years @format='edit' />
          </div>
        {{/if}}
        {{#if this.showMonths}}
          <div class='duration-chip'>
            <label class='chip-label'>Months</label>
            <@fields.months @format='edit' />
          </div>
        {{/if}}
        {{#if this.showDays}}
          <div class='duration-chip'>
            <label class='chip-label'>Days</label>
            <@fields.days @format='edit' />
          </div>
        {{/if}}
        {{#if this.showHours}}
          <div class='duration-chip'>
            <label class='chip-label'>Hours</label>
            <@fields.hours @format='edit' />
          </div>
        {{/if}}
        {{#if this.showMinutes}}
          <div class='duration-chip'>
            <label class='chip-label'>Minutes</label>
            <@fields.minutes @format='edit' />
          </div>
        {{/if}}
        {{#if this.showSeconds}}
          <div class='duration-chip'>
            <label class='chip-label'>Seconds</label>
            <@fields.seconds @format='edit' />
          </div>
        {{/if}}
      </div>
    </div>

    <style scoped>
      .duration-edit {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }

      .duration-chips {
        display: flex;
        align-items: stretch;
        gap: 0.5rem;
        flex-wrap: wrap;
      }

      .duration-chip {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
        padding: 0.625rem 0.75rem;
        background: var(--muted, #f8fafc);
        border: 1px solid var(--border, #e2e8f0);
        border-radius: var(--radius, 0.5rem);
        min-width: 85px;
        flex: 0 1 auto;
        transition: all 0.2s ease;
      }

      .duration-chip:hover {
        border-color: var(--ring, #cbd5e1);
        background: var(--card, #ffffff);
      }

      .duration-chip:focus-within {
        border-color: var(--primary, #3b82f6);
        box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
      }

      .chip-label {
        font-size: 0.75rem;
        font-weight: 500;
        color: var(--muted-foreground, #64748b);
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
    </style>
  </template>
}

export class DurationField extends FieldDef {
  static displayName = 'Duration';
  static icon = HourglassIcon;

  @field years = contains(NumberField);
  @field months = contains(NumberField);
  @field days = contains(NumberField);
  @field hours = contains(NumberField);
  @field minutes = contains(NumberField);
  @field seconds = contains(NumberField);

  static embedded = class Embedded extends Component<typeof this> {
    get config(): DurationConfiguration | undefined {
      return this.args.configuration as DurationConfiguration | undefined;
    }

    get displayValue() {
      const y = this.args.model?.years ?? 0;
      const mo = this.args.model?.months ?? 0;
      const d = this.args.model?.days ?? 0;
      const h = this.args.model?.hours ?? 0;
      const m = this.args.model?.minutes ?? 0;
      const s = this.args.model?.seconds ?? 0;

      const showYears = this.config?.includeYears ?? false;
      const showMonths = this.config?.includeMonths ?? false;
      const showDays = this.config?.includeDays ?? false;
      const showHours = this.config?.includeHours ?? true;
      const showMinutes = this.config?.includeMinutes ?? true;
      const showSeconds = this.config?.includeSeconds ?? true;

      if (y === 0 && mo === 0 && d === 0 && h === 0 && m === 0 && s === 0) {
        return 'No duration set';
      }

      const parts = [];
      if (showYears && y > 0) parts.push(`${y}y`);
      if (showMonths && mo > 0) parts.push(`${mo}mo`);
      if (showDays && d > 0) parts.push(`${d}d`);
      if (showHours && h > 0) parts.push(`${h}h`);
      if (showMinutes && m > 0) parts.push(`${m}m`);
      if (showSeconds && s > 0) parts.push(`${s}s`);

      return parts.length > 0 ? parts.join(' ') : 'No duration set';
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

  static atom = class Atom extends Component<typeof this> {
    get config(): DurationConfiguration | undefined {
      return this.args.configuration as DurationConfiguration | undefined;
    }

    get displayValue() {
      const y = this.args.model?.years ?? 0;
      const mo = this.args.model?.months ?? 0;
      const d = this.args.model?.days ?? 0;
      const h = this.args.model?.hours ?? 0;
      const m = this.args.model?.minutes ?? 0;
      const s = this.args.model?.seconds ?? 0;

      const showYears = this.config?.includeYears ?? false;
      const showMonths = this.config?.includeMonths ?? false;
      const showDays = this.config?.includeDays ?? false;
      const showHours = this.config?.includeHours ?? true;
      const showMinutes = this.config?.includeMinutes ?? true;
      const showSeconds = this.config?.includeSeconds ?? true;

      if (y === 0 && mo === 0 && d === 0 && h === 0 && m === 0 && s === 0) {
        return '0s';
      }

      const parts = [];
      if (showYears && y > 0) parts.push(`${y}y`);
      if (showMonths && mo > 0) parts.push(`${mo}mo`);
      if (showDays && d > 0) parts.push(`${d}d`);
      if (showHours && h > 0) parts.push(`${h}h`);
      if (showMinutes && m > 0) parts.push(`${m}m`);
      if (showSeconds && s > 0) parts.push(`${s}s`);

      return parts.length > 0 ? parts.join(' ') : '0s';
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

  static edit = DurationFieldEdit;
}

export default DurationField;
