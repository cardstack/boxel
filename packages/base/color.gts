import { Component } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import { Swatch } from '@cardstack/boxel-ui/components';
import { markdownEscape } from '@cardstack/boxel-ui/helpers';
import PaletteIcon from '@cardstack/boxel-icons/palette';
import ColorPickerField from './color-field/components/color-picker-field';

class View extends Component<typeof ColorField> {
  <template><Swatch @color={{@model}} @style='round' /></template>
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
  static displayName = 'Color';
  static icon = PaletteIcon;

  static embedded = View;
  static atom = View;
  static fitted = View;
  static edit = EditView;

  // CS-10786: escape the hex string. A leading `#` at line start would be
  // interpreted as an ATX heading by CommonMark; `markdownEscape` emits
  // `\#` to prevent that.
  static markdown = class Markdown extends Component<typeof this> {
    get text() {
      return markdownEscape(this.args.model);
    }
    <template>{{this.text}}</template>
  };
}
