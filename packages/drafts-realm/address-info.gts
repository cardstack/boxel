import { FieldDef, field, contains } from 'https://cardstack.com/base/card-api';
import { Component } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

import {
  BoxelSelect,
  FieldContainer,
  CardContainer,
  BoxelInput,
} from '@cardstack/boxel-ui/components';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { eq } from '@cardstack/boxel-ui/helpers';
import {
  Country,
  State,
  City,
} from 'https://cdn.jsdelivr.net/npm/country-state-city@3.2.1/+esm';

// import govukCountryAndTerritoryAutocomplete from 'https://cdn.jsdelivr.net/npm/govuk-country-and-territory-autocomplete@1.0.2/+esm';
// import openregisterPickerEngine from 'https://cdn.jsdelivr.net/npm/openregister-picker-engine@1.2.1/+esm';
// import accessibleAutocomplete from 'https://cdn.jsdelivr.net/npm/accessible-autocomplete@3.0.0/+esm';

class View extends Component<typeof AddressInfo> {
  get placeUrl() {
    return this.args.model.mapUrl;
  }

  <template>
    <div class='address-info'>
      <div><@fields.address /></div>
      <div><@fields.city /></div>
      <div><@fields.state /></div>
      <div><@fields.zip /></div>
      <div><@fields.country /></div>
    </div>

    <div class='map-container'>
      <iframe
        id='gmap_canvas'
        width={{600}}
        height={{400}}
        referrerpolicy='no-referrer-when-downgrade'
        src={{this.placeUrl}}
        loading='lazy'
        center='true'
        style='pointer-events: none;'
      ></iframe>
    </div>

    <style
    >

      {{! .map-container {
        overflow: hidden;
        padding-bottom: 56.25%;
        position: relative;
        height: 100%;
        width: 100%;
      }

      .map-container iframe {
        left: 0;
        top: 0;
        height: 100%;
        width: 100%;
        position: absolute;
      } }}
    </style>
  </template>
}

class Edit extends Component<typeof AddressInfo> {
  @tracked stateCode = '';

  @tracked selectedCountryType = {
    name: this.args.model.country || 'Select',
  };
  @tracked selectedStateType = {
    name: this.args.model.state || 'Select',
  };
  @tracked selectedCityType = {
    name: this.args.model.city || 'Select',
  };

  get allCountries() {
    return Country.getAllCountries();
  }

  get allStatesOfCountry() {
    return State.getStatesOfCountry(this.args.model.countryCode);
  }

  get allCitiesOfState() {
    return City.getCitiesOfState(this.args.model.countryCode, this.stateCode);
  }

  // get isValidStates() {
  //   return this.allStatesOfCountry.length === 0;
  // }

  @action
  updateCountry(type: any) {
    this.args.model.countryCode = type.isoCode;
    this.selectedCountryType = type;
    this.args.model.country = type.name;

    const states = this.allStatesOfCountry;
    if (states.length > 0) {
      this.updateState(states[0]);
    } else {
      this.selectedStateType = { name: 'Select' };
      this.stateCode = '';
      this.args.model.state = '';
      this.selectedCityType = { name: 'Select' };
      this.args.model.city = '';
    }
  }

  @action
  updateState(type: any) {
    if (type.isoCode) {
      this.stateCode = type.isoCode;
      this.selectedStateType = type;
      this.args.model.state = type.name;

      const cities = this.allCitiesOfState;
      if (cities.length > 0) {
        this.updateCity(cities[0]);
      } else {
        this.selectedCityType = { name: 'Select' };
        this.args.model.city = '';
      }
    } else {
      this.selectedStateType = { name: 'Select' };
      this.stateCode = '';
      this.args.model.state = '';
      this.selectedCityType = { name: 'Select' };
      this.args.model.city = '';
    }
  }

  @action
  updateCity(type) {
    this.selectedCityType = type;
    this.args.model.city = type.name;
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
          id='location-autocomplete'
          class='select'
          as |item|
        >
          <div>{{item.name}}</div>
        </BoxelSelect>

      </FieldContainer>

      <FieldContainer @tag='label' @label='State' @vertical={{true}}>
        <BoxelSelect
          @placeholder='Select'
          @selected={{this.selectedStateType}}
          @onChange={{this.updateState}}
          @options={{this.allStatesOfCountry}}
          {{!-- @disabled={{this.isValidStates}} --}}
          id='location-autocomplete'
          class='select'
          as |item|
        >
          <div>{{item.name}}</div>
        </BoxelSelect>
      </FieldContainer>

      <FieldContainer @tag='label' @label='City' @vertical={{true}}>
        <BoxelSelect
          @placeholder='Select'
          @selected={{this.selectedCityType}}
          @onChange={{this.updateCity}}
          @options={{this.allCitiesOfState}}
          id='location-autocomplete'
          class='select'
          as |item|
        >
          <div>{{item.name}}</div>
        </BoxelSelect>
      </FieldContainer>

      <FieldContainer
        @tag='label'
        @label='Country Code'
        @vertical={{true}}
      ><@fields.countryCode /></FieldContainer>
    </CardContainer>

    <style>
      .card-container {
        padding: 2rem 1rem;
        display: grid;
        gap: var(--boxel-sp-sm);
        grid-template-columns: 1fr;
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

      @media (min-width: 768px) {
        .card-container {
          grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
        }
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

  // static atom = View;
  static embedded = View;
  static edit = Edit;
}

//  <div class='autocomplete-select'>
//         <input
//           type='text'
//           class='select-input'
//           placeholder={{this.countryPlaceholder}}
//           value={{this.filterCountry}}
//           {{on 'input' this.updateFilter}}
//         />

//         {{#if this.filterCountry}}
//           <ul class='options-list'>
//             {{#each this.allCountriesByCode as |option|}}
//               <li class='option-item' {{on 'click' this.selectOption option}}>
//                 {{option.name}}
//               </li>
//             {{/each}}
//           </ul>
//         {{/if}}
//       </div>
