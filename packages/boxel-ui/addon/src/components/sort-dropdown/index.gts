import Component from '@glimmer/component';

import { MenuDivider } from '../../helpers/menu-divider.ts';
import { MenuItem } from '../../helpers/menu-item.ts';
import DropdownIcon from '../../icons/dropdown-arrow-down.gts';
import BoxelButton from '../button/index.gts';
import BoxelDropdown from '../dropdown/index.gts';
import BoxelMenu from '../menu/index.gts';

export interface SortOption {
  displayName: string;
  sort: any;
}

interface Signature {
  Args: {
    onSelect: (option: SortOption) => void;
    options: SortOption[] | (MenuItem | MenuDivider)[];
    selectedOption?: SortOption;
  };
  Element: HTMLElement;
}

export default class SortDropdown extends Component<Signature> {
  <template>
    <div class='sort-options-group' ...attributes>
      Sort by
      <div>
        <BoxelDropdown>
          <:trigger as |bindings|>
            <BoxelButton
              @kind='secondary-light'
              class='sort-button'
              {{bindings}}
            >
              {{if @selectedOption @selectedOption.displayName 'Please Select'}}
              <DropdownIcon width='12px' height='12px' />
            </BoxelButton>
          </:trigger>
          <:content as |dd|>
            {{#if this.menuOptions}}
              <BoxelMenu @closeMenu={{dd.close}} @items={{this.menuOptions}} />
            {{/if}}
          </:content>
        </BoxelDropdown>
      </div>
    </div>

    <style scoped>
      @layer boxelComponentL2 {
        .sort-options-group {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: var(--boxel-sp-xxs) var(--boxel-sp-sm);
          text-wrap: nowrap;
        }
        .sort-button {
          border-radius: var(--boxel-border-radius);
          min-width: 200px;
          justify-content: flex-start;
          padding-left: var(--boxel-sp-sm);
          padding-right: var(--boxel-sp-sm);
        }
        .sort-button > svg {
          margin-left: auto;
        }
      }
    </style>
  </template>

  private get menuOptions(): (MenuItem | MenuDivider)[] | undefined {
    if (!this.args.options?.length) {
      return undefined;
    }
    let option = this.args.options[0];
    if (option instanceof MenuItem || option instanceof MenuDivider) {
      return this.args.options as (MenuItem | MenuDivider)[];
    }
    return (this.args.options as SortOption[]).map(
      (option) =>
        new MenuItem({
          label: option.displayName,
          action: () => this.args.onSelect(option),
        }),
    );
  }
}
