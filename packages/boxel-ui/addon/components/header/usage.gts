import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';
import BoxelHeader from './index';
import { fn } from '@ember/helper';

export default class HeaderUsage extends Component {
  @tracked header = 'Header';
  @tracked noBackground = false;
  @tracked isHighlighted = false;

  <template>
    <FreestyleUsage @name='Header'>
      <:description>
        Usually shown at the top of card containers
      </:description>
      <:example>
        <BoxelHeader
          @header={{this.header}}
          @noBackground={{this.noBackground}}
          @isHighlighted={{this.isHighlighted}}
        >
          <:actions>
            <button>Edit</button>
          </:actions>
        </BoxelHeader>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='header'
          @description='Header label text'
          @value={{this.header}}
          @onInput={{fn (mut this.header)}}
        />
        <Args.Bool
          @name='noBackground'
          @description='(styling) Removes background color'
          @defaultValue={{false}}
          @value={{this.noBackground}}
          @onInput={{fn (mut this.noBackground)}}
        />
        <Args.Bool
          @name='isHighlighted'
          @description='(styling) Highlights header'
          @defaultValue={{false}}
          @value={{this.isHighlighted}}
          @onInput={{fn (mut this.isHighlighted)}}
        />
        <Args.Yield @description='Content' />
      </:api>
    </FreestyleUsage>
  </template>
}
