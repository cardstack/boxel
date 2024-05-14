import { pick } from '@cardstack/boxel-ui/declarations/helpers';
import { primitive } from '@cardstack/runtime-common';
import { on } from '@ember/modifier';
import { Component } from 'base-def';
import { FieldDef } from 'field-def';
import { useIndexBasedKey } from 'utils';

export class IDField extends FieldDef {
  static [primitive]: string;
  static [useIndexBasedKey]: never;
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      {{@model}}
    </template>
  };
  static edit = class Edit extends Component<typeof this> {
    <template>
      {{! template-lint-disable require-input-label }}
      <input
        type='text'
        value={{@model}}
        {{on 'input' (pick 'target.value' @set)}}
      />
    </template>
  };
}
