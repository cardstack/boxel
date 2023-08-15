import Component from '@glimmer/component';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';
import BoxelAddButton from './index';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';

export default class AddButtonUsage extends Component {
  @action log(message: string): void {
    // eslint-disable-next-line no-console
    console.log(message);
  }

  <template>
    <FreestyleUsage @name='AddButton'>
      <:example>
        <BoxelAddButton {{on 'click' (fn this.log 'button clicked')}} />
      </:example>
    </FreestyleUsage>
  </template>
}
