import { Component, StringField } from './card-api';
import {
  ColorPalette,
  Swatch,
  ColorPicker,
} from '@cardstack/boxel-ui/components';
import { not } from '@cardstack/boxel-ui/helpers';
import PaintBucket from '@cardstack/boxel-icons/paint-bucket';

// TypeScript configuration interface
export type ColorFieldConfiguration = {
  options?: {
    showPalette?: boolean; // Show color palette component (default: false)
  };
};

class View extends Component<typeof ColorField> {
  <template>
    <Swatch @color={{@model}} @style='round' />
  </template>
}

class EditView extends Component<typeof ColorField> {
  get options() {
    return (this.args.configuration as ColorFieldConfiguration)?.options || {};
  }

  get showPalette(): boolean {
    return this.options.showPalette ?? false;
  }

  <template>
    {{#if this.showPalette}}
      <ColorPalette
        @color={{@model}}
        @onChange={{@set}}
        @disabled={{not @canEdit}}
      />
    {{else}}
      <ColorPicker
        @color={{@model}}
        @onChange={{@set}}
        @disabled={{not @canEdit}}
        @placeholder='Custom hex color (#ff00ff)'
      />
    {{/if}}
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
