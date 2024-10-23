import { service } from '@ember/service';
import Component from '@glimmer/component';

import {
  BoxelDropdown,
  Button,
  Menu,
  RealmIcon,
} from '@cardstack/boxel-ui/components';
import { MenuItem, cssVar } from '@cardstack/boxel-ui/helpers';
import { DropdownArrowDown } from '@cardstack/boxel-ui/icons';

import { RealmPaths } from '@cardstack/runtime-common';

import { type EnhancedRealmInfo } from '@cardstack/host/services/realm';

import RealmService from '../services/realm';

export interface RealmDropdownItem extends EnhancedRealmInfo {
  path: string;
}

interface Signature {
  Args: {
    onSelect: (item: RealmDropdownItem) => void;
    selectedRealmURL: URL | undefined;
    disabled?: boolean;
    contentClass?: string;
    dropdownWidth?: string;
  };
  Element: HTMLElement;
}

export default class RealmDropdown extends Component<Signature> {
  <template>
    <BoxelDropdown
      @contentClass={{@contentClass}}
      data-test-load-realms-loaded='true'
    >
      <:trigger as |bindings|>
        <Button
          class='realm-dropdown-trigger'
          @kind='secondary-light'
          @size='small'
          @disabled={{@disabled}}
          style={{if
            @dropdownWidth
            (cssVar realm-dropdown-width=@dropdownWidth)
          }}
          {{bindings}}
          data-test-realm-dropdown-trigger
          data-test-realm-name={{this.selectedRealm.name}}
          ...attributes
        >
          {{#if this.selectedRealm}}
            <RealmIcon
              class='icon'
              width='18'
              height='18'
              @realmInfo={{this.selectedRealm}}
            />
            <div class='selected-item' data-test-selected-realm>
              {{this.selectedRealm.name}}
            </div>
          {{else}}
            Select a workspace
          {{/if}}
          <DropdownArrowDown class='arrow-icon' width='13px' height='13px' />
        </Button>
      </:trigger>
      <:content as |dd|>
        <Menu
          class='realm-dropdown-menu'
          style={{if
            @dropdownWidth
            (cssVar realm-dropdown-width=@dropdownWidth)
          }}
          @items={{this.menuItems}}
          @closeMenu={{dd.close}}
          data-test-realm-dropdown-menu
        />
      </:content>
    </BoxelDropdown>
    <style scoped>
      .realm-dropdown-trigger {
        width: var(--realm-dropdown-width, auto);
        display: flex;
        justify-content: flex-start;
        gap: var(--boxel-sp-5xs);
        padding: var(--boxel-sp-5xs) var(--boxel-sp-xxs) var(--boxel-sp-5xs)
          var(--boxel-sp-5xs);
        border-radius: var(--boxel-border-radius);
      }
      .arrow-icon {
        --icon-color: var(--boxel-highlight);
        margin-left: auto;
      }
      .realm-dropdown-trigger[aria-expanded='true'] .arrow-icon {
        transform: scaleY(-1);
      }
      .selected-item {
        text-overflow: ellipsis;
        overflow: hidden;
        white-space: nowrap;
      }
      .realm-dropdown-menu {
        --boxel-menu-item-content-padding: var(--boxel-sp-xxs)
          var(--boxel-sp-xxs) var(--boxel-sp-xxs) var(--boxel-sp-xxxs);
        --boxel-menu-item-gap: var(--boxel-sp-4xs);
        width: var(--realm-dropdown-width, auto);
      }
    </style>
  </template>

  defaultRealmIcon = '/default-realm-icon.png';
  @service declare realm: RealmService;

  get realms(): RealmDropdownItem[] {
    let items: RealmDropdownItem[] | [] = [];
    for (let [url, realmMeta] of Object.entries(this.realm.allRealmsInfo)) {
      if (!realmMeta.canWrite) {
        continue;
      }
      let item: RealmDropdownItem = {
        path: url,
        ...realmMeta.info,
        iconURL: realmMeta.info.iconURL ?? this.defaultRealmIcon,
      };
      items = [item, ...items];
    }
    items.sort((a, b) => a.name.localeCompare(b.name));
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
    let selectedRealm: RealmDropdownItem | undefined;
    if (this.args.selectedRealmURL) {
      selectedRealm = this.realms.find(
        (realm) =>
          realm.path === new RealmPaths(this.args.selectedRealmURL!).url,
      );
    }
    if (selectedRealm) {
      return selectedRealm;
    }

    let defaultWritableRealm = this.realm.defaultWritableRealm;

    if (!defaultWritableRealm) {
      return undefined;
    }

    return this.realms.find(
      (realm) => realm.path === defaultWritableRealm!.path,
    );
  }
}
