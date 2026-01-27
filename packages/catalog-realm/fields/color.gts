import { Component } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import { Swatch } from '@cardstack/boxel-ui/components';
import PaletteIcon from '@cardstack/boxel-icons/palette';
import ColorPickerField from './color-field/components/color-picker-field';

class View extends Component<typeof ColorField> {
  <template>
    <Swatch @color={{@model}} @style='round' />
  </template>
}

class EditView extends Component<typeof ColorField> {
  <template>
    <ColorPickerField
      @model={{@model}}
      @set={{@set}}
      @canEdit={{@canEdit}}
      @configuration={{@configuration}}
    />
  </template>
}

export default class ColorField extends StringField {
  static displayName = 'Color Field';
  static icon = PaletteIcon;

  static embedded = View;
  static atom = View;
  static fitted = View;
  static edit = EditView;
}
