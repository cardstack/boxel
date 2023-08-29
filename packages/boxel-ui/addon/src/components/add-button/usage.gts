import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';

import BoxelAddButton from './index';

export default class AddButtonUsage extends Component {
  @tracked variant?: 'full-width';

  @action log(message: string): void {
    // eslint-disable-next-line no-console
    console.log(message);
  }

  <template>
    <FreestyleUsage @name='AddButton'>
      <:example>
        <BoxelAddButton
          @variant={{this.variant}}
          {{on 'click' (fn this.log 'button clicked')}}
        >
          Add new item
        </BoxelAddButton>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='variant'
          @optional={{true}}
          @options={{Array 'default' 'full-width'}}
          @onInput={{fn (mut this.variant)}}
          @value={{this.variant}}
        />
      </:api>
    </FreestyleUsage>
  </template>
}
