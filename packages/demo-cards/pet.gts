import {
  contains,
  field,
  Card,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringCard from 'https://cardstack.com/base/string';
import IntegerCard from 'https://cardstack.com/base/integer';
import BooleanCard from 'https://cardstack.com/base/boolean';
import {
  initStyleSheet,
  attachStyles,
} from '@cardstack/boxel-ui/attach-styles';
import { CardContainer } from '@cardstack/boxel-ui';

let styles = initStyleSheet(`
  this {
    padding: var(--boxel-sp);
    display: grid;
    gap: var(--boxel-sp);
  }
  h2, h3 { margin: 0; }
`);

export class Pet extends Card {
  @field firstName = contains(StringCard);
  @field favoriteToy = contains(StringCard);
  @field favoriteTreat = contains(StringCard);
  @field cutenessRating = contains(IntegerCard);
  @field sleepsOnTheCouch = contains(BooleanCard);
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <CardContainer @displayBoundaries={{true}} {{attachStyles styles}}>
        <h3><@fields.firstName /></h3>
        <div><@fields.sleepsOnTheCouch /></div>
      </CardContainer>
    </template>
  };
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <CardContainer @displayBoundaries={{true}} {{attachStyles styles}}>
        <h2><@fields.firstName /></h2>
        <div>
          <div><@fields.sleepsOnTheCouch /></div>
          <div>Favorite Toy: <@fields.favoriteToy /></div>
          <div>Favorite Treat: <@fields.favoriteTreat /></div>
          <div>Cuteness Rating: <@fields.cutenessRating /></div>
        </div>
      </CardContainer>
    </template>
  };
}
