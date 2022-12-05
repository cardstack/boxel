import { primitive, Component, Card, useIndexBasedKey } from './card-api';
import BoxelInput from './components/boxel-input';

class Edit extends Component<typeof StringCard> {
  constructor(owner: unknown, args: any) {
    super(owner, args);
  }
  <template>
    <BoxelInput @value={{@model}} @onInput={{@set}} />
  </template>
}

export default class StringCard extends Card {
  static [primitive]: string;
  static [useIndexBasedKey]: never;
  static embedded = class Embedded extends Component<typeof this> {
    <template>{{@model}}</template>
  }
  static edit = Edit;
}
