import { contains, field, Component, Card } from "https://cardstack.com/base/card-api";
import StringCard from "https://cardstack.com/base/string";
import CardContainer from "https://cardstack.com/base/card-container";

export class BlogPerson extends Card {
  @field firstName = contains(StringCard);
  @field lastName = contains(StringCard);
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <CardContainer @label={{@model.constructor.name}}>
        <@fields.firstName/> <@fields.lastName />
      </CardContainer>
    </template>
  }
  static isolated = class Embedded extends Component<typeof this> {
    <template>
      <CardContainer @label={{@model.constructor.name}}>
        <@fields.firstName/> <@fields.lastName />
      </CardContainer>
    </template>
  }
}
