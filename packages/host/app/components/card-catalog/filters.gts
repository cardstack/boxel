import Component from '@glimmer/component';

import { BoxelDropdown, Menu } from '@cardstack/boxel-ui/components';
import { MenuItem } from '@cardstack/boxel-ui/helpers';

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
    <div class='filter-container'>
      <div class='filter'>
        <BoxelDropdown>
          <:trigger as |bindings|>
            <button
              {{bindings}}
              disabled={{@disableRealmFilter}}
              data-test-realm-filter-button
            >
              Workspace:
              {{this.realmFilterSummary}}
            </button>
          </:trigger>
          <:content as |dd|>
            <Menu @closeMenu={{dd.close}} @items={{this.realmMenuItems}} />
          </:content>
        </BoxelDropdown>
      </div>
    </div>

    <style>
      .filter-container {
        --filter-height: 30px;
        display: flex;
        gap: var(--boxel-sp-xs);
        font: 500 var(--boxel-font-sm);
      }
      .add-filter-button {
        --icon-color: var(--boxel-highlight);
        border: 1px solid var(--boxel-400);
        border-radius: 100px;
        width: var(--filter-height);
        height: var(--filter-height);
        display: flex;
        justify-content: center;
        align-items: center;
      }
      .add-filter-button {
        border-color: var(--boxel-dark);
      }
      .filter {
        position: relative;
        height: var(--filter-height);
        border: 1px solid var(--boxel-400);
        border-radius: 20px;
        padding-right: var(--boxel-sp-lg);
        padding-left: var(--boxel-sp-sm);
        display: flex;
        align-items: center;
      }
      .filter > button {
        border: none;
        background: inherit;
      }
    </style>
  </template>
}
