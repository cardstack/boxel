import {
  contains,
  field,
  Card,
  Component,
} from 'https://cardstack.com/base/card-api';
import BooleanCard from 'https://cardstack.com/base/boolean';
import NumberCard from 'https://cardstack.com/base/number';
import StringCard from 'https://cardstack.com/base/string';

export class Pet extends Card {
  static displayName = 'Pet';
  @field firstName = contains(StringCard);
  @field favoriteToy = contains(StringCard);
  @field favoriteTreat = contains(StringCard);
  @field cutenessRating = contains(NumberCard);
  @field sleepsOnTheCouch = contains(BooleanCard);
  @field title = contains(StringCard, {
    computeVia: function (this: Pet) {
      return this.firstName;
    },
  });
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div
        class='demo-card'
        {{! @glint-ignore  Argument of type 'unknown' is not assignable to parameter of type 'Element'}}
        ...attributes
      >
        <h3><@fields.firstName /></h3>
        <div>Sleeps On the Couch: <@fields.sleepsOnTheCouch /></div>
      </div>
    </template>
  };
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <div class='demo-card'>
        <h2><@fields.title /></h2>
        <h2><@fields.firstName /></h2>
        <div>
          <div>Sleeps On the Couch: <@fields.sleepsOnTheCouch /></div>
          <div>Favorite Toy: <@fields.favoriteToy /></div>
          <div>Favorite Treat: <@fields.favoriteTreat /></div>
          <div>Cuteness Rating: <@fields.cutenessRating /></div>
        </div>
      </div>
    </template>
  };
}
