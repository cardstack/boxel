import {
  contains,
  field,
  Component,
  CardDef,
  FieldDef,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import World from '@cardstack/boxel-icons/world';
import { BoxelSelect } from '@cardstack/boxel-ui/components';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { restartableTask } from 'ember-concurrency';
import type Owner from '@ember/owner';
import countryDataFind from 'https://esm.run/country-data-find@0.0.5';

export class Country extends CardDef {
  static displayName = 'Country';
  static icon = World;
  @field name = contains(StringField);
  @field title = contains(StringField, {
    computeVia(this: Country) {
      return this.name;
    },
  });

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <@fields.name />
    </template>
  };
}

function getCountryFlagEmoji(countryCode: string) {
  const codePoints = countryCode
    .toUpperCase()
    .split('')
    .map((char) => 127397 + char.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}

interface CountryData {
  code: string;
  name: string;
  emoji: string;
}

class CountryFieldEdit extends Component<typeof CountryField> {
  @tracked countryDataFindLib: any;
  @tracked country: CountryData | undefined;
  @tracked countries: CountryData[] = [];

  constructor(owner: Owner, args: any) {
    super(owner, args);
    this.loadCountries.perform();
  }

  private loadCountries = restartableTask(async () => {
    this.countries = countryDataFind.Array().map((country: any) => {
      return {
        code: country.ISO2_CODE,
        name: country.LIST_OF_NAME.ENG,
        emoji: getCountryFlagEmoji(country.ISO2_CODE),
      } as CountryData;
    });
  });

  @action onSelectCountry(country: any) {
    this.country = country;
  }

  <template>
    <BoxelSelect
      @options={{this.countries}}
      @selected={{this.country}}
      @onSelect={{@set}}
      @onChange={{this.onSelectCountry}}
      as |country|
    >
      {{country.emoji}}
      {{country.name}}
    </BoxelSelect>
  </template>
}

export class CountryField extends FieldDef {
  static displayName = 'Country';
  @field name = contains(StringField);
  @field code = contains(StringField);
  static edit = CountryFieldEdit;
}

export class CardWithCountryField extends CardDef {
  static displayName = 'Card With Country Field';
  @field country = contains(CountryField);

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <@fields.country />
    </template>
  };
}
