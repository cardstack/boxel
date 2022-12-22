import { contains, field, Card, Component } from "https://cardstack.com/base/card-api";
import StringCard from "https://cardstack.com/base/string";

export class Chain extends Card {
  @field name = contains(StringCard);
  @field chainId = contains(StringCard);
  static embedded = class Embedded extends Component<typeof Chain> {
    <template>
      <@fields.name/> (<@fields.chainId/>)
    </template>
  }
  static isolated = class Isolated extends Component<typeof Chain> {
    <template>
      <div><@fields.name/> (<@fields.chainId/>)</div>
    </template>
  }
}
