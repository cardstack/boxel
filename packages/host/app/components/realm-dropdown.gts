import Component from '@glimmer/component';
import { service } from '@ember/service';

import { DropdownButton } from '@cardstack/boxel-ui/components';
import { type RealmInfo } from '@cardstack/runtime-common';

import type RealmInfoService from '../services/realm-info-service';

export interface RealmDropdownItem extends RealmInfo {
  path: string;
}

interface Signature {
  Args: {
    selectedRealm: RealmDropdownItem | undefined;
    onSelect: (item: RealmDropdownItem) => void;
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
      @selectedItem={{@selectedRealm}}
      @disabled={{@disabled}}
      @kind='secondary-light'
      @size='small'
      data-test-realm-dropdown
      ...attributes
    >
      {{if @selectedRealm 'Change' 'Select'}}
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
}
