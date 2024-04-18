import {
  contains,
  field,
  CardDef,
  Component,
} from 'https://cardstack.com/base/card-api';
import BooleanCard from 'https://cardstack.com/base/boolean';
import NumberCard from 'https://cardstack.com/base/number';
import StringField from 'https://cardstack.com/base/string';
import { GridContainer } from '@cardstack/boxel-ui/components';

export class Pet extends CardDef {
  static displayName = 'Pet';
  @field firstName = contains(StringField);
  @field favoriteToy = contains(StringField);
  @field favoriteTreat = contains(StringField);
  @field cutenessRating = contains(NumberCard);
  @field sleepsOnTheCouch = contains(BooleanCard);
  @field title = contains(StringField, {
    computeVia: function (this: Pet) {
      return this.firstName;
    },
  });
  @field description = contains(StringField, {
    computeVia: function (this: Pet) {
      return `${this.firstName} the Pet`;
    },
  });
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <GridContainer
        {{! @glint-ignore  Argument of type 'unknown' is not assignable to parameter of type 'Element'}}
        ...attributes
      >
        <h3><@fields.firstName /></h3>
        <div>Sleeps On the Couch: <@fields.sleepsOnTheCouch /></div>
      </GridContainer>
    </template>
  };
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <GridContainer class='container'>
        <h2><@fields.title /></h2>
        <div>
          <div>Sleeps On the Couch: <@fields.sleepsOnTheCouch /></div>
          <div>Favorite Toy: <@fields.favoriteToy /></div>
          <div>Favorite Treat: <@fields.favoriteTreat /></div>
          <div>Cuteness Rating: <@fields.cutenessRating /></div>
        </div>
      </GridContainer>
      <style>
        .container {
          padding: var(--boxel-sp-xl);
        }
      </style>
    </template>
  };
}
