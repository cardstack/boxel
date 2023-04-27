import {
  contains,
  field,
  Card,
  Component,
} from 'https://cardstack.com/base/card-api';
import BooleanCard from 'https://cardstack.com/base/boolean';
import IntegerCard from 'https://cardstack.com/base/integer';
import StringCard from 'https://cardstack.com/base/string';
import { CardContainer } from '@cardstack/boxel-ui';
import { Booking } from './booking';

export class Pet extends Card {
  static typeDisplayName = 'Pet';
  @field firstName = contains(StringCard);
  @field favoriteToy = contains(StringCard);
  @field favoriteTreat = contains(StringCard);
  @field cutenessRating = contains(IntegerCard);
  @field sleepsOnTheCouch = contains(BooleanCard);
  @field appointment = contains(() => Booking);
  @field title = contains(StringCard, {
    computeVia: function (this: Pet) {
      return this.firstName;
    },
  });
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <CardContainer class='demo-card' @displayBoundaries={{true}}>
        <h3><@fields.firstName /></h3>
        <div><@fields.sleepsOnTheCouch /></div>
      </CardContainer>
    </template>
  };
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <CardContainer class='demo-card' @displayBoundaries={{true}}>
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
