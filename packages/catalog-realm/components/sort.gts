import { get } from '@ember/object';
import GlimmerComponent from '@glimmer/component';

import { type Sort, baseRealm } from '@cardstack/runtime-common';

import {
  BoxelButton,
  BoxelDropdown,
  Menu as BoxelMenu,
} from '@cardstack/boxel-ui/components';
import { eq, MenuItem } from '@cardstack/boxel-ui/helpers';
import { DropdownArrowFilled } from '@cardstack/boxel-ui/icons';
import ArrowDown from '@cardstack/boxel-icons/arrow-down';
import ArrowUp from '@cardstack/boxel-icons/arrow-up';

export const sortByCardTitleAsc: Sort = [
  {
    on: {
      module: `${baseRealm.url}card-api`,
      name: 'CardDef',
    },
    by: 'title',
    direction: 'asc',
  },
];

export interface SortOption {
  id: string;
  displayName: string;
  sort: Sort;
}

interface SortMenuSignature {
  Args: {
    options: SortOption[];
    onSort: (option: SortOption) => void;
    selected: SortOption;
  };
  Element: HTMLElement;
}
export class SortMenu extends GlimmerComponent<SortMenuSignature> {
  <template>
    <div class='sort' ...attributes>
      Sort by
      <BoxelDropdown>
        <:trigger as |bindings|>
          <BoxelButton class='sort-trigger' {{bindings}}>
            <span class='sort-trigger-content'>
              {{@selected.displayName}}
              {{#if (eq (get @selected.sort '0.direction') 'desc')}}
                <ArrowDown width='16' height='16' />
              {{else}}
                <ArrowUp width='16' height='16' />
              {{/if}}
            </span>
            <DropdownArrowFilled
              class='sort-trigger-icon'
              width='10'
              height='10'
            />
          </BoxelButton>
        </:trigger>
        <:content as |dd|>
          <BoxelMenu
            class='sort-menu'
            @closeMenu={{dd.close}}
            @items={{this.sortOptions}}
          />
        </:content>
      </BoxelDropdown>
    </div>
    <style scoped>
      .sort {
        display: flex;
        align-items: center;
        gap: 0 var(--boxel-sp-sm);
        text-wrap: nowrap;
      }
      .sort :deep(.ember-basic-dropdown-content-wormhole-origin) {
        position: absolute; /* This prevents layout shift when menu opens */
      }

      .sort-trigger {
        --boxel-button-border-color: var(--boxel-450);
        width: 190px;
        justify-content: space-between;
        gap: var(--boxel-sp-xs);
        padding-right: var(--boxel-sp-xs);
        padding-left: var(--boxel-sp-xs);
        border-radius: var(--boxel-border-radius);
      }
      .sort-trigger[aria-expanded='true'] .sort-dropdown-icon {
        transform: scaleY(-1);
      }
      .sort-trigger-content {
        display: inline-flex;
        align-items: center;
        gap: var(--boxel-sp-xxxs);
      }
      .sort-trigger-icon {
        flex-shrink: 0;
      }

      .sort-menu {
        --boxel-menu-item-content-padding: var(--boxel-sp-xs);
        width: 190px;
      }
    </style>
  </template>

  private get sortOptions() {
    return this.args.options.map((option) => {
      return new MenuItem({
        label: option.displayName,
        action: () => this.args.onSort(option),
        icon: option.sort?.[0].direction === 'desc' ? ArrowDown : ArrowUp,
        checked:
          option.displayName === this.args.selected.displayName &&
          option.sort?.[0].direction === this.args.selected.sort?.[0].direction,
      });
    });
  }
}
