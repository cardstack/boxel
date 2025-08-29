import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';

import BoxelAddButton from './index.gts';

export default class AddButtonUsage extends Component {
  @tracked loading = false;
  @tracked iconWidth?: string;
  @tracked iconHeight?: string;

  @action log(message: string): void {
    console.log(message);
  }

  <template>
    <FreestyleUsage @name='AddButton'>
      <:example>
        <BoxelAddButton
          {{on 'click' (fn this.log 'button clicked')}}
          @iconWidth={{this.iconWidth}}
          @iconHeight={{this.iconHeight}}
          @loading={{this.loading}}
        />
      </:example>
      <:api as |Args|>
        <Args.String
          @name='iconWidth'
          @defaultValue='40px'
          @optional={{true}}
          @onInput={{fn (mut this.iconWidth)}}
          @value={{this.iconWidth}}
        />
        <Args.String
          @name='iconHeight'
          @defaultValue='40px'
          @optional={{true}}
          @onInput={{fn (mut this.iconHeight)}}
          @value={{this.iconHeight}}
        />
        <Args.Bool
          @name='loading'
          @defaultValue={{false}}
          @optional={{true}}
          @onInput={{fn (mut this.loading)}}
          @value={{this.loading}}
        />
      </:api>
    </FreestyleUsage>
  </template>
}
