import {
  contains,
  linksTo,
  field,
  Component,
  CardDef,
} from 'https://cardstack.com/base/card-api';
import BooleanCard from 'https://cardstack.com/base/boolean';
import StringCard from 'https://cardstack.com/base/string';
import { Pet } from './pet';
import { GridContainer } from '@cardstack/boxel-ui/components';
import { Address } from './address';
import { Trips } from './trips';

class FittedTemplate extends Component<typeof Person> {
  <template>
    <div class='fitted-template'>
      {{#if @model}}
        <h3 class='title'><@fields.firstName /> <@fields.lastName /></h3>
        <span class='details'>Is Cool:
          <@fields.isCool />
          Is Human:
          <@fields.isHuman /></span>
        <div class='pet'><@fields.pet @format='fitted' /></div>
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
      .details {
        font: 500 var(--boxel-font-xs);
        color: var(--boxel-450);
        line-height: 1.27;
        letter-spacing: 0.11px;
        text-align: center;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        width: 100%;
      }
      .pet {
        width: 100%;
        height: 80px;
        padding: var(--boxel-sp-xxs);
      }

      @container fitted-card (aspect-ratio <= 1.0) and ((width < 150px) or (height < 150px)) {
        .fitted-template {
          gap: 5px;
        }
        .details {
          display: none;
        }
      }

      @container fitted-card (aspect-ratio <= 1.0) and ((width < 120px) and (height < 120px)) {
        .pet {
          display: none;
        }
      }

      @container fitted-card (1.0 < aspect-ratio <= 2.0) and (width < 200px) {
        .details {
          display: none;
        }
        .pet {
          display: none;
        }
      }

      @container fitted-card (2.0 < aspect-ratio) {
        .details {
          display: none;
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
        .details {
          display: none;
        }
        .pet {
          display: none;
        }
      }
    </style>
  </template>
}

export class Person extends CardDef {
  static displayName = 'Person';
  @field firstName = contains(StringCard);
  @field lastName = contains(StringCard);
  @field isCool = contains(BooleanCard);
  @field isHuman = contains(BooleanCard);
  @field address = contains(Address);
  @field pet = linksTo(Pet);
  @field trips = contains(Trips);
  @field title = contains(StringCard, {
    computeVia: function (this: Person) {
      return [this.firstName, this.lastName].filter(Boolean).join(' ');
    },
  });

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <GridContainer>
        <h3><@fields.firstName /> <@fields.lastName /></h3>
        {{#if @model.pet}}<div><@fields.pet /></div>{{/if}}
      </GridContainer>
    </template>
  };

  static isolated = class Isolated extends Component<typeof Person> {
    <template>
      <GridContainer class='container'>
        <h2><@fields.title /></h2>
        <div>
          <div>Is Cool: <@fields.isCool /></div>
          <div>Is Human: <@fields.isHuman /></div>
        </div>
        {{#if @model.pet}}<@fields.pet />{{/if}}
        <@fields.trips />
      </GridContainer>
      <style scoped>
        .container {
          padding: var(--boxel-sp-xl);
        }
      </style>
    </template>
  };

  static fitted = FittedTemplate;
}
