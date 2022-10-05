import { contains, field, Card, Component } from 'https://cardstack.com/base/card-api';
import StringCard from 'https://cardstack.com/base/string';
import IntegerCard from 'https://cardstack.com/base/integer';
import BooleanCard from 'https://cardstack.com/base/boolean';
import { attachStyles } from '@cardstack/runtime-common';

let sheet: CSSStyleSheet | undefined;
if (typeof CSSStyleSheet !== 'undefined') {
  sheet = new CSSStyleSheet();
  sheet.replaceSync(`
    this {
      border: 1px solid gray;
      border-radius: 10px;
      background-color: #fdfcdc;
      padding: 1rem;
    }
  `);
}

class Embedded extends Component<typeof Pet> {
  <template>
    <div {{attachStyles sheet}}><@fields.firstName/></div>
  </template>
}

export class Pet extends Card {
  @field firstName = contains(StringCard);
  @field favoriteToy = contains(StringCard);
  @field favoriteTreat = contains(StringCard);
  @field cutenessRating = contains(IntegerCard);
  @field sleepsOnTheCouch = contains(BooleanCard);
  static embedded = Embedded;
}