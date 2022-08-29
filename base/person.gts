// TODO let's remove this card after we have proven that we can see base realm
// cards via field card selection. I think we should not pollute the base realm
// with cards that actually don't belong there

import { contains, field, Component, Card } from 'https://cardstack.com/base/card-api';
import StringCard from 'https://cardstack.com/base/string';

export class Person extends Card {
  @field firstName = contains(StringCard);
  @field lastName = contains(StringCard);
  static embedded = class Embedded extends Component<typeof this> {
    <template><@fields.firstName /> <@fields.lastName /></template>
  }
  static isolated = class Isolated extends Component<typeof this> {
    <template><h1><@fields.firstName /> <@fields.lastName /></h1></template>
  }
  static demo: Record<string, any> = { firstName: 'Mango', lastName: 'Abdel-Rahman' }
}