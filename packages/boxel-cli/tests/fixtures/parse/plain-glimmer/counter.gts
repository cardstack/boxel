import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import {
  CardDef,
  Component as CardComponent,
  field,
  contains,
} from '@cardstack/base/card-api';
import NumberField from '@cardstack/base/number';

class CounterWidget extends Component<{ Args: { start?: number } }> {
  @tracked count = this.args.start ?? 0;
  <template><span>{{this.count}}</span></template>
}

export class Counter extends CardDef {
  static displayName = 'Counter';
  @field start = contains(NumberField);
  static isolated = class Isolated extends CardComponent<typeof Counter> {
    <template><CounterWidget @start={{@model.start}} /></template>
  };
}
