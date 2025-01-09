import { fn } from '@ember/helper';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';

import ColorPalette from './index.gts';

export default class ColorPaletteUsage extends Component {
  @tracked color = '#000000';

  private handleColorChange = (newColor: string) => {
    this.color = newColor;
  };

  <template>
    <FreestyleUsage
      @name='ColorPalette'
      @description='A color palette component that provides a set of predefined colors and a custom color picker.'
    >
      <:example>
        <ColorPalette
          @color={{this.color}}
          @onChange={{this.handleColorChange}}
        />
      </:example>

      <:api as |Args|>
        <Args.String
          @name='color'
          @optional={{false}}
          @description='Currently selected color in hex format.'
          @value={{this.color}}
          @onInput={{fn (mut this.color)}}
          @defaultValue='#000000'
        />
        <Args.Action
          @name='onChange'
          @description='Callback function that receives the newly selected color value.'
          @value={{this.handleColorChange}}
          @onInput={{fn (mut this.handleColorChange)}}
        />
      </:api>
    </FreestyleUsage>
  </template>
}
