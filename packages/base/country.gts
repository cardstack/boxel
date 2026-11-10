import { contains, field, Component, CardDef, FieldDef } from './card-api';
import StringField from './string';
import World from '@cardstack/boxel-icons/world';
import MapPinned from '@cardstack/boxel-icons/map-pinned';
import { Select } from '@cardstack/pretui/components/select';
import type { SelectOption } from '@cardstack/pretui/components/select';
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
    <template><@fields.name /></template>
  };
}

function getCountryFlagEmoji(countryCode: string) {
  const codePoints = countryCode
    .toUpperCase()
    .split('')
    .map((char) => 127397 + char.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}

class CountryFieldEdit extends Component<typeof CountryField> {
  // Each country's ISO code is its value; its flag leads its name.
  @tracked countries: SelectOption[] = [];

  constructor(owner: Owner, args: any) {
    super(owner, args);
    this.loadCountries.perform();
  }

  private loadCountries = restartableTask(async () => {
    this.countries = Object.values(countryData).map((country: any) => ({
      value: country.ISO2_CODE,
      label: country.LIST_OF_NAME.ENG[0],
      glyph: getCountryFlagEmoji(country.ISO2_CODE),
    }));
  });

  get code() {
    return this.args.model.code ?? undefined;
  }

  @action onSelectCountry(code: string) {
    let country = this.countries.find((option) => option.value === code);
    if (!country) {
      return;
    }
    this.args.model.name = country.label;
    this.args.model.code = country.value;
  }

  <template>
    {{#if this.loadCountries.isRunning}}
      Loading countries...
    {{else}}
      <Select
        @placeholder='Choose a country'
        @options={{this.countries}}
        @value={{this.code}}
        @onValueChange={{this.onSelectCountry}}
        @searchEnabled={{true}}
        class='country-field-edit'
      />
    {{/if}}
    <style scoped>
      /* the app's full control size, beside the edit form's other inputs */
      .country-field-edit {
        --pretui-field-h: var(--boxel-form-control-height);
        --pretui-field-font-size: var(--boxel-font-size-sm);
      }
    </style>
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
    <template>{{@model.name}}</template>
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
    <template><@fields.country @format='atom' /></template>
  };
}
