import StringField from 'https://cardstack.com/base/string';
import {
  CardDef,
  FieldDef,
  contains,
  field,
  linksTo,
  linksToMany,
} from 'https://cardstack.com/base/card-api';
import { Component } from 'https://cardstack.com/base/card-api';
import { CardContainer, FieldContainer } from '@cardstack/boxel-ui/components';
import { Country } from './country';
import MapPinIcon from '@cardstack/boxel-icons/map-pin';

class TravelGoal extends FieldDef {
  static displayName = 'Travel Goal';
  @field goalTitle = contains(StringField);
  @field country = linksTo(Country);
  @field alternateTrips = linksToMany(Country);
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <CardContainer class='container'>
        <FieldContainer @label='Goal Title'>
          <@fields.goalTitle />
        </FieldContainer>
        <FieldContainer @label='Country'>
          <@fields.country />
        </FieldContainer>
        <FieldContainer @label='Alternate Trips'>
          <@fields.alternateTrips />
        </FieldContainer>
      </CardContainer>
      <style scoped>
        .container {
          padding: 20px;
          background-color: whitesmoke;
        }
        .container > * + * {
          margin-top: 20px;
        }
      </style>
    </template>
  };
}

class Traveler extends FieldDef {
  static displayName = 'Traveler';
  @field name = contains(StringField);
  @field countryOfOrigin = linksTo(Country);
  @field countriesVisited = linksToMany(Country);
  @field nextTravelGoal = contains(TravelGoal);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='traveler'>
        <FieldContainer @label='Name' @vertical={{true}}>
          <@fields.name />
        </FieldContainer>
        <FieldContainer @label='Country of Origin' @vertical={{true}}>
          {{#if @model.countryOfOrigin}}
            <@fields.countryOfOrigin />
          {{else}}
            Unknown
          {{/if}}
        </FieldContainer>
        <FieldContainer @label='Countries Visited' @vertical={{true}}>
          {{#if @model.countriesVisited.length}}
            <@fields.countriesVisited />
          {{else}}
            Unknown
          {{/if}}
        </FieldContainer>
        <FieldContainer @label='Next Travel Goal' @vertical={{true}}>
          <@fields.nextTravelGoal />
        </FieldContainer>
      </div>
      <style scoped>
        .traveler {
          display: grid;
          gap: 20px;
        }
      </style>
    </template>
  };
}

export class TripInfo extends CardDef {
  static displayName = 'Trip Info';
  static icon = MapPinIcon;
  @field destinations = linksToMany(Country);
  @field traveler = contains(Traveler);
  @field title = contains(StringField, {
    computeVia: function (this: TripInfo) {
      return this.traveler?.name
        ? `Trip Info for ${this.traveler.name}`
        : 'Trip Info';
    },
  });
  @field startLocation = linksTo(Country);
  @field endLocation = linksTo(Country);
  /*
  static isolated = class Isolated extends Component<typeof this> {
    <template></template>
  }
  static embedded = class Embedded extends Component<typeof this> {
    <template></template>
  }
  static atom = class Atom extends Component<typeof this> {
    <template></template>
  }
  static edit = class Edit extends Component<typeof this> {
    <template></template>
  }


  */
}
