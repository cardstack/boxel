import {
  Component,
  FieldDef,
  StringField,
  contains,
  field,
} from 'https://cardstack.com/base/card-api';
import { ColorPalette } from '@cardstack/boxel-ui/components';
import { ColorPicker } from '@cardstack/boxel-ui/components';

class View extends Component<typeof ColorPalette> {
  <template>
    <ColorPicker
      @color={{@model.hexValue}}
      @disabled={{true}}
      @showHexString={{true}}
    />
  </template>
}

class EditView extends Component<typeof ColorPalette> {
  setColor = (color: string) => {
    this.args.model.hexValue = color;
  };

  <template>
    <ColorPalette @color={{@model.hexValue}} @onChange={{this.setColor}} />
  </template>
}

export class ColorField extends FieldDef {
  static displayName = 'Color';
  @field hexValue = contains(StringField);

  static isolated = View;
  static embedded = View;
  static atom = View;
  static fitted = View;
  static edit = EditView;
}
