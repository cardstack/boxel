import { contains, field, Component, Card } from 'https://cardstack.com/base/card-api';
import StringCard from 'https://cardstack.com/base/string';
import BooleanCard from 'https://cardstack.com/base/boolean';
import { initStyleSheet, attachStyles } from 'https://cardstack.com/base/attach-styles';

let styles = initStyleSheet(`:host { --background-color: #90dbf4; } this { display: contents; }`);

export class Person extends Card {
  @field firstName = contains(StringCard);
  @field lastName = contains(StringCard);
  @field isCool = contains(BooleanCard);
  @field isHuman = contains(BooleanCard);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div {{attachStyles styles}}>
        <@fields.firstName/>
      </div>
    </template>
  }
  
  static isolated = class Isolated extends Component<typeof Person> {
    <template>
      <div {{attachStyles styles}}>
        <h1><@fields.firstName/> <@fields.lastName /></h1>
        <div><@fields.isCool/></div>
        <div><@fields.isHuman/></div>
      </div>
    </template>
  }  
}