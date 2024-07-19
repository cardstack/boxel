import { Component } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import { BoxelInput } from '@cardstack/boxel-ui/components';

class ColorPickerTemplate extends Component<typeof ColorPicker> {
  <template>
    <div class='color-picker'>
      <label>
        <span class='boxel-sr-only'>Hex Code</span>
        <BoxelInput @value={{this.currentColor}} @onInput={{@set}} />
      </label>
      <label>
        <span class='boxel-sr-only'>Color</span>
        <BoxelInput
          class='color-input'
          @type='color'
          @value={{this.currentColor}}
          @onInput={{@set}}
        />
      </label>
    </div>
    <style>
      .color-picker {
        display: flex;
        gap: 10px;
      }
      .color-input {
        grid-column: 1 / -1;
        padding: 5px;
      }
      .color-input:hover:not(:disabled) {
        cursor: pointer;
      }
    </style>
  </template>

  get currentColor() {
    return this.args.model?.trim().length ? this.args.model : '#ffffff';
  }
}

export class ColorPicker extends StringField {
  static displayName = 'Color Picker';
  static isolated = ColorPickerTemplate;
  static embedded = ColorPickerTemplate;
  static edit = ColorPickerTemplate;
}
