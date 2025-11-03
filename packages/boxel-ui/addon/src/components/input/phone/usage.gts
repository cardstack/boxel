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
          <code>BoxelInput</code>
          with client-side validation for phone numbers. Input values are
          committed via
          <code>@onChange</code>, which also passes along the current validation
          error object (or
          <code>null</code>); invalid input surfaces a descriptive error message
          on blur.
        </p>
      </:description>
      <:example>
        <PhoneInput
          @value={{this.value}}
          @onChange={{fn (mut this.value)}}
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
          @description='Called with input (string, or null if empty) when not invalid'
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
