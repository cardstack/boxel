import {
  FieldDef,
  Component,
  field,
  contains,
  StringField,
} from '@cardstack/base/card-api';
import NumberField from '@cardstack/base/number';
import { BoxelInput, BoxelSelect } from '@cardstack/boxel-ui/components';
import { not } from '@cardstack/boxel-ui/helpers';
import ClockIcon from '@cardstack/boxel-icons/clock';

import {
  DURATION_UNITS,
  durationAtomLabel,
  durationLabel,
  type DurationUnit,
} from './utils/index';

export class DurationField extends FieldDef {
  static displayName = 'Duration';
  static icon = ClockIcon;

  @field value = contains(NumberField);
  @field unit = contains(StringField, {
    description: 'One of: minutes, hours, days, weeks, months',
  });

  @field label = contains(StringField, {
    computeVia: function (this: DurationField) {
      return durationLabel(this.value, this.unit);
    },
  });

  static edit = class Edit extends Component<typeof this> {
    units = DURATION_UNITS;

    get selectedUnit(): DurationUnit {
      return (this.args.model.unit as DurationUnit) ?? 'days';
    }

    setValue = (val: string) => {
      let parsed = parseFloat(val);
      this.args.model.value = Number.isFinite(parsed) ? parsed : undefined;
      if (!this.args.model.unit) {
        this.args.model.unit = 'days';
      }
    };

    setUnit = (unit: DurationUnit) => {
      this.args.model.unit = unit;
    };

    <template>
      <div class='duration-edit'>
        <BoxelInput
          class='duration-value'
          @type='number'
          @value={{@model.value}}
          @onInput={{this.setValue}}
          @disabled={{not @canEdit}}
        />
        <BoxelSelect
          class='duration-unit'
          @options={{this.units}}
          @selected={{this.selectedUnit}}
          @onChange={{this.setUnit}}
          @disabled={{not @canEdit}}
          as |unit|
        >
          {{unit}}
        </BoxelSelect>
      </div>
      <style scoped>
        .duration-edit {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-xs);
        }
        .duration-value {
          max-width: 8rem;
        }
        .duration-unit {
          min-width: 7rem;
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    get label() {
      return durationLabel(this.args.model.value, this.args.model.unit);
    }

    <template>
      <span class='duration-pill'>
        <ClockIcon class='duration-icon' role='presentation' />
        {{this.label}}
      </span>
      <style scoped>
        .duration-pill {
          display: inline-flex;
          align-items: center;
          gap: var(--boxel-sp-4xs);
          padding: var(--boxel-sp-5xs) var(--boxel-sp-xs);
          border-radius: var(--boxel-border-radius-sm);
          border: 1px solid var(--border, var(--boxel-200));
          background: var(--muted, var(--boxel-100));
          color: var(--foreground, var(--boxel-dark));
          font-weight: 500;
          font-size: var(--boxel-font-size-sm);
          line-height: 1.2;
        }
        .duration-icon {
          width: 0.875em;
          height: 0.875em;
          flex: none;
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof this> {
    get label() {
      return durationAtomLabel(this.args.model.value, this.args.model.unit);
    }

    <template>
      <span class='duration-atom'>{{this.label}}</span>
      <style scoped>
        .duration-atom {
          font-weight: 600;
          font-size: var(--boxel-font-size-xs);
          line-height: 1;
          color: var(--muted-foreground, var(--boxel-450));
        }
      </style>
    </template>
  };
}
