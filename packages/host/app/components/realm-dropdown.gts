import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { cancel, later } from '@ember/runloop';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { modifier } from 'ember-modifier';
import { trackedFunction } from 'reactiveweb/function';

import {
  BoxelDropdown,
  BoxelInput,
  Button,
  Menu,
  RealmIcon,
} from '@cardstack/boxel-ui/components';
import { MenuItem, and, not } from '@cardstack/boxel-ui/helpers';
import { DropdownArrowDown } from '@cardstack/boxel-ui/icons';

import { RealmPaths, ri } from '@cardstack/runtime-common';

import type { EnhancedRealmInfo } from '@cardstack/host/services/realm';

import type RealmService from '../services/realm';

export interface RealmDropdownItem extends EnhancedRealmInfo {
  path: string;
  canWrite?: boolean;
}

interface Signature {
  Args: {
    onSelect: (item: RealmDropdownItem) => void;
    selectedRealmURL: string | undefined;
    disabled?: boolean;
    contentClass?: string;
    selectedRealmPrefix?: string;
    displayReadOnlyTag?: boolean;
    // Shows a text input above the realm list that filters it by name
    searchable?: boolean;
  };
  Element: HTMLElement;
}

// BoxelDropdown's focus trap moves focus to its trigger on a zero-delay timer
// once the content renders, so focusing the input synchronously is undone.
// Queue the focus behind the trap's timer instead.
const focusAfterDropdownOpens = modifier((element: HTMLElement) => {
  let timer = later(() => element.focus(), 0);
  return () => cancel(timer);
});

export default class RealmDropdown extends Component<Signature> {
  <template>
    <BoxelDropdown
      @contentClass={{@contentClass}}
      @matchTriggerWidth={{true}}
      @onClose={{this.clearSearch}}
      data-test-load-realms-loaded='true'
    >
      <:trigger as |bindings|>
        <Button
          class='realm-dropdown-trigger'
          @kind='secondary-light'
          @size='small'
          @disabled={{@disabled}}
          {{bindings}}
          data-realm-dropdown-trigger
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
        {{#if @searchable}}
          <div class='realm-dropdown-search'>
            <BoxelInput
              class='realm-dropdown-search-input'
              @type='search'
              @value={{this.searchTerm}}
              @onInput={{this.updateSearchTerm}}
              @placeholder='Search workspaces'
              @autocomplete='off'
              aria-label='Search workspaces'
              data-test-realm-dropdown-search
              {{focusAfterDropdownOpens}}
              {{on 'keydown' (fn this.selectFirstMatchOnEnter dd.close)}}
            />
          </div>
        {{/if}}
        {{#if this.hasNoSearchMatches}}
          <p
            class='realm-dropdown-no-results'
            data-test-realm-dropdown-no-results
          >
            No workspaces match “{{this.searchTerm}}”
          </p>
        {{else}}
          <Menu
            class='realm-dropdown-menu'
            @items={{this.menuItems}}
            @closeMenu={{dd.close}}
            data-test-realm-dropdown-menu
          />
        {{/if}}
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
      .realm-dropdown-search {
        --boxel-input-search-background-color: transparent;
        --boxel-input-search-color: var(--boxel-dark);
        padding: var(--boxel-sp-xxs);
        border-bottom: 1px solid var(--boxel-200);
      }
      .realm-dropdown-search-input {
        width: 100%;
      }
      .realm-dropdown-no-results {
        margin: 0;
        padding: var(--boxel-sp-xs);
        min-width: 13rem;
        font: var(--boxel-font-sm);
        color: var(--boxel-450);
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
  @tracked searchTerm = '';

  @action updateSearchTerm(term: string) {
    this.searchTerm = term;
  }

  @action clearSearch() {
    this.searchTerm = '';
  }

  @action selectFirstMatchOnEnter(close: () => void, event: KeyboardEvent) {
    if (event.key !== 'Enter') {
      return;
    }
    let [firstMatch] = this.filteredRealms;
    if (firstMatch) {
      event.preventDefault();
      this.args.onSelect(firstMatch);
      close();
    }
  }

  get selectedItemText() {
    if (!this.selectedRealm) {
      return '';
    }
    if (this.args.selectedRealmPrefix) {
      return `${this.args.selectedRealmPrefix} ${this.selectedRealm.name}`;
    }
    return this.selectedRealm.name;
  }

  allRealmsInfo = trackedFunction(this, async () => {
    if (this.args.selectedRealmURL) {
      await this.realm.ensureRealmMeta(this.args.selectedRealmURL);
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

  get filteredRealms(): RealmDropdownItem[] {
    let term = this.searchTerm.trim().toLowerCase();
    if (!this.args.searchable || !term) {
      return this.realms;
    }
    return this.realms.filter((realm) =>
      realm.name.toLowerCase().includes(term),
    );
  }

  get hasNoSearchMatches(): boolean {
    return (
      Boolean(this.args.searchable && this.searchTerm.trim()) &&
      this.filteredRealms.length === 0
    );
  }

  get menuItems(): MenuItem[] {
    return this.filteredRealms.map(
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
    // Until the realm list has loaded there is nothing to select, and the
    // defaultWritableRealm fallback below reaches into the matrix client —
    // which throws if it's consulted before the matrix SDK is ready (e.g. while
    // this dropdown renders during app boot). The fallback would resolve to
    // undefined against an empty list anyway, so short-circuit.
    if (this.realms.length === 0) {
      return undefined;
    }
    let selectedRealm: RealmDropdownItem | undefined;
    if (this.args.selectedRealmURL) {
      selectedRealm = this.realms.find(
        (realm) =>
          realm.path === new RealmPaths(ri(this.args.selectedRealmURL!)).url,
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
