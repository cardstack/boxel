import {
  FieldDef,
  CardDef,
  field,
  containsMany,
  StringField,
  contains,
} from 'https://cardstack.com/base/card-api';
import { Component } from 'https://cardstack.com/base/card-api';

import { BoxelDropdown, Menu, Button } from '@cardstack/boxel-ui/components';
import { menuItemFunc } from '@cardstack/boxel-ui/helpers';
import { DropdownArrowDown } from '@cardstack/boxel-ui/icons';

class Edit extends Component<typeof DropdownField> {
  <template>
    <BoxelDropdown>
      <:trigger as |bindings|>
        <Button {{bindings}} class='dropdown-trigger'>
          {{if @model.selectedValue @model.selectedValue 'Please select'}}
          <DropdownArrowDown width='12px' height='12px' />
        </Button>
      </:trigger>
      <:content as |dd|>
        <Menu @closeMenu={{dd.close}} @items={{this.menuItems}} />
      </:content>
    </BoxelDropdown>
    <style scoped>
      .dropdown-trigger {
        padding: 0 15px;
        min-width: 160px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 10px;
      }
    </style>
  </template>

  get menuItems() {
    return this.args.model.options?.map((v: string) =>
      menuItemFunc([v, () => (this.args.model.selectedValue = v)], {
        selected: this.args.model.selectedValue === v,
      }),
    );
  }
}

class DropdownField extends FieldDef {
  static displayName = 'Dropdown Field';
  @field options = containsMany(StringField);
  @field selectedValue = contains(StringField);
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <@fields.selectedValue />
    </template>
  };
  static atom = class Atom extends Component<typeof this> {
    <template>
      <@fields.selectedValue />
    </template>
  };
  static edit = Edit;
  /*
  static isolated = class Isolated extends Component<typeof this> {
    <template></template>
  };
  */
}

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
  static displayName = 'Toxicity';
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
