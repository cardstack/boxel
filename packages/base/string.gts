import { primitive, Component, Card, useIndexBasedKey } from './card-api';
import { BoxelInput } from '@cardstack/boxel-ui';

export default class StringCard extends Card {
  static [primitive]: string;
  static [useIndexBasedKey]: never;
  static embedded = class Embedded extends Component<typeof this> {
    <template>{{@model}}</template>
  }
  static edit = class Edit extends Component<typeof this> {
    <template><BoxelInput @value={{@model}} @onInput={{@set}}/></template>
  };
}
