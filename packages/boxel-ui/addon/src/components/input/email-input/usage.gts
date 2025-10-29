import { fn } from '@ember/helper';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';

import EmailInput from './index.gts';

export default class EmailInputUsage extends Component {
  @tracked value: string | null = 'johnsmith@email.com';
  @tracked disabled = false;
  @tracked required = false;
  @tracked placeholder?: string;
  @tracked fallbackErrorMessage?: string;

  @action handleChange(newValue: string | null): void {
    this.value = newValue;
  }

  <template>
    <FreestyleUsage @name='EmailInput'>
      <:description>
        <p>
          <code>EmailInput</code>
          wraps
          <code>BoxelInput</code>
          with lightweight validation logic for email addresses. Valid values
          are committed via
          <code>@onChange</code>; invalid input leaves the nested field in place
          and surfaces descriptive error text.
        </p>
      </:description>
      <:example>
        <EmailInput
          @value={{this.value}}
          @onChange={{this.handleChange}}
          @disabled={{this.disabled}}
          @placeholder={{this.placeholder}}
          @required={{this.required}}
          @fallbackErrorMessage={{this.fallbackErrorMessage}}
        />
      </:example>
      <:api as |Args|>
        <Args.String
          @name='value'
          @description='The current value passed to the input'
          @value={{this.value}}
          @onInput={{this.handleChange}}
          @optional={{true}}
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
        <Args.String
          @name='placeholder'
          @description='Empty input placeholder'
          @value={{this.placeholder}}
          @onInput={{fn (mut this.placeholder)}}
          @defaultValue='Enter email'
        />
        <Args.String
          @name='fallbackErrorMessage'
          @description='Message shown when native validity text is unavailable'
          @value={{this.fallbackErrorMessage}}
          @onInput={{fn (mut this.fallbackErrorMessage)}}
          @defaultValue='Enter a valid email address'
        />
        <Args.Action
          @name='onChange'
          @description='Called with the committed value (string) or null when invalid'
        />
      </:api>
    </FreestyleUsage>
  </template>
}
