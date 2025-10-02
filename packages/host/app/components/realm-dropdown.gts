import { service } from '@ember/service';
import Component from '@glimmer/component';

import { trackedFunction } from 'reactiveweb/function';

import {
  BoxelDropdown,
  Button,
  Menu,
  RealmIcon,
} from '@cardstack/boxel-ui/components';
import { MenuItem, and, not } from '@cardstack/boxel-ui/helpers';
import { DropdownArrowDown } from '@cardstack/boxel-ui/icons';

import { RealmPaths } from '@cardstack/runtime-common';

import { type EnhancedRealmInfo } from '@cardstack/host/services/realm';

import RealmService from '../services/realm';

export interface RealmDropdownItem extends EnhancedRealmInfo {
  path: string;
  canWrite?: boolean;
}

interface Signature {
  Args: {
    onSelect: (item: RealmDropdownItem) => void;
    selectedRealmURL: URL | undefined;
    disabled?: boolean;
    contentClass?: string;
    selectedRealmPrefix?: string;
    displayReadOnlyTag?: boolean;
  };
  Element: HTMLElement;
}

export default class RealmDropdown extends Component<Signature> {
  <template>
    <BoxelDropdown
      @contentClass={{@contentClass}}
      @matchTriggerWidth={{true}}
      data-test-load-realms-loaded='true'
    >
      <:trigger as |bindings|>
        <Button
          class='realm-dropdown-trigger'
          @kind='secondary-light'
          @size='small'
          @disabled={{@disabled}}
          {{bindings}}
          data-test-realm-dropdown-trigger
          data-test-realm-name={{this.selectedRealm.name}}
          title={{this.selectedItemText}}
          ...attributes
        >
          {{#if this.selectedRealm}}
            <RealmIcon class='icon' @realmInfo={{this.selectedRealm}} />
            <div class='selected-item' data-test-selected-realm>
              {{this.selectedItemText}}
            </div>
            {{#if (and @displayReadOnlyTag (not this.selectedRealm.canWrite))}}
              <span class='read-only-tag' data-test-realm-read-only>READ ONLY</span>
            {{/if}}
          {{else}}
            Select a workspace
          {{/if}}
          <DropdownArrowDown class='arrow-icon' width='13px' height='13px' />
        </Button>
      </:trigger>
      <:content as |dd|>
        <Menu
          class='realm-dropdown-menu'
          @items={{this.menuItems}}
          @closeMenu={{dd.close}}
          data-test-realm-dropdown-menu
        />
      </:content>
    </BoxelDropdown>
    <style scoped>
      .realm-dropdown-trigger {
        height: 37px;
        width: 100%;
        max-width: 100%;
        display: grid;
        grid-template-columns: auto 1fr auto auto;
        justify-items: flex-start;
        gap: var(--boxel-sp-xxs);
        padding: var(--boxel-sp-5xs) var(--boxel-sp-xxs);
        border-radius: var(--boxel-border-radius);
      }
      .realm-dropdown-trigger > * {
        flex-shrink: 0;
      }
      .arrow-icon {
        margin-left: auto;
      }
      .realm-dropdown-trigger[aria-expanded='true'] .arrow-icon {
        transform: scaleY(-1);
      }
      .selected-item {
        max-width: 100%;
        text-overflow: ellipsis;
        overflow: hidden;
        white-space: nowrap;
      }
      .read-only-tag {
        color: #777;
        font: 500 var(--boxel-font-xs);
        overflow: hidden;
        white-space: nowrap;
        margin-left: auto;
      }
      .realm-dropdown-menu {
        --boxel-menu-item-content-padding: var(--boxel-sp-xs);
        --boxel-menu-item-gap: var(--boxel-sp-xs);
        min-width: 13rem;
        max-height: 13rem;
        overflow-y: scroll;
      }
      .realm-dropdown-menu :deep(.menu-item__icon-url) {
        border-radius: var(--boxel-border-radius-xs);
      }
      .realm-dropdown-menu :deep(.menu-item .subtext) {
        margin-left: auto;
        font: 500 var(--boxel-font-xs);
        color: var(--boxel-secondary-text-color, #777);
        text-align: right;
      }
    </style>
  </template>

  defaultRealmIcon = '/default-realm-icon.png';
  @service declare realm: RealmService;

  get selectedItemText() {
    if (this.args.selectedRealmPrefix) {
      return `${this.args.selectedRealmPrefix} ${this.selectedRealm?.name}`;
    }
    return this.selectedRealm?.name;
  }

  allRealmsInfo = trackedFunction(this, async () => {
    if (this.args.selectedRealmURL) {
      await this.realm.ensureRealmMeta(this.args.selectedRealmURL.href);
    }
    return this.realm.allRealmsInfo;
  });

  get realms(): RealmDropdownItem[] {
    if (!this.allRealmsInfo.value) {
      return [];
    }
    let items: RealmDropdownItem[] | [] = [];
    for (let [url, realmMeta] of Object.entries(this.allRealmsInfo.value)) {
      // Skip read-only realms unless explicitly displaying read-only tags
      if (!realmMeta.canWrite && !this.args.displayReadOnlyTag) {
        continue;
      }
      let item: RealmDropdownItem = {
        path: url,
        ...realmMeta.info,
        iconURL: realmMeta.info.iconURL ?? this.defaultRealmIcon,
        canWrite: realmMeta.canWrite,
      };
      items = [item, ...items];
    }
    items.sort((a, b) => a.name.localeCompare(b.name));
    return items;
  }

  get menuItems(): MenuItem[] {
    return this.realms.map(
      (realm) =>
        new MenuItem({
          label: realm.name,
          action: () => this.args.onSelect(realm),
          checked: realm.name === this.selectedRealm?.name,
          iconURL: realm.iconURL ?? undefined,
          subtext: !realm.canWrite ? 'READ ONLY' : undefined,
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
