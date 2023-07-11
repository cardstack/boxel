import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';
import BoxelHeader from './index';
import BoxelButton from '../button';
import { fn } from '@ember/helper';

export default class HeaderUsage extends Component {
  @tracked title = 'Header';
  @tracked hasBackground = true;
  @tracked isHighlighted = false;
  @tracked icon = {
    URL: '',
  };

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
          @icon={{this.icon}}
        >
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
        <Args.String
          @name='icon.URL'
          @description='Header icon URL'
          @value={{this.icon.URL}}
          @onInput={{fn (mut this.icon.URL)}}
        />
        <Args.Yield @description='Content' />
      </:api>
    </FreestyleUsage>
  </template>
}
