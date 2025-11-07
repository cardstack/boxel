import { Component } from 'https://cardstack.com/base/card-api';
import BaseNumberField, {
  deserializeForUI,
  serializeForUI,
} from 'https://cardstack.com/base/number';
import { TextInputValidator } from 'https://cardstack.com/base/text-input-validator';
import { NumberSerializer } from '@cardstack/runtime-common';
import { BoxelInput } from '@cardstack/boxel-ui/components';
import HashIcon from '@cardstack/boxel-icons/hash';
import {
  hasValue,
  getFieldClass,
  registerFieldType,
  getFormattedDisplayValue,
} from './number/util/index';

// Import and register all specialized fields
import SliderField from './number/slider';
import RatingField from './number/rating';
import QuantityField from './number/quantity';
import PercentageField from './number/percentage';
import StatField from './number/stat';
import BadgeField from './number/badge';
import ScoresField from './number/scores';
import ProgressBarField from './number/progress-bar';
import ProgressCircleField from './number/progress-circle';
import GaugeField from './number/gauge';

// Register all field types
registerFieldType('slider', SliderField);
registerFieldType('rating', RatingField);
registerFieldType('quantity', QuantityField);
registerFieldType('percentage', PercentageField);
registerFieldType('stat', StatField);
registerFieldType('badge', BadgeField);
registerFieldType('scores', ScoresField);
registerFieldType('progress-bar', ProgressBarField);
registerFieldType('progress-circle', ProgressCircleField);
registerFieldType('gauge', GaugeField);

export default class NumberField extends BaseNumberField {
  static displayName = 'Number Field';
  static icon = HashIcon;

  static edit = class Edit extends Component<typeof this> {
    get config() {
      return this.args.configuration?.presentation ?? {};
    }

    get delegatedFieldClass() {
      return this.config.type ? getFieldClass(this.config.type) : null;
    }

    get inputValue() {
      // Return null for empty input, otherwise the numeric value
      return hasValue(this.args.model) ? this.args.model : null;
    }

    handleInputChange = (value: string) => {
      // Handle empty input by setting to null
      if (value === '' || value === null || value === undefined) {
        this.args.set(null);
        return;
      }
      let num = parseFloat(value);
      if (!isNaN(num)) {
        this.args.set(num);
      }
    };

    <template>
      {{#if this.delegatedFieldClass}}
        {{#let this.delegatedFieldClass.edit as |DelegatedEdit|}}
          <DelegatedEdit
            @model={{@model}}
            @set={{@set}}
            @configuration={{@configuration}}
          />
        {{/let}}
      {{else}}
        <BoxelInput
          @type='number'
          @value={{this.inputValue}}
          @onInput={{this.handleInputChange}}
        />
      {{/if}}
    </template>

    textInputValidator: TextInputValidator<number> = new TextInputValidator(
      () => this.args.model,
      (inputVal) => this.args.set(inputVal),
      deserializeForUI,
      serializeForUI,
      NumberSerializer.validate,
    );
  };

  static atom = class Atom extends Component<typeof this> {
    get config() {
      return this.args.configuration?.presentation ?? {};
    }

    get delegatedFieldClass() {
      return this.config.type ? getFieldClass(this.config.type) : null;
    }

    get displayValue() {
      return getFormattedDisplayValue(this.args.model, this.config);
    }

    <template>
      {{#if this.delegatedFieldClass}}
        {{#let this.delegatedFieldClass.atom as |DelegatedAtom|}}
          <DelegatedAtom @model={{@model}} @configuration={{@configuration}} />
        {{/let}}
      {{else}}
        <span class='number-field-atom'>{{this.displayValue}}</span>

      {{/if}}
      <style scoped>
        .number-field-atom {
          display: inline-flex;
          align-items: baseline;
          gap: 0.125rem;
          font-size: 0.875rem;
          font-weight: 600;
          color: var(--foreground, var(--boxel-dark));
          font-family: var(--font-mono, monospace);
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    get config() {
      return this.args.configuration?.presentation ?? {};
    }

    get delegatedFieldClass() {
      return this.config.type ? getFieldClass(this.config.type) : null;
    }

    get displayValue() {
      return getFormattedDisplayValue(this.args.model, this.config);
    }

    <template>
      {{#if this.delegatedFieldClass}}
        {{#let this.delegatedFieldClass.embedded as |DelegatedEmbedded|}}
          <DelegatedEmbedded
            @model={{@model}}
            @configuration={{@configuration}}
          />
        {{/let}}
      {{else}}
        <span class='number-field-embedded'>{{this.displayValue}}</span>

      {{/if}}
      <style scoped>
        .number-field-embedded {
          display: inline-flex;
          font-family: monospace;
          font-weight: 600;
          color: var(--primary, var(--boxel-purple));
          font-size: 1.125rem;
        }
      </style>
    </template>
  };
}
