import Component from '@glimmer/component';
import { debounce } from 'lodash';
import { action } from '@ember/object';
import { on } from '@ember/modifier';

import { BoxelInput } from '@cardstack/boxel-ui/components';

interface Signature {
  Element: HTMLElement;
  Args: {
    value: string;
    placeholder: string;
    setSearchKey: (searchKey: string) => void;
  };
  Blocks: {};
}
export class SearchInput extends Component<Signature> {
  private resetState() {
    this.args.setSearchKey('');
  }

  @action
  private onCancel() {
    this.resetState();
  }

  private debouncedSetSearchKey = debounce((searchKey: string) => {
    this.args.setSearchKey(searchKey);
  }, 300);

  @action private onInput(searchKey: string) {
    this.debouncedSetSearchKey(searchKey);
  }

  @action private onSearchInputKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      this.onCancel();
      (e.target as HTMLInputElement)?.blur?.();
    }
  }

  <template>
    <BoxelInput
      @type='search'
      @value={{@value}}
      @placeholder={{@placeholder}}
      @onInput={{this.onInput}}
      {{on 'keydown' this.onSearchInputKeyDown}}
      autocomplete='off'
      data-test-search-field
      ...attributes
    />
  </template>
}
