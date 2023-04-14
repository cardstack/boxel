import { Component, Card } from 'https://cardstack.com/base/card-api';

export class Home extends Card {
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <p data-test-home-card>Hello, world</p>
    </template>
  };
}
