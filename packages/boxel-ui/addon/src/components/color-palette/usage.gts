import { fn } from '@ember/helper';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';

import ColorPalette, { DEFAULT_PALETTE_COLORS } from './index.gts';

export default class ColorPaletteUsage extends Component {
  @tracked private color: string | null = null;
  @tracked private colors?: string[];
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
          @colors={{this.colors}}
          @disabled={{this.disabled}}
        />
      </:example>

      <:api as |Args|>
        <Args.String
          @name='color'
          @optional={{false}}
          @description='Currently selected color in hex format.'
          @value={{this.color}}
          @onInput={{fn (mut this.color)}}
        />
        <Args.Action
          @name='onChange'
          @description='Callback function that receives the newly selected color value.'
          @value={{this.handleColorChange}}
          @onInput={{fn (mut this.handleColorChange)}}
        />
        <Args.Object
          @name='colors'
          @description='An array of colors (optional)'
          @value={{this.colors}}
          @defaultValue={{DEFAULT_PALETTE_COLORS}}
        />
        <Args.Bool
          @name='disabled'
          @description='Selection is disabled'
          @value={{this.disabled}}
          @onInput={{fn (mut this.disabled)}}
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
