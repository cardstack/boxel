import { fn } from '@ember/helper';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';

import BoxelButton from '../button';
import BoxelHeader from './index';

export default class HeaderUsage extends Component {
  @tracked title = 'Header';
  @tracked hasBackground = true;
  @tracked isHighlighted = false;

  <template>
    <FreestyleUsage @name='Header'>
      <:description>
        Usually shown at the top of card containers
      </:description>
      <:example>
        <BoxelHeader
          @title={{this.title}}
          @hasBackground={{this.hasBackground}}
          @isHighlighted={{this.isHighlighted}}
        >
          <:icon>
            🌏
          </:icon>
          <:actions>
            <BoxelButton>Edit</BoxelButton>
          </:actions>
        </BoxelHeader>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='title'
          @description='Header label text'
          @value={{this.title}}
          @onInput={{fn (mut this.title)}}
        />
        <Args.Bool
          @name='hasBackground'
          @description='(styling) Adds background color'
          @defaultValue={{false}}
          @value={{this.hasBackground}}
          @onInput={{fn (mut this.hasBackground)}}
        />
        <Args.Bool
          @name='isHighlighted'
          @description='(styling) Highlights header'
          @defaultValue={{false}}
          @value={{this.isHighlighted}}
          @onInput={{fn (mut this.isHighlighted)}}
        />
        <Args.Yield
          @name='icon'
          @description='Content for the icon of the header'
        />
        <Args.Yield @description='Content' />
      </:api>
    </FreestyleUsage>
  </template>
}
