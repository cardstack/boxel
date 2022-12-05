import { primitive, Component, Card, useIndexBasedKey } from './card-api';
import { fn } from '@ember/helper';
import BoxelInput from './components/boxel-input';

export default class IntegerCard extends Card {
  static [primitive]: number;
  static [useIndexBasedKey]: never;

  static embedded = class Embedded extends Component<typeof this> {
    <template>{{@model}}</template>
  }

  static edit = class Edit extends Component<typeof this> {
    <template>
      <BoxelInput @value={{@model}} @onInput={{fn this.parseInput @set}} />
    </template>

    parseInput(set: Function, value: string) {
      return set(Number(value));
    }
  }
}
