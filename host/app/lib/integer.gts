import { primitive, Component } from 'runtime-spike/lib/card-api';

export default class IntegerCard {
  static [primitive]: number;
  static embedded = class Embedded extends Component<typeof this> {
    <template>{{@model}}</template>
  }
}
