import { Component, CardDef } from '@cardstack/base/card-api';

export class Home extends CardDef {
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <p data-test-home-card>Hello, world</p>
    </template>
  };
}
