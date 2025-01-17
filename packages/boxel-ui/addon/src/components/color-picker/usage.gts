import { fn } from '@ember/helper';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';

import ColorPicker from './index.gts';

export default class ColorPickerUsage extends Component {
  @tracked color = '';
  @tracked disabled = false;
  @tracked showHexString = true;

  private onChange = (newColor: string) => {
    this.color = newColor;
  };

  <template>
    <FreestyleUsage
      @name='ColorPicker'
      @description='A color picker that allows users to select a color from the color spectrum.'
    >
      <:example>
        <ColorPicker
          @color={{this.color}}
          @onChange={{this.onChange}}
          @showHexString={{this.showHexString}}
          @disabled={{this.disabled}}
        />
      </:example>

      <:api as |Args|>
        <Args.String
          @name='color'
          @optional={{false}}
          @description='Hex color value.'
          @value={{this.color}}
          @onInput={{fn (mut this.color)}}
        />
        <Args.Action
          @name='onChange'
          @description='A callback function that is called when the color is changed.'
          @value={{this.onChange}}
          @onInput={{fn (mut this.onChange)}}
        />
        <Args.Bool
          @name='disabled'
          @description='Whether the color picker is disabled.'
          @value={{this.disabled}}
          @onInput={{fn (mut this.disabled)}}
          @defaultValue={{false}}
        />
        <Args.Bool
          @name='showHexString'
          @description='Whether to show the hex color value next to the picker.'
          @value={{this.showHexString}}
          @onInput={{fn (mut this.showHexString)}}
          @defaultValue={{true}}
        />
      </:api>
    </FreestyleUsage>
  </template>
}
