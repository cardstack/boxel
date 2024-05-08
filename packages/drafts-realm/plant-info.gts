import { Dropdown as DropdownField } from './dropdown';
import {
  CardDef,
  field,
  containsMany,
  StringField,
  contains,
} from 'https://cardstack.com/base/card-api';
import { Component } from 'https://cardstack.com/base/card-api';

class LightRequirementDropdown extends DropdownField {
  static displayName = 'Light Requirement';
  static _options = ['Full Sun', 'Partial Sun', 'Partial Shade', 'Full Shade'];
  @field options = containsMany(StringField, {
    computeVia: function () {
      return LightRequirementDropdown._options;
    },
  });
}

class ToxicityDropdown extends DropdownField {
  static displayName = 'Toxicity for Dogs';
  static _options = ['Toxic', 'Non-Toxic', 'No Information'];
  @field options = containsMany(StringField, {
    computeVia: function () {
      return ToxicityDropdown._options;
    },
  });
}

class SeasonsDropdown extends DropdownField {
  static displayName = 'Season';
  static _options = ['Spring', 'Summer', 'Fall', 'Winter'];
  @field options = containsMany(StringField, {
    computeVia: function () {
      return SeasonsDropdown._options;
    },
  });
}

export class PlantInfo extends CardDef {
  @field commonName = containsMany(StringField);
  @field scientificName = contains(StringField);
  @field lightRequirement = containsMany(LightRequirementDropdown);
  @field toxicityForDogs = contains(ToxicityDropdown);
  @field attracts = containsMany(StringField);
  @field height = contains(StringField);
  @field spacing = contains(StringField);
  @field spread = contains(StringField);
  @field seasonOfInterest = containsMany(SeasonsDropdown);
  static displayName = 'Plant Info';

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
