import GlimmerComponent from '@glimmer/component';
import { type Sort, baseRRI } from '@cardstack/runtime-common';
import {
  BoxelButton,
  BoxelDropdown,
  Menu as BoxelMenu,
} from '@cardstack/boxel-ui/components';
import { MenuItem } from '@cardstack/boxel-ui/helpers';
import { DropdownArrowFilled } from '@cardstack/boxel-ui/icons';

// 🧩 PATTERN: Typed sort menu.
//
// Shared `Sort` constants + a `SortMenu` component for browse views.

// === Sort constants (re-usable across the realm) ======================

export const sortByCardTitleAsc: Sort = [
  {
    on: { module: baseRRI('card-api'), name: 'CardDef' },
    by: 'cardTitle',
    direction: 'asc',
  },
];

export const sortByCardTitleDesc: Sort = [
  {
    on: { module: baseRRI('card-api'), name: 'CardDef' },
    by: 'cardTitle',
    direction: 'desc',
  },
];

// === Option shape =====================================================

export interface SortOption {
  id: string;
  displayName: string;
  sort: Sort;
}

// === Menu component ===================================================

interface SortMenuSignature {
  Args: {
    options: SortOption[];
    onSort: (option: SortOption) => void;
    selected: SortOption;
  };
  Element: HTMLElement;
}

export class SortMenu extends GlimmerComponent<SortMenuSignature> {
  get menuItems() {
    return this.args.options.map(opt =>
      new MenuItem(opt.displayName, 'action', {
        action: () => this.args.onSort(opt),
        selected: opt.id === this.args.selected.id,
      }),
    );
  }

  <template>
    <BoxelDropdown ...attributes>
      <:trigger as |bindings|>
        <BoxelButton {{bindings}}>
          {{@selected.displayName}}
          <DropdownArrowFilled aria-hidden='true' />
        </BoxelButton>
      </:trigger>
      <:content as |dd|>
        <BoxelMenu @items={{this.menuItems}} @closeMenu={{dd.close}} />
      </:content>
    </BoxelDropdown>
  </template>
}
