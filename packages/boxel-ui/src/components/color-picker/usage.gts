import { fn } from '@ember/helper';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';

import ColorPicker from './index.gts';

export default class ColorPickerUsage extends Component {
  @tracked color: string | null = 'oklch(59.69% 0.56 49.77 / .5)';
  @tracked disabled = false;

  private onChange = (newColor: string | null) => {
    this.color = newColor;
  };

  <template>
    <FreestyleUsage
      @name='ColorPicker'
      @description='Color input field that allows users to select a color from the color spectrum or type in a color code.'
    >
      <:example>
        <label>
          <span class='boxel-sr-only'>Color</span>
          <ColorPicker
            @color={{this.color}}
            @onChange={{this.onChange}}
            @disabled={{this.disabled}}
          />
        </label>
      </:example>

      <:api as |Args|>
        <Args.String
          @name='color'
          @optional={{false}}
          @description='Color value'
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
      </:api>
    </FreestyleUsage>
  </template>
}
