import { Component } from './card-api';
import StringField from './string';
import {
  BoxelDropdown,
  BoxelInput,
  Button,
  Menu,
  RealmIcon,
} from '@cardstack/boxel-ui/components';
import { not, MenuItem } from '@cardstack/boxel-ui/helpers';
import { DropdownArrowDown } from '@cardstack/boxel-ui/icons';
import { action } from '@ember/object';
import { commandData } from './resources/command-data';
import type { GetAllRealmMetasResult } from './command';
import GetAllRealmMetasCommand from '@cardstack/boxel-host/commands/get-all-realm-metas';

type RealmMeta = {
  url: string;
  canWrite: boolean;
  info: {
    name?: string;
    iconURL?: string;
  };
};

class EditComponent extends Component<typeof RealmField> {
  allRealmsInfoResource = commandData<typeof GetAllRealmMetasResult>(
    this,
    GetAllRealmMetasCommand,
  );

  get writableRealms(): RealmMeta[] {
    let resource = this.allRealmsInfoResource;
    if (!resource || !resource.isSuccess || !resource.value) {
      return [];
    }
    let results = (resource.value.results ?? []) as RealmMeta[];
    return results.filter((realm) => realm.canWrite);
  }

  get selectedRealm(): RealmMeta | undefined {
    if (!this.args.model) {
      return undefined;
    }
    return this.writableRealms.find((realm) => realm.url === this.args.model);
  }

  get selectedRealmLabel(): string {
    return this.selectedRealm?.info.name ?? 'Select a realm';
  }

  get menuItems(): MenuItem[] {
    return this.writableRealms.map(
      (realm) =>
        new MenuItem({
          label: realm.info.name ?? realm.url,
          action: () => this.selectRealm(realm),
          checked: realm.url === this.args.model,
          iconURL: realm.info.iconURL ?? undefined,
        }),
    );
  }

  @action
  selectRealm(realm: RealmMeta) {
    this.args.set(realm.url);
  }

  <template>
    <div class='wrapper'>
      {{#if this.writableRealms.length}}
        <BoxelDropdown @matchTriggerWidth={{true}} @contentClass='menu'>
          <:trigger as |dd|>
            <Button
              class='trigger'
              @kind='secondary-light'
              @size='small'
              @disabled={{not @canEdit}}
              {{dd}}
              title={{this.selectedRealmLabel}}
            >
              {{#if this.selectedRealm}}
                <RealmIcon
                  class='icon'
                  @realmInfo={{this.selectedRealm.info}}
                />
              {{/if}}
              <span class='label'>
                {{this.selectedRealmLabel}}
              </span>
              <DropdownArrowDown class='arrow' width='13px' height='13px' />
            </Button>
          </:trigger>
          <:content as |dd|>
            <Menu
              @items={{this.menuItems}}
              @closeMenu={{dd.close}}
              class='menu-content'
            />
          </:content>
        </BoxelDropdown>
      {{else}}
        <div>No writable realms available.</div>
      {{/if}}

      <BoxelInput
        class='hidden-input'
        type='url'
        value={{@model}}
        @onInput={{@set}}
        @disabled={{not @canEdit}}
      />
    </div>

    <style scoped>
      .wrapper {
        display: grid;
        gap: var(--boxel-sp-xs);
      }

      .trigger {
        display: grid;
        grid-template-columns: auto 1fr auto;
        align-items: center;
        gap: var(--boxel-sp-xxs);
        width: 100%;
        max-width: 100%;
        padding: var(--boxel-sp-5xs) var(--boxel-sp-xxs);
      }

      .icon {
        border-radius: var(--boxel-border-radius-xs);
      }

      .label {
        text-align: left;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .arrow {
        margin-left: auto;
      }

      .menu {
        --boxel-menu-item-content-padding: var(--boxel-sp-xs);
        --boxel-menu-item-gap: var(--boxel-sp-xs);
        min-width: 13rem;
        max-height: 13rem;
        overflow-y: auto;
      }

      .menu-content :deep(.menu-item__icon-url) {
        border-radius: var(--boxel-border-radius-xs);
      }

      .hidden-input {
        display: none;
      }
    </style>
  </template>
}

export default class RealmField extends StringField {
  static displayName = 'Realm';
  static edit = EditComponent;
}
