import { Component } from 'https://cardstack.com/base/card-api';
import CardDef from 'https://cardstack.com/base/card-def';

export class Home extends CardDef {
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <p data-test-home-card>Hello, world</p>
    </template>
  };
}
