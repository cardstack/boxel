import { fn } from '@ember/helper';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';

import Swatch from './index.gts';

export default class SwatchUsage extends Component {
  private swatchStyles = ['default', 'round'];
  @tracked private color?: string = '#AC00FF';
  @tracked private label?: string;
  @tracked private hideLabel?: boolean;
  @tracked private style?: 'round' | 'default';

  <template>
    <FreestyleUsage @name='Swatch'>
      <:example>
        <Swatch
          @color={{this.color}}
          @label={{this.label}}
          @hideLabel={{this.hideLabel}}
          @style={{this.style}}
        />
      </:example>
      <:api as |Args|>
        <Args.String
          @name='color'
          @defaultValue={{null}}
          @onInput={{fn (mut this.color)}}
          @value={{this.color}}
        />
        <Args.String
          @name='label'
          @description='optional additional label'
          @defaultValue={{null}}
          @onInput={{fn (mut this.label)}}
          @value={{this.label}}
        />
        <Args.Bool
          @name='hideLabel'
          @optional={{true}}
          @defaultValue={{false}}
          @onInput={{fn (mut this.hideLabel)}}
          @value={{this.hideLabel}}
        />
        <Args.String
          @name='style'
          @description='round or default'
          @options={{this.swatchStyles}}
          @onInput={{fn (mut this.style)}}
          @value={{this.style}}
          @defaultValue=''
        />
      </:api>
    </FreestyleUsage>
  </template>
}
