import {
  FieldDef,
  field,
  contains,
  StringField,
  containsMany,
} from 'https://cardstack.com/base/card-api';
import { Component } from 'https://cardstack.com/base/card-api';
import { BoxelDropdown, Menu } from '@cardstack/boxel-ui/components';
import { menuItemFunc } from '@cardstack/boxel-ui/helpers';

class Edit extends Component<typeof Dropdown> {
  <template>
    <BoxelDropdown>
      <:trigger as |bindings|>
        <button {{bindings}}>
          {{if @model.selectedValue @model.selectedValue 'Please select'}}
        </button>
      </:trigger>
      <:content>
        <Menu @items={{this.menuItems}} />
      </:content>
    </BoxelDropdown>
  </template>

  get menuItems() {
    return this.args.model.displayValues?.map((v: string) =>
      menuItemFunc([v, () => (this.args.model.selectedValue = v)], {
        selected: this.args.model.selectedValue === v,
      }),
    );
  }
}

export class Dropdown extends FieldDef {
  static displayName = 'Dropdown';
  @field fieldDisplayName = contains(StringField);
  @field displayValues = containsMany(StringField);
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
