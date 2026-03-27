import { Component, CardDef } from 'https://cardstack.com/base/card-api';

export class Home extends CardDef {
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <p>Bootstrap Target Test Realm</p>
    </template>
  };
}
