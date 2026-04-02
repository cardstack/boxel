import { Component, CardDef } from '@cardstack/base/card-api';

export class Home extends CardDef {
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <p>Test Realm Runner Fixture</p>
    </template>
  };
}
