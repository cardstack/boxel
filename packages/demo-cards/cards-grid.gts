import { Component, Card } from 'https://cardstack.com/base/card-api';

export class CardsGrid extends Card {
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      This cards-grid instance should become even better.
    </template>
  };
}
