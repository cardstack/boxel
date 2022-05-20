import { primitive, Component, Card, useIndexBasedKey } from 'runtime-spike/lib/card-api';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { pick } from './pick';

export default class IntegerCard extends Card {
  static [primitive]: number;
  static [useIndexBasedKey];

  static embedded = class Embedded extends Component<typeof this> {
    <template>{{@model}}</template>
  }

  static edit = class Edit extends Component<typeof this> {
    <template>
      {{!-- template-lint-disable require-input-label --}}
      <input type="text" value={{@model}} {{on "input" (pick "target.value" (fn this.parseInput @set))}} />
    </template>

    parseInput(set: Function, value: string) {
      return set(Number(value));
    }
  }
}
