import { primitive } from '@cardstack/runtime-common';
import { useIndexBasedKey } from '../-constants';
import { Component } from '../-components/utils';
import { BoxelInput } from '@cardstack/boxel-ui/components';
import { not } from '@cardstack/boxel-ui/helpers';
import { FieldDef } from '../-field-def';

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
      <BoxelInput
        @value={{@model}}
        @onInput={{@set}}
        @disabled={{not @canEdit}}
      />
    </template>
  };
  static atom = class Atom extends Component<typeof this> {
    <template>
      {{@model}}
    </template>
  };
}
