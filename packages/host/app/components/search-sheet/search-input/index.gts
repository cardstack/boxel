import Component from '@glimmer/component';
import optional from '@cardstack/boxel-ui/helpers/optional';
import pick from '@cardstack/boxel-ui/helpers/pick';
import { svgJar } from '@cardstack/boxel-ui/helpers/svg-jar';
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
      <label class='label'>
        <span class='icon-label'>
          {{svgJar 'icon-search' width='20' height='20' class='search-icon'}}
        </span>
        <span class='sr-label'>Search</span>
        <input
          class='input'
          placeholder='Enter search term or type a command'
          value={{@value}}
          {{on 'focus' (optional @onFocus)}}
          {{on 'input' (pick 'target.value' (optional @onInput))}}
          data-test-search-input
        />
      </label>
    </div>
    <style>
      .search-input {
        transition: margin var(--boxel-transition);
      }

      .search-sheet .search-input {
        margin: 31px 0 20px;
      }

      .search-sheet.closed .search-input {
        margin: 0;
      }

      .search-input {
        border-radius: 20px 20px 0 0;
        border: solid 1px rgba(255, 255, 255, 0.5);
        background: #000;
        height: 59px;
        transition: border-radius var(--boxel-transition);
      }

      .search-input--bottom-rounded {
        border-radius: 20px;
      }

      .input {
        width: 100%;
        height: 23px;
        font-family: Poppins;
        font-size: 16px;
        font-weight: normal;
        font-stretch: normal;
        font-style: normal;
        line-height: 1.13;
        letter-spacing: 0.19px;
        text-align: left;
        color: #fff;
        background: transparent;
        border: none;
      }

      .label {
        padding: 18px 24px 18px 18px;
        display: flex;
      }

      .icon-label {
        --icon-color: var(--boxel-highlight);
        margin-right: var(--boxel-sp-xxs);
      }

      .sr-label {
        display: none;
      }

      .input::placeholder {
        color: #fff;
        opacity: 0.6;
      }

      .input:focus {
        outline: none;
      }

    </style>
  </template>
}
