import { contains, field, Card, Component } from "https://cardstack.com/base/card-api";
import StringCard from 'https://cardstack.com/base/string';

export class PaymentType extends Card {
  @field type = contains(StringCard);
  @field name = contains(StringCard);
  static embedded = class Embedded extends Component<typeof this> {
    <template><@fields.name/></template>
  }
  static isolated = this.embedded;
}
