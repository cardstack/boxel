import Component from '@glimmer/component';
import { service } from '@ember/service';

import { DropdownButton } from '@cardstack/boxel-ui/components';
import { type RealmInfo, RealmPaths } from '@cardstack/runtime-common';

import type RealmInfoService from '../services/realm-info-service';

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
      class='realm-dropdown-button'
      @items={{this.realms}}
      @onSelect={{@onSelect}}
      @selectedItem={{this.selectedRealm}}
      @disabled={{@disabled}}
      @kind='secondary-light'
      @size='small'
      data-test-realm-dropdown
      ...attributes
    >
      {{if this.selectedRealm 'Change' 'Select'}}
    </DropdownButton>
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
      };
      items = [item, ...items];
    }
    return items;
  }

  get selectedRealm(): RealmDropdownItem | undefined {
    let { selectedRealmURL } = this.args;
    if (!selectedRealmURL) {
      return;
    }
    return this.realms.find(
      (realm) => realm.path === new RealmPaths(selectedRealmURL as URL).url,
    );
  }
}
