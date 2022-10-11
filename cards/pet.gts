import { contains, field, Card, Component } from 'https://cardstack.com/base/card-api';
import StringCard from 'https://cardstack.com/base/string';
import IntegerCard from 'https://cardstack.com/base/integer';
import BooleanCard from 'https://cardstack.com/base/boolean';
import { initStyleSheet, attachStyles } from 'https://cardstack.com/base/attach-styles';

let css =`this { background-color: #fdfcdc; border: 1px solid gray; border-radius: 10px; padding: 1rem; }`;

let styleSheet = initStyleSheet(css);

export class Pet extends Card {
  @field firstName = contains(StringCard);
  @field favoriteToy = contains(StringCard);
  @field favoriteTreat = contains(StringCard);
  @field cutenessRating = contains(IntegerCard);
  @field sleepsOnTheCouch = contains(BooleanCard);
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div {{attachStyles styleSheet}}><@fields.firstName/></div>
    </template>
  };
  static edit = class Edit extends Component<typeof this> {
    <template>
      <div {{attachStyles styleSheet}}>Name: <@fields.firstName/></div>
    </template>
  };
}