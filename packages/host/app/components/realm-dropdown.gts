import Component from '@glimmer/component';
import { service } from '@ember/service';

import { BoxelDropdown, Button, Menu } from '@cardstack/boxel-ui/components';
import { MenuItem } from '@cardstack/boxel-ui/helpers';
import { DropdownArrowDown } from '@cardstack/boxel-ui/icons';
import { type RealmInfo, RealmPaths } from '@cardstack/runtime-common';

import type RealmInfoService from '../services/realm-info-service';
import RealmIcon from './operator-mode/realm-icon';

export interface RealmDropdownItem extends RealmInfo {
  path: string;
}

interface Signature {
  Args: {
    onSelect: (item: RealmDropdownItem) => void;
    selectedRealmURL: URL | undefined;
    disabled?: boolean;
    contentClass?: string;
  };
  Element: HTMLElement;
}

export default class RealmDropdown extends Component<Signature> {
  <template>
    <BoxelDropdown @contentClass={{@contentClass}}>
      <:trigger as |bindings|>
        <Button
          class='realm-dropdown-trigger'
          @kind='secondary-light'
          @size='small'
          @disabled={{@disabled}}
          {{bindings}}
          data-test-realm-dropdown-trigger
          data-test-realm-name={{this.selectedRealm.name}}
          ...attributes
        >
          {{#if this.selectedRealm}}
            <RealmIcon
              class='icon'
              width='20'
              height='20'
              @realmIconURL={{this.selectedRealm.iconURL}}
              @realmName={{this.selectedRealm.name}}
            />
            <div class='selected-item'>
              {{this.selectedRealm.name}}
            </div>
          {{else}}
            Select a realm
          {{/if}}
          <DropdownArrowDown class='arrow-icon' width='22px' height='22px' />
        </Button>
      </:trigger>
      <:content as |dd|>
        <Menu
          @items={{this.menuItems}}
          @closeMenu={{dd.close}}
          data-test-realm-dropdown-menu
        />
      </:content>
    </BoxelDropdown>
    <style>
      .realm-dropdown-trigger {
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
      .realm-dropdown-trigger[aria-expanded='true'] .arrow-icon {
        transform: rotate(180deg);
      }
      .selected-item {
        text-overflow: ellipsis;
        overflow: hidden;
        white-space: nowrap;
      }
    </style>
  </template>

  defaultRealmIcon = '/default-realm-icon.png';
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

  get menuItems(): MenuItem[] {
    return this.realms.map(
      (realm) =>
        new MenuItem(realm.name, 'action', {
          action: () => this.args.onSelect(realm),
          selected: realm.name === this.selectedRealm?.name,
          iconURL: realm.iconURL ?? undefined,
        }),
    );
  }

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
