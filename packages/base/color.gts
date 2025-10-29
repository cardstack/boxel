import { Component, StringField } from './card-api';
import { ColorPalette, Swatch } from '@cardstack/boxel-ui/components';
import { not } from '@cardstack/boxel-ui/helpers';
import PaintBucket from '@cardstack/boxel-icons/paint-bucket';

class View extends Component<typeof ColorField> {
  <template>
    <Swatch @color={{@model}} @style='round' />
  </template>
}

class EditView extends Component<typeof ColorField> {
  <template>
    <ColorPalette
      @color={{@model}}
      @onChange={{@set}}
      @disabled={{not @canEdit}}
    />
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
