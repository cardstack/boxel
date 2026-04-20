import { contains, field, Component, CardDef, FieldDef } from './card-api';
import StringField from './string';
import World from '@cardstack/boxel-icons/world';
import MapPinned from '@cardstack/boxel-icons/map-pinned';
import { BoxelSelect } from '@cardstack/boxel-ui/components';
import { markdownEscape } from '@cardstack/boxel-ui/helpers';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { restartableTask } from 'ember-concurrency';
import type Owner from '@ember/owner';
// @ts-ignore
import { countries as countryData } from './helpers/country';

export class Country extends CardDef {
  static displayName = 'Country';
  static icon = World;
  @field name = contains(StringField);
  @field cardTitle = contains(StringField, {
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
  emoji?: string;
}

class CountryFieldEdit extends Component<typeof CountryField> {
  @tracked country: CountryData | undefined =
    this.args.model.name && this.args.model.code
      ? {
          name: this.args.model.name,
          code: this.args.model.code,
        }
      : undefined;
  @tracked countries: CountryData[] = [];

  constructor(owner: Owner, args: any) {
    super(owner, args);
    this.loadCountries.perform();
  }

  private loadCountries = restartableTask(async () => {
    this.countries = Object.values(countryData).map((country: any) => {
      return {
        code: country.ISO2_CODE,
        name: country.LIST_OF_NAME.ENG[0],
        emoji: getCountryFlagEmoji(country.ISO2_CODE),
      } as CountryData;
    });
  });

  @action onSelectCountry(country: CountryData) {
    this.country = country;
    this.args.model.name = country.name;
    this.args.model.code = country.code;
  }

  @action countryEmoji(countryCode: string) {
    return this.countries?.find((country) => country.code === countryCode)
      ?.emoji;
  }

  <template>
    {{#if this.loadCountries.isRunning}}
      Loading countries...
    {{else}}
      <BoxelSelect
        @placeholder='Choose a country'
        @options={{this.countries}}
        @selected={{this.country}}
        @onChange={{this.onSelectCountry}}
        @searchEnabled={{true}}
        @searchField='name'
        as |country|
      >
        {{#let (this.countryEmoji country.code) as |emoji|}}
          {{emoji}}
        {{/let}}
        {{country.name}}
      </BoxelSelect>
    {{/if}}
  </template>
}

export default class CountryField extends FieldDef {
  static displayName = 'Country';
  static icon = MapPinned;
  @field name = contains(StringField);
  @field code = contains(StringField);
  static edit = CountryFieldEdit;

  static atom = class Atom extends Component<typeof this> {
    <template>
      {{#if @model.name}}
        {{@model.name}}
      {{/if}}
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      {{@model.name}}
    </template>
  };

  // CS-10786: the country's display name, markdown-escaped. The ISO code is
  // omitted — downstream markdown consumers care about the human-readable
  // label; the code is available programmatically on the field.
  static markdown = class Markdown extends Component<typeof this> {
    get text() {
      return markdownEscape(this.args.model?.name);
    }
    <template>{{this.text}}</template>
  };
}

export class CardWithCountryField extends CardDef {
  static displayName = 'Card With Country Field';
  @field country = contains(CountryField);

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <@fields.country @format='atom' />
    </template>
  };
}
