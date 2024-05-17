import { on } from '@ember/modifier';
import { pick } from '@cardstack/boxel-ui/helpers';
import { primitive } from '@cardstack/runtime-common';
import { useIndexBasedKey } from '../-constants';
import { Component } from '../-components/utils';
import { FieldDef } from '../../card-api';

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
