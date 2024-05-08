import {
  FieldDef,
  field,
  contains,
  StringField,
  containsMany,
} from 'https://cardstack.com/base/card-api';
import { Component } from 'https://cardstack.com/base/card-api';
import { BoxelDropdown, Menu, Button } from '@cardstack/boxel-ui/components';
import { DropdownArrowDown } from '@cardstack/boxel-ui/icons';
import { menuItemFunc } from '@cardstack/boxel-ui/helpers';

class Edit extends Component<typeof Dropdown> {
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
    <style>
      .dropdown-trigger {
        padding: 0 15px;
        width: 160px;
        display: flex;
        justify-content: space-between;
        align-items: center;
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

export class Dropdown extends FieldDef {
  static displayName = 'Dropdown';
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
