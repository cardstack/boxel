import {
  field,
  contains,
  FieldDef,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import { action } from '@ember/object';
import { BoxelInput } from '@cardstack/boxel-ui/components';

class ColorPickerTemplate extends Component<typeof ColorPicker> {
  @action
  setColor(color: string) {
    this.args.model.value = color;
  }
  <template>
    <div class='color-picker'>
      <label>
        <span class='boxel-sr-only'>Hex Code</span>
        <BoxelInput
          @value={{this.args.model.value}}
          @onInput={{this.setColor}}
        />
      </label>
      <label>
        <span class='boxel-sr-only'>Color</span>
        <BoxelInput
          class='color-input'
          @type='color'
          @value={{this.args.model.value}}
          @onInput={{this.setColor}}
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
}

export class ColorPicker extends FieldDef {
  static displayName = 'Color Picker';
  @field value = contains(StringField);
  static isolated = ColorPickerTemplate;
  static embedded = ColorPickerTemplate;
  static edit = ColorPickerTemplate;
}
