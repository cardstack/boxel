import { Component, StringField } from 'https://cardstack.com/base/card-api';
import { ColorPalette } from '@cardstack/boxel-ui/components';
import { ColorPicker } from '@cardstack/boxel-ui/components';

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

export class ColorField extends StringField {
  static displayName = 'Color';

  static embedded = View;
  static atom = View;
  static fitted = View;
  static edit = EditView;
}
