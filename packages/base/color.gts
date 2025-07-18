import { Component, StringField } from './card-api';
import { ColorPalette } from '@cardstack/boxel-ui/components';
import { ColorPicker } from '@cardstack/boxel-ui/components';
import PaintBucket from '@cardstack/boxel-icons/paint-bucket';

class View extends Component<typeof ColorPalette> {
  <template>
    <ColorPicker @color={{@model}} @disabled={{true}} @showHexString={{true}} />
  </template>
}

class EditView extends Component<typeof ColorPalette> {
  <template>
    <ColorPalette @color={{@model}} @onChange={{@set}} />
  </template>
}

export default class ColorField extends StringField {
  static displayName = 'Color';
  static icon = PaintBucket;

  static embedded = View;
  static atom = View;
  static fitted = View;
  static edit = EditView;
}
