import { fn } from '@ember/helper';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';

import PhoneInput from './index.gts';

export default class PhoneInputUsage extends Component {
  @tracked value: string | null = null;
  @tracked disabled?: boolean;
  @tracked required?: boolean;
  @tracked placeholder?: string;

  @action handleChange(newValue: string | null): void {
    this.value = newValue;
  }

  <template>
    <FreestyleUsage @name='PhoneInput'>
      <:description>
        <p>
          <code>PhoneInput</code>
          wraps
          <code>BoxelInputGroup</code>
          with client-side parsing and validation for phone numbers. It formats
          detected numbers, surfaces validation feedback on blur, and triggers
          <code>@onChange</code>
          with the sanitized value (E.164 when valid, trimmed digits otherwise),
          and the latest normalization payload.
        </p>
      </:description>
      <:example>
        <PhoneInput
          @value={{this.value}}
          @onChange={{this.handleChange}}
          @disabled={{this.disabled}}
          @placeholder={{this.placeholder}}
          @required={{this.required}}
        />
      </:example>
      <:api as |Args|>
        <Args.String
          @name='value'
          @description='The current value passed to the input'
          @value={{this.value}}
          @onInput={{fn (mut this.value)}}
          @optional={{true}}
        />
        <Args.Action
          @name='onChange'
          @description='Receives (value, validation, event): value is the sanitized string or null, and validation is the latest NormalizePhoneFormatResult (or null)'
        />
        <Args.String
          @name='placeholder'
          @description='Empty input placeholder'
          @value={{this.placeholder}}
          @onInput={{fn (mut this.placeholder)}}
        />
        <Args.Bool
          @name='disabled'
          @value={{this.disabled}}
          @onInput={{fn (mut this.disabled)}}
        />
        <Args.Bool
          @name='required'
          @value={{this.required}}
          @onInput={{fn (mut this.required)}}
        />
      </:api>
    </FreestyleUsage>
  </template>
}
