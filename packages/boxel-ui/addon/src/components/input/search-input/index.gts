import type { TemplateOnlyComponent } from '@ember/component/template-only';
import cn from '../../../helpers/cn.ts';
import { eq } from '../../../helpers/truth-helpers.ts';
import { svgJar } from '../../../helpers/svg-jar.ts';
import BoxelInputValidationState from '../validation-state/index.gts';
import type { InputValidationState } from '../validation-state/index.gts';
import BoxelInput from '../index.gts';

export enum SearchInputBottomTreatment {
  Flat = 'flat',
  Rounded = 'rounded',
}

interface Signature {
  Element: HTMLElement;
  Args: {
    hasValidation?: boolean;
    variant?: 'large' | 'default';
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
  <label class='search-input-container' data-test-search-input ...attributes>
    <span class='boxel-sr-only'>Search</span>
    {{#if @hasValidation}}
      <BoxelInputValidationState
        class={{cn
          'search-input'
          search-input--bottom-flat=(eq @bottomTreatment 'flat')
          search-input--large=(eq @variant 'large')
        }}
        @value={{@value}}
        @onInput={{@onInput}}
        @onKeyPress={{@onKeyPress}}
        @onFocus={{@onFocus}}
        @state={{if @state @state 'initial'}}
        @errorMessage={{@errorMessage}}
        @placeholder={{if @placeholder @placeholder 'Search'}}
      />
    {{else}}
      <BoxelInput
        class={{cn
          'search-input'
          search-input--large=(eq @variant 'large')
          search-input--bottom-flat=(eq @bottomTreatment 'flat')
        }}
        @value={{@value}}
        @onInput={{@onInput}}
        @onKeyPress={{@onKeyPress}}
        @onFocus={{@onFocus}}
        @placeholder={{if @placeholder @placeholder 'Search'}}
      />
    {{/if}}
    <span class='search-icon-container'>
      {{svgJar 'icon-search' width='20' height='20'}}
    </span>
  </label>

  <style>
    .search-input-container {
      --search-icon-container-size: var(--boxel-icon-lg);
      position: relative;
      display: block;
      width: 100%;
      font: var(--boxel-font);
    }
    .search-input {
      --boxel-form-control-border-color: var(--boxel-dark);
      --boxel-form-control-border-radius: var(--boxel-border-radius-xl);

      padding-right: var(--search-icon-container-size);
      padding-top: var(--boxel-sp-xxs);
      padding-bottom: var(--boxel-sp-xxs);
      background-color: var(--boxel-dark);
      color: var(--boxel-light);
    }
    .search-input--large {
      --boxel-form-control-height: 4.375rem;

      font: var(--boxel-font);
      letter-spacing: var(--boxel-lsp-xs);
    }
    .search-input--bottom-flat {
      --boxel-form-control-border-radius: var(--boxel-border-radius-xl)
        var(--boxel-border-radius-xl) 0 0;
    }
    .search-input:focus-visible {
      outline: 2px solid var(--boxel-highlight);
    }
    .search-icon-container {
      --icon-color: var(--boxel-highlight);
      position: absolute;
      top: 0;
      bottom: 0;
      right: 0;
      width: var(--search-icon-container-size);
      height: 100%;
      display: flex;
      justify-content: center;
      align-items: center;
    }
  </style>
</template>;

export default SearchInput;
