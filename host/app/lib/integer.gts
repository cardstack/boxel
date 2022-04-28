import { primitive, Component } from 'runtime-spike/lib/card-api';
import { on } from '@ember/modifier';

export default class IntegerCard {
  static [primitive]: number;
  static embedded = class Embedded extends Component<typeof this> {
    <template>{{@model}}</template>
  }
  static edit = class Edit extends Component<typeof this> {
    <template>
      {{!-- template-lint-disable require-input-label --}}
      <input type="text" value={{@model}} {{on "input" @set}} />
    </template>
  }
}
