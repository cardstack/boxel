import type { TemplateOnlyComponent } from '@ember/component/template-only';
import cn from '@cardstack/boxel-ui/helpers/cn';
import { eq } from '@cardstack/boxel-ui/helpers/truth-helpers';
import { svgJar } from '@cardstack/boxel-ui/helpers/svg-jar';
import BoxelInputValidationState, {
  InputValidationState,
} from '@cardstack/boxel-ui/components/input/validation-state';
import cssVar from '@cardstack/boxel-ui/helpers/css-var';

export enum SearchInputBottomTreatment {
  Flat = 'flat',
  Rounded = 'rounded',
}

interface Signature {
  Element: HTMLElement;
  Args: {
    value: string;
    bottomTreatment?: SearchInputBottomTreatment;
    state?: InputValidationState;
    errorMessage?: string;
    placeholder?: string;
    onFocus?: (ev: Event) => void;
    onInput?: (val: string) => void;
    onKeyPress?: (ev: KeyboardEvent) => void;
  };
}

const SearchInput: TemplateOnlyComponent<Signature> = <template>
  <div
    class={{cn
      'search-input'
      search-input--bottom-flat=(eq @bottomTreatment 'flat')
    }}
    data-test-search-input
    ...attributes
  >
    <label>
      <span class='boxel-sr-only'>Search</span>
      <BoxelInputValidationState
        @value={{@value}}
        @onInput={{@onInput}}
        @onKeyPress={{@onKeyPress}}
        @onFocus={{@onFocus}}
        @state={{if @state @state 'initial'}}
        @errorMessage={{@errorMessage}}
        @placeholder={{if @placeholder @placeholder 'Search'}}
        style={{cssVar input-font-size='var(--search-font-size)'}}
      />
      <span class='search-input-icon'>
        {{svgJar 'icon-search' width='20' height='20'}}
      </span>
    </label>
  </div>
  <style>
    .search-input {
      --search-icon-width: var(--boxel-sp-xxl);
      --search-input-height: var(--boxel-sp-xxxl);
      position: relative;
      width: 100%;
      font: var(--boxel-font);
    }
    label {
      height: var(--search-input-height);
      position: relative;
      display: block;
    }
    .search-input-icon {
      --icon-color: var(--boxel-highlight);
      position: absolute;
      top: 0;
      bottom: 0;
      right: 0;
      width: var(--search-icon-width);
      display: flex;
      justify-content: center;
      align-items: center;
    }
    :global(.search-input .boxel-input) {
      --input-height: var(--search-input-height);
      --boxel-form-control-border-color: var(--boxel-dark);
      --boxel-form-control-border-radius: var(--boxel-border-radius-xl);

      padding-left: var(--boxel-sp);
      background-color: var(--boxel-dark);
      color: var(--boxel-light);
      font: var(--boxel-font);
      letter-spacing: var(--boxel-lsp-xs);
    }
    :global(.search-input--bottom-flat .boxel-input) {
      --boxel-form-control-border-radius: var(--boxel-border-radius-xl)
        var(--boxel-border-radius-xl) 0 0;
    }
  </style>
</template>;

export default SearchInput;
