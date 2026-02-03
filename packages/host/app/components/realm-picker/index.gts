import { service } from '@ember/service';
import Component from '@glimmer/component';

import { Picker, type PickerOption } from '@cardstack/boxel-ui/components';

import type RealmService from '@cardstack/host/services/realm';
import type RealmServerService from '@cardstack/host/services/realm-server';

import WithKnownRealmsLoaded from '../with-known-realms-loaded';

const SELECT_ALL_OPTION: PickerOption = {
  id: 'select-all',
  name: 'All Realms',
  type: 'select-all',
};

interface Signature {
  Args: {
    selected: PickerOption[];
    onChange: (selected: PickerOption[]) => void;
    label?: string;
    placeholder?: string;
  };
  Blocks: {};
}

export default class RealmPicker extends Component<Signature> {
  @service declare realm: RealmService;
  @service declare realmServer: RealmServerService;

  get realmOptions(): PickerOption[] {
    const urls = this.realmServer.availableRealmURLs;
    const options: PickerOption[] = [SELECT_ALL_OPTION];
    for (const realmURL of urls) {
      const info = this.realm.info(realmURL);
      const name = info?.name ?? this.realmDisplayNameFromURL(realmURL);
      const icon = info?.iconURL ?? undefined;
      options.push({
        id: realmURL,
        icon,
        name,
        type: 'option',
      });
    }
    console.log(options);
    return options;
  }

  private realmDisplayNameFromURL(realmURL: string): string {
    try {
      const pathname = new URL(realmURL).pathname;
      const segments = pathname.split('/').filter(Boolean);
      if (segments.length === 0) {
        return 'Base';
      }
      return segments[segments.length - 1] ?? 'Base';
    } catch {
      return 'Unknown Workspace';
    }
  }

  <template>
    <WithKnownRealmsLoaded>
      <:default>
        <Picker
          @label={{if @label @label 'Realm'}}
          @options={{this.realmOptions}}
          @selected={{@selected}}
          @onChange={{@onChange}}
          @placeholder={{@placeholder}}
          data-test-realm-picker
        />
      </:default>
      <:loading>
        <div
          class='realm-picker realm-picker--loading'
          aria-label='Realm'
          data-test-realm-picker
          data-test-realm-picker-loading
        >
          <span class='realm-picker__loading-label'>Realm</span>
          <span class='realm-picker__loading-value'>Loading…</span>
        </div>
      </:loading>
    </WithKnownRealmsLoaded>
    <style scoped>
      .realm-picker--loading {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        padding: 0 var(--boxel-sp-sm);
        color: var(--boxel-450);
        font-size: var(--boxel-font-size-sm);
      }
      .realm-picker__loading-label {
        font-weight: 500;
      }
    </style>
  </template>
}
