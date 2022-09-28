import { contains, field, Component, Card } from 'https://cardstack.com/base/card-api';
import StringCard from 'https://cardstack.com/base/string';
import BooleanCard from 'https://cardstack.com/base/boolean';
import { ShadowRoot } from 'https://cardstack.com/base/shadow-root';

const sharedStyles = `
  .Person {
    background-color: #90dbf4;
  }
`;

export class Person extends Card {
  @field firstName = contains(StringCard);
  @field lastName = contains(StringCard);
  @field isCool = contains(BooleanCard);
  @field isHuman = contains(BooleanCard);
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div {{ShadowRoot @model sharedStyles}}>
        <h3><@fields.firstName/> <@fields.lastName /></h3>
      </div>
    </template>
  }
  
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <div {{ShadowRoot @model sharedStyles}}>
        <h1><@fields.firstName/> <@fields.lastName /></h1>
        <div><@fields.isCool/></div>
        <div><@fields.isHuman/></div>
      </div>
    </template>
  }
}