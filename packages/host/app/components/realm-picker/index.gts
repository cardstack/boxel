import { service } from '@ember/service';
import Component from '@glimmer/component';
import { cached } from '@glimmer/tracking';

import { Picker, type PickerOption } from '@cardstack/boxel-ui/components';

import { ri, type RealmIdentifier } from '@cardstack/runtime-common';

import type RealmService from '@cardstack/host/services/realm';
import type RealmServerService from '@cardstack/host/services/realm-server';

import WithKnownRealmsLoaded from '../with-known-realms-loaded';

export interface RealmFilter {
  selected: RealmIdentifier[];
  onChange: (selected: RealmIdentifier[]) => void;
  /** Resolved realm identifiers (handles select-all → all available realms) */
  selectedURLs: string[];
  /** When true, the realm scope is locked and the picker UI is disabled. */
  locked?: boolean;
}

interface Signature {
  Args: {
    filter: RealmFilter;
    label?: string;
    placeholder?: string;
    destination?: string;
  };
  Blocks: {};
}

export default class RealmPicker extends Component<Signature> {
  @service declare realm: RealmService;
  @service declare realmServer: RealmServerService;

  // Provide a default selection so Picker's ensureDefaultSelection() never
  // fires onChange to the parent. Without this, Picker sees an empty @selected
  // on first render and calls onChange([select-all]), which the parent
  // interprets as a user-initiated filter change (expanding the search sheet).
  @cached
  get selectAllOption(): PickerOption {
    const urls = this.realmServer.availableRealmIdentifiers;
    return {
      id: 'select-all',
      label: `Select All (${urls.length})`,
      shortLabel: `All`,
      type: 'select-all',
    };
  }

  private get pickerSelected(): PickerOption[] {
    const selected = this.args.filter.selected;
    if (selected.length === 0) {
      return [this.selectAllOption];
    }
    return selected.map((realmIdentifier) => {
      let info = this.realm.info(realmIdentifier);
      let label = info?.name ?? this.realmDisplayName(realmIdentifier);
      let icon = info?.iconURL ?? undefined;
      return { id: realmIdentifier, icon, label, type: 'option' as const };
    });
  }

  get realmOptions(): PickerOption[] {
    const identifiers = this.realmServer.availableRealmIdentifiers;
    const options: PickerOption[] = [this.selectAllOption];
    for (const realmIdentifier of identifiers) {
      const info = this.realm.info(realmIdentifier);
      const label = info?.name ?? this.realmDisplayName(realmIdentifier);
      const icon = info?.iconURL ?? undefined;
      options.push({
        id: realmIdentifier,
        icon,
        label,
        type: 'option',
      });
    }
    return options;
  }

  private onChange = (selected: PickerOption[]) => {
    const identifiers = selected
      .filter((opt) => opt.type !== 'select-all')
      .map((opt) => ri(opt.id));
    this.args.filter.onChange(identifiers);
  };

  // Fallback label when the realm's info hasn't loaded: its last path segment.
  // A realm identifier may be canonical rather than a URL, so take the segment
  // by splitting rather than by parsing a URL, which the canonical form rejects.
  private realmDisplayName(realmIdentifier: string): string {
    const segments = realmIdentifier
      .replace(/^[a-z]+:\/\//i, '')
      .split('/')
      .filter(Boolean);
    if (segments.length <= 1) {
      return 'Base';
    }
    return segments[segments.length - 1] ?? 'Base';
  }

  <template>
    <WithKnownRealmsLoaded>
      <:default>
        <Picker
          @label={{if @label @label 'Realm'}}
          @options={{this.realmOptions}}
          @selected={{this.pickerSelected}}
          @onChange={{this.onChange}}
          @placeholder={{@placeholder}}
          @searchPlaceholder='Search for a realm'
          @maxSelectedDisplay={{3}}
          @renderInPlace={{false}}
          @destination={{@destination}}
          @matchTriggerWidth={{false}}
          @disabled={{@filter.locked}}
          data-test-realm-picker
        />
      </:default>
      <:loading>
        <div
          class='realm-picker loading'
          aria-label='Realm'
          data-test-realm-picker
          data-test-realm-picker-loading
        >
          <span class='loading-label'>Realm</span>
          <span class='loading-value'>Loading…</span>
        </div>
      </:loading>
    </WithKnownRealmsLoaded>
    <style scoped>
      .loading {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        padding: 0 var(--boxel-sp-sm);
        color: var(--boxel-450);
        font-size: var(--boxel-font-size-sm);
      }
      .loading-label {
        font-weight: 500;
      }
    </style>
  </template>
}
