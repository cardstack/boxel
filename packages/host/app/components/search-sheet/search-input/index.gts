import Component from '@glimmer/component';
import cn from '@cardstack/boxel-ui/helpers/cn';
import { eq } from '@cardstack/boxel-ui/helpers/truth-helpers';
import { svgJar } from '@cardstack/boxel-ui/helpers/svg-jar';
import BoxelInputValidationState, {
  InputValidationState,
} from '@cardstack/boxel-ui/components/input/validation-state';

export enum SearchInputBottomTreatment {
  Flat = 'flat',
  Rounded = 'rounded',
}

interface Signature {
  Element: HTMLElement;
  Args: {
    value: string;
    bottomTreatment?: SearchInputBottomTreatment;
    iconPosition?: 'start' | 'end';
    state?: InputValidationState;
    errorMessage?: string;
    placeholder?: string;
    onFocus?: (ev: Event) => void;
    onInput?: (val: string) => void;
    onKeyPress?: (ev: KeyboardEvent) => void;
  };
  Blocks: {};
}

export default class SearchInput extends Component<Signature> {
  <template>
    <div class='searchbox'>
      <label>
        <span class='boxel-sr-only'>Search</span>
        <BoxelInputValidationState
          class={{cn
            'searchbox-input'
            searchbox-input--bottom-flat=(eq @bottomTreatment 'flat')
          }}
          @value={{@value}}
          @onInput={{@onInput}}
          @onKeyPress={{@onKeyPress}}
          @onFocus={{@onFocus}}
          @state={{if @state @state 'initial'}}
          @errorMessage={{@errorMessage}}
          @placeholder={{if @placeholder @placeholder 'Search'}}
          data-test-search-input
        />
      </label>
      <span
        class={{cn
          'searchbox-icon'
          searchbox-icon--start=(eq @iconPosition 'start')
        }}
      >
        {{svgJar 'icon-search' width='20' height='20'}}
      </span>
    </div>
    <style>
      .searchbox {
        --search-icon-width: var(--boxel-sp-xxl);
        position: relative;
        width: 100%;
        font: var(--boxel-font);
      }
      .searchbox-icon {
        --icon-color: var(--boxel-highlight);
        position: absolute;
        top: 0;
        right: 0;
        height: 100%;
        width: var(--search-icon-width);
        display: flex;
        justify-content: center;
        align-items: center;
      }
      .searchbox-icon--start {
        left: 0;
        right: auto;
      }
      :global(.searchbox-input .boxel-input) {
        --input-height: 3.75rem;
        --boxel-input-padding: var(--boxel-sp) var(--search-icon-width);
        --boxel-form-control-border-color: var(--boxel-dark);
        --boxel-form-control-border-radius: var(--boxel-border-radius-xl);

        background-color: var(--boxel-dark);
        color: var(--boxel-light);
        font: var(--boxel-font);
        letter-spacing: var(--boxel-lsp-xs);
      }
      :global(.searchbox-input--bottom-flat .boxel-input) {
        --boxel-form-control-border-radius: var(--boxel-border-radius-xl)
          var(--boxel-border-radius-xl) 0 0;
      }
      :global(.searchbox .boxel-input::placeholder) {
        color: var(--boxel-light);
        opacity: 0.6;
      }

    </style>
  </template>
}
