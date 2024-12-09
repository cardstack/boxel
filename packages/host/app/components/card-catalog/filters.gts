import Component from '@glimmer/component';

import { BoxelDropdown, Button, Menu } from '@cardstack/boxel-ui/components';
import { MenuItem } from '@cardstack/boxel-ui/helpers';
import { DropdownArrowDown } from '@cardstack/boxel-ui/icons';

import { RealmInfo } from '@cardstack/runtime-common';

interface Signature {
  availableRealms: Record<string, RealmInfo> | undefined;
  selectedRealmUrls: string[];
  onSelectRealm: (realmUrl: string) => void;
  onDeselectRealm: (realmUrl: string) => void;
  disableRealmFilter: boolean;
}

export default class CardCatalogFilters extends Component<Signature> {
  get realmMenuItems() {
    if (!this.args.availableRealms) {
      return [];
    }
    return Object.entries(this.args.availableRealms).map(
      ([realmUrl, realmInfo]) => {
        return new MenuItem(realmInfo.name, 'action', {
          action: () => {
            let isSelected = this.args.selectedRealmUrls.includes(realmUrl);

            if (isSelected) {
              this.args.onDeselectRealm(realmUrl);
            } else {
              this.args.onSelectRealm(realmUrl);
            }

            return false;
          },
          selected: this.args.selectedRealmUrls.includes(realmUrl),
          iconURL: realmInfo.iconURL ?? 'default-realm-icon.png',
        });
      },
    );
  }

  get realmFilterSummary() {
    if (
      this.args.selectedRealmUrls.length ===
      Object.keys(this.args.availableRealms || {}).length
    ) {
      return 'All';
    }
    return (
      this.args.selectedRealmUrls
        .map((realmUrl: string) => this.args.availableRealms?.[realmUrl]?.name)
        .join(', ') || 'None selected'
    );
  }

  <template>
    <BoxelDropdown>
      <:trigger as |bindings|>
        <Button
          class='filter-dropdown-trigger'
          @kind='secondary-light'
          @size='small'
          @disabled={{@disableRealmFilter}}
          {{bindings}}
          data-test-realm-filter-button
        >
          <div class='selected-item'>
            Workspace:
            {{this.realmFilterSummary}}
          </div>
          <DropdownArrowDown
            class='dropdown-arrow'
            width='13px'
            height='13px'
          />
        </Button>
      </:trigger>
      <:content as |dd|>
        <Menu
          class='filter-menu'
          @closeMenu={{dd.close}}
          @items={{this.realmMenuItems}}
        />
      </:content>
    </BoxelDropdown>
    <style scoped>
      .filter-dropdown-trigger {
        height: 37px;
        width: fit-content;
        min-width: 15rem;
        max-width: 100%;
        display: flex;
        justify-content: flex-start;
        gap: var(--boxel-sp-sm);
        padding: var(--boxel-sp-5xs) var(--boxel-sp-sm);
        border-radius: var(--boxel-border-radius-xxl);
      }
      .dropdown-arrow {
        flex-shrink: 0;
        margin-left: auto;
      }
      .filter-dropdown-trigger[aria-expanded='true'] .dropdown-arrow {
        transform: scaleY(-1);
      }
      .selected-item {
        max-width: 100%;
        text-overflow: ellipsis;
        overflow: hidden;
        white-space: nowrap;
      }
      .filter-menu {
        --boxel-menu-item-content-padding: var(--boxel-sp-xs);
        --boxel-menu-item-gap: var(--boxel-sp-xs);
        min-width: 15rem;
      }
      .filter-menu :deep(.menu-item__icon-url) {
        border-radius: var(--boxel-border-radius-xs);
      }
    </style>
  </template>
}
