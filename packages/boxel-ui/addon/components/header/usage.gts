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
  @tracked iconURL =
    'https://ipfs.io/ipfs/QmQJ4AYtLLvi1kiVWWM2n8zisJaeWCb53XHCywLSAiF5nP';

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
          @iconURL={{this.iconURL}}
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
          @name='icon URL'
          @description='Header icon URL'
          @value={{this.iconURL}}
          @onInput={{fn (mut this.iconURL)}}
        />
        <Args.Yield @description='Content' />
      </:api>
    </FreestyleUsage>
  </template>
}
