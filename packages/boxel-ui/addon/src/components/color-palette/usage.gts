import { fn } from '@ember/helper';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';

import ColorPalette, { DEFAULT_PALETTE_COLORS } from './index.gts';

export default class ColorPaletteUsage extends Component {
  @tracked private color: string | null = null;
  @tracked private paletteColors?: string[];
  @tracked private disabled?: boolean;

  private handleColorChange = (newColor: string | null) => {
    if (this.color === newColor) {
      this.color = null;
    } else {
      this.color = newColor;
    }
  };

  <template>
    <FreestyleUsage
      @name='ColorPalette'
      @description='A color palette component that provides predefined colors and a custom color input.'
    >
      <:example>
        <ColorPalette
          @color={{this.color}}
          @onChange={{this.handleColorChange}}
          @paletteColors={{this.paletteColors}}
          @disabled={{this.disabled}}
        />
      </:example>

      <:api as |Args|>
        <Args.String
          @name='color'
          @optional={{false}}
          @description='Currently selected color.'
          @value={{this.color}}
          @onInput={{fn (mut this.color)}}
        />
        <Args.Action
          @name='onChange'
          @description='Callback function that receives the newly selected color value.'
          @value={{this.handleColorChange}}
          @onInput={{fn (mut this.handleColorChange)}}
        />
        <Args.Bool
          @name='disabled'
          @description='Selection is disabled'
          @value={{this.disabled}}
          @onInput={{fn (mut this.disabled)}}
        />
        <Args.Object
          @name='paletteColors'
          @description='An array of colors (optional)'
          @value={{this.paletteColors}}
          @defaultValue={{DEFAULT_PALETTE_COLORS}}
        />
      </:api>
    </FreestyleUsage>
    <style scoped>
      :deep(.FreestyleUsageArgument-default.u-codePill) {
        word-break: break-word;
      }
    </style>
  </template>
}
