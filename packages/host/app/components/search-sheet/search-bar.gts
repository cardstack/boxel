import { on } from '@ember/modifier';
import { action } from '@ember/object';
import Component from '@glimmer/component';

import { modifier } from 'ember-modifier';

import {
  BoxelInput,
  type BoxelInputBottomTreatments,
} from '@cardstack/boxel-ui/components';
import type { PickerOption } from '@cardstack/boxel-ui/components';
import { IconSearch } from '@cardstack/boxel-ui/icons';

import RealmPicker from '@cardstack/host/components/realm-picker';

let elementCallback = modifier(
  (element, [callback]: [((element: HTMLElement) => void) | undefined]) => {
    if (callback) {
      callback(element as HTMLElement);
    }
  },
);

interface Signature {
  Element: HTMLElement;
  Args: {
    value: string;
    placeholder?: string;
    onInput?: (value: string) => void;
    onFocus?: (ev: Event) => void;
    onBlur?: (ev: Event) => void;
    onKeyDown?: (ev: KeyboardEvent) => void;
    onInputInsertion?: (element: HTMLElement) => void;
    selectedRealms: PickerOption[];
    onRealmChange: (selected: PickerOption[]) => void;
    bottomTreatment?: BoxelInputBottomTreatments;
    state?: 'none' | 'valid' | 'invalid' | 'loading' | 'initial';
    id?: string;
  };
  Blocks: {};
}

export default class SearchBar extends Component<Signature> {
  @action
  handleKeyDown(ev: KeyboardEvent): void {
    this.args.onKeyDown?.(ev);
  }

  <template>
    <div class='search-sheet__search-bar' data-test-search-sheet-search-bar>
      <div class='search-sheet__search-bar-icon' aria-hidden='true'>
        <IconSearch
          class='search-sheet__search-bar-search-icon'
          width='20'
          height='20'
        />
      </div>
      <div class='search-sheet__search-bar-picker'>
        <RealmPicker
          @selected={{@selectedRealms}}
          @onChange={{@onRealmChange}}
        />
      </div>
      <div class='search-sheet__search-bar-separator' aria-hidden='true'></div>
      {{! template-lint-disable no-invalid-interactive }}
      <div
        class='search-sheet__search-bar-input-wrap'
        {{on 'keydown' this.handleKeyDown}}
      >
        <BoxelInput
          class='search-sheet__search-bar-input'
          @type='text'
          @size='large'
          @bottomTreatment={{@bottomTreatment}}
          @value={{@value}}
          @state={{@state}}
          @placeholder={{@placeholder}}
          @onFocus={{@onFocus}}
          @onInput={{@onInput}}
          @onBlur={{@onBlur}}
          id={{@id}}
          {{elementCallback @onInputInsertion}}
          data-test-search-field
        />
      </div>
    </div>
    <style scoped>
      .search-sheet__search-bar {
        --search-bar-bg: var(
          --boxel-input-search-background-color,
          var(--foreground, var(--boxel-dark))
        );
        --search-bar-color: var(
          --boxel-input-search-color,
          var(--background, var(--boxel-light))
        );
        --search-bar-border-color: var(--border, var(--boxel-dark));
        --search-bar-separator-color: rgba(255, 255, 255, 0.25);

        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        flex-wrap: wrap;
        background-color: var(--search-bar-bg);
        color: var(--search-bar-color);
        border: 1px solid var(--search-bar-border-color);
        border-radius: var(
          --boxel-form-control-border-radius,
          var(--boxel-border-radius-xl)
        );
        outline: 1px solid transparent;
        transition:
          outline-color var(--boxel-transition),
          border-color var(--boxel-transition);
      }

      .search-sheet__search-bar:focus-within {
        outline: 2px solid var(--ring, var(--boxel-highlight));
        border-color: var(--ring, var(--boxel-highlight));
      }

      .search-sheet__search-bar:focus-within :deep(.boxel-input),
      .search-sheet__search-bar:focus-within .search-sheet__search-bar-input {
        outline: none;
      }

      .search-sheet__search-bar:focus-within :deep(.boxel-input:focus-visible) {
        outline: none;
        border-color: transparent;
      }

      .search-sheet__search-bar-icon {
        display: flex;
        align-items: center;
        justify-content: center;
        padding-left: var(--boxel-sp-sm);
        flex-shrink: 0;
      }

      .search-sheet__search-bar-search-icon {
        --icon-color: var(
          --boxel-input-search-icon-color,
          var(--boxel-highlight)
        );
        color: var(--icon-color);
      }

      .search-sheet__search-bar-picker {
        display: flex;
        align-items: center;
        flex-shrink: 0;
        min-width: 0;
        padding: var(--boxel-sp-xs);
      }

      .search-sheet__search-bar-picker :deep(.boxel-trigger) {
        border: none;
        color: var(--boxel-dark);
        padding: var(--boxel-sp-3xs);
      }

      .search-sheet__search-bar-separator {
        width: 1px;
        background-color: var(--search-bar-separator-color);
        flex-shrink: 0;
      }

      .search-sheet__search-bar-input-wrap {
        flex: 1;
        display: flex;
      }

      .search-sheet__search-bar-input-wrap :deep(.boxel-input) {
        border: none;
        border-radius: 0;
        background: transparent;
        color: inherit;
        border-left: none;
      }

      .search-sheet__search-bar-input-wrap :deep(.input-container) {
        border: none;
        border-radius: 0;
        background: transparent;
      }
    </style>
  </template>
}
