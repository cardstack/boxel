import {
  contains,
  field,
  CardDef,
  Component,
  FieldDef,
} from 'https://cardstack.com/base/card-api';
import BooleanField from 'https://cardstack.com/base/boolean';
import NumberField from 'https://cardstack.com/base/number';
import StringField from 'https://cardstack.com/base/string';
import { GridContainer } from '@cardstack/boxel-ui/components';
import PawPrintIcon from '@cardstack/boxel-icons/paw-print';

export class FullName extends FieldDef {
  @field firstName = contains(StringField);
  @field lastName = contains(StringField);
  @field title = contains(StringField, {
    computeVia: function (this: FullName) {
      let fullName = [this.firstName, this.lastName].filter(Boolean).join(' ');
      return fullName.length ? fullName : 'Pet';
    },
  });
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <@fields.title />
    </template>
  };
}

export class Toy extends FieldDef {
  @field title = contains(StringField);
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <@fields.title />
    </template>
  };
}

export class Pet extends CardDef {
  static displayName = 'Pet';
  static icon = PawPrintIcon;
  @field firstName = contains(StringField);
  @field favoriteToy = contains(StringField);
  @field favoriteTreat = contains(StringField);
  @field cutenessRating = contains(NumberField);
  @field sleepsOnTheCouch = contains(BooleanField);
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
      <style scoped>
        .container {
          padding: var(--boxel-sp-xl);
        }
      </style>
    </template>
  };

  static fitted = class FittedTemplate extends Component<typeof this> {
    <template>
      <div class='fitted-template'>
        {{#if @model}}
          <h3 class='title'><@fields.firstName /></h3>
          <div class='content'>
            <div class='info'>
              <div class='info-item'>
                <span class='label'>Sleeps On The Couch</span>
                <span><@fields.sleepsOnTheCouch /></span>
              </div>
              <div class='info-item'>
                <span class='label'>Favorite Toy</span>
                <span><@fields.favoriteToy /></span>
              </div>
              <div class='info-item'>
                <span class='label'>Favorite Treat</span>
                <span><@fields.favoriteTreat /></span>
              </div>
            </div>
          </div>
        {{else}}
          {{! empty links-to field }}
          <div data-test-empty-field class='empty-field'></div>
        {{/if}}
      </div>
      <style scoped>
        .fitted-template {
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
          padding: var(--boxel-sp-xxs);
          gap: var(--boxel-sp-xxs);
          height: 100%;
          padding: 5px;
        }
        .title {
          overflow: hidden;
          text-overflow: ellipsis;
          display: -webkit-box;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 2;
          text-align: center;
          margin: 0;
          width: 100%;
        }
        .content {
          width: 100%;
          padding: var(--boxel-sp-xs);
        }
        .info {
          display: flex;
          justify-content: center;
          gap: var(--boxel-sp-xs);
        }
        .info-item {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-sm);
        }
        .info-item > span {
          width: fit-content;
          white-space: nowrap;
        }
        .label {
          font: 500 var(--boxel-font-xs);
          color: var(--boxel-450);
          line-height: 1.27;
          letter-spacing: 0.11px;
        }

        @container fitted-card (aspect-ratio <= 1.0) {
          .info-item:not(:first-child) {
            display: none;
          }

          .info-item {
            width: 100%;
          }

          .info-item > span {
            white-space: wrap;
          }
        }

        @container fitted-card (aspect-ratio <= 1.0) and ((width < 150px) and (height < 150px)) {
          .content {
            display: none;
          }
        }

        @container fitted-card (1.0 < aspect-ratio <= 2.0) and (width < 200px) {
          .content {
            display: none;
          }
        }

        @container fitted-card (2.0 < aspect-ratio) {
          .title {
            font: 700 var(--boxel-font-sm);
            line-height: 1.27;
            letter-spacing: 0.11px;
          }
        }

        @container fitted-card (2.0 < aspect-ratio) and (height <= 58px) {
          .fitted-template {
            padding: 0;
          }
          .title {
            font: 700 var(--boxel-font-xs);
            line-height: 1.27;
            letter-spacing: 0.11px;
          }
        }

        @container fitted-card (2.0 < aspect-ratio) and (height < 115px) {
          .content {
            display: none;
          }
        }
      </style>
    </template>
  }
}
