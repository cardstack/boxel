import Component from '@glimmer/component';
import { BoxelDropdown, Button, Menu } from '@cardstack/boxel-ui/components';
import { MenuItem } from '@cardstack/boxel-ui/helpers';
import {
  type BoxelButtonSize,
  type BoxelButtonKind,
} from '../button/index.gts';

type DropdownItem = {
  name: string;
};

interface Signature {
  Args: {
    items: DropdownItem[] | MenuItem[] | [];
    onSelect?: (item: DropdownItem) => void;
    selectedItem?: DropdownItem | undefined;
    disabled?: boolean;
    kind?: BoxelButtonKind;
    size?: BoxelButtonSize;
  };
  Element: HTMLElement;
  Blocks: {
    default: [];
  };
}

export default class DropdownButton extends Component<Signature> {
  <template>
    <BoxelDropdown>
      <:trigger as |bindings|>
        <Button
          {{bindings}}
          @kind={{@kind}}
          @size={{@size}}
          @disabled={{@disabled}}
          data-test-dropdown-button
          ...attributes
        >
          {{yield}}
        </Button>
      </:trigger>
      <:content as |dd|>
        <Menu @items={{this.menuItems}} @closeMenu={{dd.close}} />
      </:content>
    </BoxelDropdown>
  </template>

  get menuItems() {
    return this.args.items.map((item) => {
      if (item instanceof MenuItem) {
        return item;
      }

      return new MenuItem(item.name, 'action', {
        action: () => {
          if (!this.args.onSelect) {
            throw new Error(
              'You must provide an `onSelect` action to `DropdownButton` when using an array of `items`',
            );
          }
          this.args.onSelect(item);
        },
        selected: item.name === this.args.selectedItem?.name,
      });
    });
  }
}
