import { FieldDef, field, contains } from 'https://cardstack.com/base/card-api';
import { Component } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import { not } from '@cardstack/boxel-ui/helpers';
import {
  BoxelSelect,
  FieldContainer,
  CardContainer,
} from '@cardstack/boxel-ui/components';
import { task } from 'ember-concurrency';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import { tracked } from '@glimmer/tracking';

interface Timezone {
  zoneName: string;
  gmtOffset: number;
  gmtOffsetName: string;
  abbreviation: string;
  tzName: string;
}

interface Translations {
  kr: string;
  'pt-BR': string;
  pt: string;
  nl: string;
  hr: string;
  fa: string;
  de: string;
  es: string;
  fr: string;
  ja: string;
  it: string;
  cn: string;
  tr: string;
}

interface CountrySignature {
  id: number;
  name: string;
  iso3: string;
  iso2: string;
  numeric_code: string;
  phone_code: string;
  capital: string;
  currency: string;
  currency_name: string;
  currency_symbol: string;
  tld: string;
  native: string;
  region: string;
  region_id: string;
  subregion: string;
  subregion_id: string;
  nationality: string;
  timezones: Timezone[];
  translations: Translations;
  latitude: string;
  longitude: string;
  emoji: string;
  emojiU: string;
}

interface StateSignature {
  id: number;
  name: string;
  country_id: number;
  country_code: string;
  country_name: string;
  state_code: string;
  type?: string | null;
  latitude: string;
  longitude: string;
}

interface CitySignature {
  id: number;
  name: string;
  state_id: number;
  state_code: string;
  state_name: string;
  country_id: number;
  country_code: string;
  country_name: string;
  latitude: string;
  longitude: string;
  wikiDataId: string;
}

class View extends Component<typeof AddressInfo> {
  get addressInfo() {
    let { address, zip, state, city, country } = this.args.model;
    let arr = [address, zip, state, city, country];

    return arr
      .map((str: string | undefined) => str?.trim())
      .filter((str) => str && str.length > 0)
      .join(', ');
  }

  <template>
    <div class='address-info'>
      {{this.addressInfo}}
      <div class='map-container'>
        <iframe
          id='gmap_canvas'
          width={{400}}
          height={{300}}
          referrerpolicy='no-referrer-when-downgrade'
          src={{this.args.model.mapUrl}}
          loading='lazy'
          center='true'
        ></iframe>
      </div>
    </div>

    <style>
      .address-info {
        text-align: left;
        display: grid;
        gap: var(--boxel-sp);
      }

      .map-container {
        position: relative;
        overflow: hidden;
        padding-top: 56.25%; /* 16:9 aspect ratio */
        min-width: 320px;
      }

      .map-container iframe {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        min-width: 300px;
      }
    </style>
  </template>
}

class Edit extends Component<typeof AddressInfo> {
  @tracked selectedCountryType = {
    name: this.args.model.country || 'Select',
  };
  @tracked selectedStateType = {
    name: this.args.model.state || 'Select',
  };
  @tracked selectedCityType = {
    name: this.args.model.city || 'Select',
  };

  @tracked private allCountries = [];
  @tracked private allStatesOfCountry = [];
  @tracked private allCitiesOfState = [];

  get hasStates() {
    return this.allStatesOfCountry.length > 0;
  }

  get hasCities() {
    return this.allCitiesOfState.length > 0;
  }

  @action
  async updateCountry(type: CountrySignature) {
    this.args.model.countryCode = type.iso2;
    this.selectedCountryType = type;
    this.args.model.country = type.name;

    // reset state while country is changed
    const states = await this.loadStates.perform(type.iso2);

    if (states.length > 0) {
      this.updateState(states[0]);
    } else {
      this.selectedStateType = { name: 'Select' };
      this.args.model.stateCode = '';
      this.args.model.state = '';
      this.selectedCityType = { name: 'Select' };
      this.args.model.city = '';
    }
  }

  @action
  async updateState(type: StateSignature) {
    this.args.model.stateCode = type.state_code;
    this.selectedStateType = type;
    this.args.model.state = type.name;

    // reset city while state is changed
    const cities = await this.loadCities.perform(
      this.args.model.countryCode,
      this.args.model.stateCode,
    );

    if (cities.length > 0) {
      this.updateCity(cities[0]);
    } else {
      this.selectedCityType = { name: 'Select' };
      this.args.model.city = '';
    }
  }

  @action
  updateCity(type: CitySignature) {
    this.selectedCityType = type;
    this.args.model.city = type.name;
  }

  //query fetch
  private loadCountry = task(async () => {
    try {
      let response = await fetch(
        'https://raw.githubusercontent.com/dr5hn/countries-states-cities-database/master/countries.json',
      );
      if (!response.ok) {
        throw new Error('Network response was not ok ' + response.statusText);
      }
      let data = await response.json();

      this.allCountries = data;

      return data;
    } catch (error) {
      console.error('loadCountry', error);
    }
  });

  private loadStates = task(async (countryCode: string | null) => {
    try {
      let response = await fetch(
        'https://raw.githubusercontent.com/dr5hn/countries-states-cities-database/master/states.json',
      );
      if (!response.ok) {
        throw new Error('Network response was not ok ' + response.statusText);
      }
      let data = await response.json();

      if (!countryCode) {
        return data;
      }

      let filterData = data.filter(
        (state: StateSignature) => state.country_code === countryCode,
      );

      this.allStatesOfCountry = filterData;

      return filterData;
    } catch (error) {
      console.error('loadStates', error);
    }
  });

