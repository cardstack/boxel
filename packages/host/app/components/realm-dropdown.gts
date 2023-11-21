import Component from '@glimmer/component';
import { service } from '@ember/service';

import { DropdownButton } from '@cardstack/boxel-ui/components';
import { DropdownArrowDown } from '@cardstack/boxel-ui/icons';
import { type RealmInfo, RealmPaths } from '@cardstack/runtime-common';

import type RealmInfoService from '../services/realm-info-service';
import RealmIcon from './operator-mode/realm-icon';

export interface RealmDropdownItem extends RealmInfo {
  path: string;
  iconURL: string | null;
}

interface Signature {
  Args: {
    onSelect: (item: RealmDropdownItem) => void;
    selectedRealmURL: URL | undefined;
    disabled?: boolean;
  };
  Element: HTMLElement;
}

export default class RealmDropdown extends Component<Signature> {
  <template>
    <DropdownButton
      class='realm-dropdown'
      @items={{this.realms}}
      @onSelect={{@onSelect}}
      @selectedItem={{this.selectedRealm}}
      @disabled={{@disabled}}
      @kind='secondary-light'
      @size='small'
      data-test-realm-dropdown
      data-test-realm-name={{this.selectedRealm.name}}
      ...attributes
    >
      <RealmIcon
        class='icon'
        width='20'
        height='20'
        @realmIconURL={{if
          this.selectedRealm.iconURL
          this.selectedRealm.iconURL
          this.defaultRealmIcon
        }}
        @realmName={{this.selectedRealm.name}}
      />
      <div class='selected-item'>
        {{if this.selectedRealm this.selectedRealm.name 'Select'}}
      </div>
      <DropdownArrowDown class='arrow-icon' width='22px' height='22px' />
    </DropdownButton>
    <style>
      .realm-dropdown {
        width: var(--realm-dropdown-trigger-width, auto);
        display: flex;
        justify-content: flex-start;
        gap: var(--boxel-sp-xxs);
        border-radius: var(--boxel-border-radius);
      }
      .arrow-icon {
        --icon-color: var(--boxel-highlight);
        margin-left: auto;
        flex-shrink: 0;
      }
      .realm-dropdown[aria-expanded='true'] .arrow-icon {
        transform: rotate(180deg);
      }
      .selected-item {
        text-overflow: ellipsis;
        overflow: hidden;
        white-space: nowrap;
      }
    </style>
  </template>

  @service declare realmInfoService: RealmInfoService;

  constructor(owner: unknown, args: Signature['Args']) {
    super(owner, args);
    this.realmInfoService.fetchAllKnownRealmInfos.perform();
  }

  get realms(): RealmDropdownItem[] {
    let items: RealmDropdownItem[] | [] = [];
    for (let [
      path,
      realmInfo,
    ] of this.realmInfoService.cachedRealmInfos.entries()) {
      let item: RealmDropdownItem = {
        path,
        ...realmInfo,
        iconURL: realmInfo.iconURL ?? this.defaultRealmIcon,
      };
      items = [item, ...items];
    }
    return items;
  }

  defaultRealmIcon = '/default-realm-icon.png';

  get selectedRealm(): RealmDropdownItem | undefined {
    if (!this.args.selectedRealmURL) {
      return;
    }
    return this.realms.find(
      (realm) =>
        realm.path === new RealmPaths(this.args.selectedRealmURL as URL).url,
    );
  }
}
