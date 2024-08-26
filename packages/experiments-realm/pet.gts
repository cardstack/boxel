import {
  contains,
  field,
  CardDef,
  Component,
} from 'https://cardstack.com/base/card-api';
import BooleanCard from 'https://cardstack.com/base/boolean';
import NumberCard from 'https://cardstack.com/base/number';
import StringCard from 'https://cardstack.com/base/string';
import { GridContainer } from '@cardstack/boxel-ui/components';

class FittedTemplate extends Component<typeof Pet> {
  <template>
    <div class='fitted-template'>
      {{#if @model}}
        <h3 class='title'><@fields.firstName /></h3>
        <div class='details'>
          <span>Favorite Toy:
            <@fields.favoriteToy /></span>
          <span>Favorite Treat:
            <@fields.favoriteTreat /></span>
          <span>Sleeps On The Couch:
            <@fields.sleepsOnTheCouch /></span>
        </div>
      {{else}}
        {{! empty links-to field }}
        <div data-test-empty-field class='empty-field'></div>
      {{/if}}
    </div>
    <style>
      .fitted-template {
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        padding: var(--boxel-sp-xxs);
        gap: var(--boxel-sp-xxs);
        height: 100%;
      }
      .title {
        overflow: hidden;
        text-overflow: ellipsis;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
        text-align: center;
        margin: 0;
        width: 100%;
      }
      .details {
        display: flex;
        flex-wrap: wrap;
      }

      @container fitted-card (aspect-ratio <= 1.0) and ((width < 150px) and (height < 150px)) {
        .details {
          display: none;
        }
      }

      @container fitted-card (1.0 < aspect-ratio <= 2.0) and (width < 200px) {
        .details {
          display: none;
        }
      }

      @container fitted-card (2.0 < aspect-ratio) and (height <= 58px) {
        .title {
          font: 700 var(--boxel-font-xs);
          line-height: 1.27;
          letter-spacing: 0.11px;
        }
      }

      @container fitted-card (2.0 < aspect-ratio) and (height < 115px) {
        .details {
          display: none;
        }
      }
    </style>
  </template>
}

export class Pet extends CardDef {
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
  @field description = contains(StringCard, {
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

  static fitted = FittedTemplate;
}
