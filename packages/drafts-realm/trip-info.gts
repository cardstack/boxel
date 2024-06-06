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
import { FieldContainer } from '@cardstack/boxel-ui/components';
import { Country } from './country';

class Traveler extends FieldDef {
  static displayName = 'Traveler';
  @field name = contains(StringField);
  @field countryOfOrigin = linksTo(Country);
  @field countriesVisited = linksToMany(Country);

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
      </div>
      <style>
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
