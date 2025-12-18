import { Component } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import { Swatch } from '@cardstack/boxel-ui/components';
import PaletteIcon from '@cardstack/boxel-icons/palette';
import ColorFieldEdit from './color-field/components/color-field-edit';

export default class ColorField extends StringField {
  static displayName = 'Color Field';
  static icon = PaletteIcon;

  static embedded = class Embedded extends Component<typeof ColorField> {
    <template>
      <Swatch @color={{@model}} @style='round' />
    </template>
  };

  static atom = class Atom extends Component<typeof ColorField> {
    <template>
      <Swatch @color={{@model}} @style='round' />
    </template>
  };

  static fitted = class Fitted extends Component<typeof ColorField> {
    <template>
      <div class='fitted-color-display'>
        <Swatch @color={{@model}} @style='round' />
        <span class='color-value'>{{@model}}</span>
      </div>

      <style scoped>
        .fitted-color-display {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.5rem;
        }
        .color-value {
          font-family: var(--font-mono, monospace);
          font-size: 0.875rem;
          color: var(--foreground, #1a1a1a);
        }
      </style>
    </template>
  };

  static edit = class Edit extends Component<typeof this> {
    <template>
      <ColorFieldEdit
        @model={{@model}}
        @set={{@set}}
        @canEdit={{@canEdit}}
        @configuration={{@configuration}}
      />
    </template>
  };
}
