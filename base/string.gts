import { primitive, Component, Card, useIndexBasedKey } from 'https://cardstack.com/base/card-api';
import { on } from '@ember/modifier';
import { pick } from './pick';

export default class StringCard extends Card {
  static [primitive]: string;
  static [useIndexBasedKey]: never;
  static embedded = class Embedded extends Component<typeof this> {
    <template>{{@model}}</template>
  }
  static edit = class Edit extends Component<typeof this> {
    <template>
      {{!-- template-lint-disable require-input-label --}}
      <input type="text" value={{@model}} {{on "input" (pick "target.value" @set) }} />
    </template>
  }
}
