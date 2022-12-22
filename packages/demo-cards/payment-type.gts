import { contains, field, Card, Component } from "https://cardstack.com/base/card-api";
import StringCard from "https://cardstack.com/base/string";

export class PaymentType extends Card {
  @field typeId = contains(StringCard);
  @field name = contains(StringCard);
  static embedded = class Embedded extends Component<typeof PaymentType> {
    <template>
      <@fields.name/>
    </template>
  }
  static isolated = this.embedded;
}
