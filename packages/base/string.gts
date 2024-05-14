import { primitive } from '@cardstack/runtime-common';
import { FieldDef } from 'field-def';

export class StringField extends FieldDef {
  static displayName = 'String';
  static [primitive]: string;
  static [useIndexBasedKey]: never;
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      {{@model}}
    </template>
  };
  static edit = class Edit extends Component<typeof this> {
    <template>
      <BoxelInput @value={{@model}} @onInput={{@set}} />
    </template>
  };
  static atom = class Atom extends Component<typeof this> {
    <template>
      {{@model}}
    </template>
  };
}
