import { primitive, Component } from 'runtime-spike/lib/card-api';

export default class StringCard {
  static [primitive]: string;
  static embedded = class Embedded extends Component<typeof this> {
    <template>{{@model}}</template>
  }
}
