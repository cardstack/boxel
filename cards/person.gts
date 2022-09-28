import { contains, field, Component, Card } from 'https://cardstack.com/base/card-api';
import StringCard from 'https://cardstack.com/base/string';
import BooleanCard from 'https://cardstack.com/base/boolean';
import CardContainer from 'https://cardstack.com/base/card-container';

let sharedStyles = `
  .Person {
    background-color: #90dbf4;
    padding: 1rem;
  }
`;

export class Person extends Card {
  @field firstName = contains(StringCard);
  @field lastName = contains(StringCard);
  @field isCool = contains(BooleanCard);
  @field isHuman = contains(BooleanCard);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <CardContainer @label={{@model.constructor.name}} @styles={{sharedStyles}}>
        <h3><@fields.firstName/></h3>
      </CardContainer>
    </template>
  }
  
  static isolated = class Isolated extends Component<typeof Person> {
    <template>
      <CardContainer @label={{@model.constructor.name}} @styles={{sharedStyles}}>
        <h1><@fields.firstName/> <@fields.lastName /></h1>
        <div><@fields.isCool/></div>
        <div><@fields.isHuman/></div>
      </CardContainer>
    </template>
  }
}