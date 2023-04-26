import Component from '@glimmer/component';
import optional from '@cardstack/boxel-ui/helpers/optional';
import pick from '@cardstack/boxel-ui/helpers/pick';
import { on } from '@ember/modifier';

export enum SearchInputBottomTreatment {
  Flat = 'flat',
  Rounded = 'rounded',
}

interface Signature {
  Element: HTMLElement;
  Args: {
    bottomTreatment: SearchInputBottomTreatment;
    value: string;
    onFocus?: () => void;
    onInput?: (val: string) => void;
  };
  Blocks: {};
}

export default class SearchInput extends Component<Signature> {
  <template>
    <div class='search-input search-input--bottom-{{@bottomTreatment}}'>
      <label class='search-input__label'>
        <span class='search-input__icon-label'>&#8981;</span>
        <span class='search-input__sr-label'>Search</span>
        <input
          class='search-input__input'
          placeholder='Enter search term or type a command'
          value={{@value}}
          {{on 'focus' (optional @onFocus)}}
          {{on 'input' (pick 'target.value' (optional @onInput))}}
        />
      </label>
    </div>
  </template>
}
