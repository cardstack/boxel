import { contains, field, Component, Card } from 'https://cardstack.com/base/card-api';
import StringCard from 'https://cardstack.com/base/string';
import BooleanCard from 'https://cardstack.com/base/boolean';

export class Person extends Card {
  @field firstName = contains(StringCard);
  @field lastName = contains(StringCard);
  @field isCool = contains(BooleanCard);
  @field isHuman = contains(BooleanCard);
  static embedded = class Embedded extends Component<typeof this> {
    <template><@fields.firstName/> <@fields.lastName /></template>
  }
  static isolated = class Isolated extends Component<typeof this> {
    <template><h1><@fields.firstName/> <@fields.lastName /><@fields.isCool/><@fields.isHuman/></h1></template>
  }
  static demo: Record<string, any> = { firstName: 'Mango', lastName: 'Abdel-Rahman' }
}