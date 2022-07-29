import { contains, field, Component, Card } from 'https://cardstack.com/base/card-api';
import StringCard from 'https://cardstack.com/base/string';

export class Person extends Card {
  @field firstName = contains(StringCard);
  static isolated = class Isolated extends Component<typeof this> {
    <template><h1><@fields.firstName/></h1></template>
  }
  static embedded = class Embedded extends Component<typeof this> {
    <template><h3>Person: <@fields.firstName/></h3></template>
  }
  static demo: Record<string, any> = { firstName: 'Mango' }
}