import { Component } from 'https://cardstack.com/base/card-api';
import BaseNumberField, {
  deserializeForUI,
  serializeForUI,
} from 'https://cardstack.com/base/number';
import { TextInputValidator } from 'https://cardstack.com/base/text-input-validator';
import { NumberSerializer } from '@cardstack/runtime-common';
import { getFieldClass } from './number/util/index';

import NumberInput from './number/components/number-input';
import HashIcon from '@cardstack/boxel-icons/hash';

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
        <NumberInput
          @value={{@model}}
          @config={{this.config}}
          @onChange={{@set}}
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
      return this.args.model ?? 0;
    }

    <template>
      {{#if this.delegatedFieldClass}}
        {{#let this.delegatedFieldClass.atom as |DelegatedAtom|}}
          <DelegatedAtom @model={{@model}} @configuration={{@configuration}} />
        {{/let}}
      {{else}}
        <span
          class='number-field-atom'
          data-test-number-field-atom
        >{{this.displayValue}}</span>

      {{/if}}
      <style scoped>
        .number-field-atom {
          display: inline-flex;
          align-items: baseline;
          gap: 0.125rem;
          font-size: 0.875rem;
          font-weight: 600;
          color: var(--foreground, var(--boxel-dark));
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
      return this.args.model ?? 0;
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
        <span
          class='number-field-embedded'
          data-test-number-field-embedded
        >{{this.displayValue}}</span>

      {{/if}}
      <style scoped>
        .number-field-embedded {
          display: inline-flex;
          font-weight: 600;
          color: var(--primary, var(--boxel-purple));
          font-size: 1.125rem;
        }
      </style>
    </template>
  };
}