  private loadCities = task(
    async (countryCode: string | null, stateCode: string | null) => {
      try {
        let response = await fetch(
          'https://raw.githubusercontent.com/dr5hn/countries-states-cities-database/master/cities.json',
        );
        if (!response.ok) {
          throw new Error('Network response was not ok ' + response.statusText);
        }

        let data = await response.json();

        if (!countryCode || !stateCode) {
          return data;
        }

        let filterData = data.filter(
          (item: CitySignature) =>
            item.country_code === countryCode && item.state_code === stateCode,
        );

        this.allCitiesOfState = filterData;

        return filterData;
      } catch (error) {
        console.error('loadCities', error);
      }
    },
  );

  constructor(owner: Owner, args: any) {
    super(owner, args);
    this.loadCountry.perform();
    this.loadStates.perform(this.args.model.countryCode);
    this.loadCities.perform(
      this.args.model.countryCode,
      this.args.model.stateCode,
    );
  }

  <template>
    <CardContainer @displayBoundaries={{true}} class='card-container'>
      <FieldContainer
        @tag='label'
        @label='Stress Address'
        @vertical={{true}}
      ><@fields.address /></FieldContainer>

      <FieldContainer
        @tag='label'
        @label='Zip/ Postal Code'
        @vertical={{true}}
      ><@fields.zip /></FieldContainer>

      <FieldContainer @tag='label' @label='Country' @vertical={{true}}>
        <BoxelSelect
          @searchEnabled={{true}}
          @searchField='name'
          @placeholder='Select'
          @selected={{this.selectedCountryType}}
          @onChange={{this.updateCountry}}
          @options={{this.allCountries}}
          class='select'
          as |item|
        >
          <div>{{item.name}}</div>
        </BoxelSelect>
      </FieldContainer>

      <FieldContainer @tag='label' @label='State' @vertical={{true}}>
        <BoxelSelect
          @searchEnabled={{true}}
          @searchField='name'
          @placeholder='Select'
          @selected={{this.selectedStateType}}
          @onChange={{this.updateState}}
          @options={{this.allStatesOfCountry}}
          @disabled={{not this.hasStates}}
          class='select'
          as |item|
        >
          <div>{{item.name}}</div>
        </BoxelSelect>
      </FieldContainer>

      <FieldContainer @tag='label' @label='City' @vertical={{true}}>
        <BoxelSelect
          @searchEnabled={{true}}
          @searchField='name'
          @placeholder='Select'
          @selected={{this.selectedCityType}}
          @onChange={{this.updateCity}}
          @options={{this.allCitiesOfState}}
          @disabled={{not this.hasCities}}
          class='select'
          as |item|
        >
          <div>{{item.name}}</div>
        </BoxelSelect>
      </FieldContainer>
    </CardContainer>

    <style>
      .card-container {
        padding: 2rem 1rem;
        display: grid;
        gap: var(--boxel-sp-sm);
        background-color: #eeeeee50;
      }
      .select {
        padding: var(--boxel-sp-xs);
        background-color: white;
      }

      .custom-class {
        position: relative;
        width: 100%;
        cursor: default;
        overflow: hidden;
        border-radius: 0.5rem;
        background-color: white;
        text-align: left;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        font-size: 0.875rem;
      }

      .custom-class:focus {
        outline: none;
      }

      .input-field {
        width: 100%;
        outline: none;
        border: none;
        padding-top: 0.5rem;
        padding-bottom: 0.5rem;
        padding-left: 0.75rem;
        padding-right: 2.5rem;
        font-size: 0.875rem;
        line-height: 1.25rem;
        color: #1f2937;
      }

      .input-field:focus {
        box-shadow: none;
      }

      .autocomplete-select {
        position: relative;
      }

      .select-input {
        width: 100%;
        padding: 0.5rem 0.75rem;
        font-size: 0.875rem;
        line-height: 1.25rem;
        color: #1f2937;
        border: 1px solid #d1d5db;
        border-radius: 0.375rem;
      }

      .options-list {
        position: absolute;
        width: 100%;
        max-height: 200px;
        overflow-y: auto;
        background-color: white;
        border: 1px solid #d1d5db;
        border-radius: 0.375rem;
        margin-top: 0.25rem;
        z-index: 10;
      }

      .option-item {
        padding: 0.5rem 0.75rem;
        cursor: pointer;
      }

      .option-item.selected,
      .option-item:hover {
        background-color: #e5e7eb;
      }
    </style>
  </template>
}

export class AddressInfo extends FieldDef {
  static displayName = 'Mailing Address';
  @field address = contains(StringField, {
    description: `Mailing Address`,
  });
  @field zip = contains(StringField, {
    description: `Mailing Zip/Postal Code`,
  });
  @field city = contains(StringField, {
    description: `Mailing City`,
  });
  @field state = contains(StringField, {
    description: `Mailing State/Province`,
  });
  @field country = contains(StringField, {
    description: `Mailing Country`,
  });
  @field countryCode = contains(StringField, {
    description: `Mailing Country Code`,
  });
  @field stateCode = contains(StringField, {
    description: `Mailing State Code`,
  });

  @field mapUrl = contains(StringField, {
    computeVia: function (this: AddressInfo) {
      let searchCountry =
        this.address +
        ' ' +
        this.zip +
        ' ' +
        this.city +
        ' ' +
        this.state +
        ' ' +
        this.country;

      return `https://maps.google.com/maps?q=${searchCountry}&t=&z=13&ie=UTF8&iwloc=&output=embed`;
    },
  });

  static embedded = View;
  static edit = Edit;
}
