import Component from '@glimmer/component';
import { BoxelDropdown, Menu } from '@cardstack/boxel-ui';
import { MenuItem } from '@cardstack/boxel-ui/helpers/menu-item';
import { type RealmCards } from '../card-catalog-modal';

interface Signature {
  availableRealms: RealmCards[];
  selectedRealms: RealmCards[];
  onSelectRealm: (realm: RealmCards) => void;
  onDeselectRealm: (realm: RealmCards) => void;
}

export default class CardCatalogFilters extends Component<Signature> {
  get realmMenuItems() {
    return this.args.availableRealms.map((realm) => {
      return new MenuItem(realm.realmInfo.name, 'action', {
        action: () => {
          let isSelected = this.args.selectedRealms
            .map((realm) => realm.url)
            .includes(realm.url);

          // Toggle selection - if the item selected, deselect it, if not, select it
          if (isSelected) {
            this.args.onDeselectRealm(realm);
          } else {
            this.args.onSelectRealm(realm);
          }

          return false;
        },
        selected: this.args.selectedRealms
          .map((realm) => realm.url)
          .includes(realm.url),
      });
    });
  }

  get realmFilterSummary() {
    if (this.args.selectedRealms.length === 0) {
      return 'All';
    }
    return this.args.selectedRealms
      .map(({ realmInfo }) => realmInfo.name)
      .join(', ');
  }

  <template>
    <div class='filters'>
      <ul class='filter-list'>
        <li class='filter'>
          <BoxelDropdown>
            <:trigger as |bindings|>
              <button class='pill' {{bindings}}>
                Realm:
                {{this.realmFilterSummary}}
              </button>
            </:trigger>
            <:content as |dd|>
              <Menu @closeMenu={{dd.close}} @items={{this.realmMenuItems}} />
            </:content>
          </BoxelDropdown>
        </li>
      </ul>
    </div>

    <style>
      .filters {
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
      .filter-list {
        list-style-type: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-flow: row wrap;
        gap: var(--boxel-sp-xs);
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
