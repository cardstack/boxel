import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';

import PhoneInput from './index.gts';

export default class PhoneInputUsage extends Component {
  @tracked value = '';

  @action onInput(value: string): void {
    this.value = value;
  }

  <template>
    <FreestyleUsage @name='PhoneInput'>
      <:description>
        <p>
          PhoneInput is a component that allows users to input phone numbers
          with a dropdown select of country code and validation of the inputted
          numbers
        </p>
      </:description>
      <:example>
        <PhoneInput @value={{this.value}} @onInput={{this.onInput}} />
      </:example>
    </FreestyleUsage>
  </template>
}
