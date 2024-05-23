import StringField from 'https://cardstack.com/base/string';
import { CardDef, FieldDef, contains, field, linksTo, linksToMany } from 'https://cardstack.com/base/card-api';
import { Component } from 'https://cardstack.com/base/card-api';
import { Country } from './country';

class Traveler extends FieldDef {
  static displayName = 'Traveler';
  @field name = contains(StringField);
  @field countryOfOrigin = linksTo(Country);
  @field countriesVisited = linksToMany(Country);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='traveler'>
        <div><strong>Name:</strong> <@fields.name /></div>
        <div><strong>Country of Origin:</strong> <@fields.countryOfOrigin /></div>
        <div><strong>Countries Visited:</strong> <@fields.countriesVisited /></div>
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
  static displayName = "Trip Info";
  @field destinations = linksToMany(Country);
  @field traveler = contains(Traveler);
  @field title = contains(StringField, {
    computeVia: function (this: TripInfo) {
      return this.traveler ? `Trip Info for ${this.traveler.name}` : 'Trip Info';
    },
  });

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