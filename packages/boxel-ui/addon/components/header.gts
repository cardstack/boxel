import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { initStyleSheet, attachStyles } from '../attach-styles';
import cn from '../helpers/cn';
import { eq } from '../helpers/truth-helpers';

interface Signature {
  Element: HTMLElement;
  Args: {
    label?: string;
    noBackground?: boolean;
    isHighlighted?: boolean;
    size?: 'medium' | 'large';
  };
  Blocks: {
    default: [],
    actions: [],
  }
}

let styles = initStyleSheet(`
  .boxel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 var(--boxel-sp-xxxs) 0 var(--boxel-sp-sm);
    min-height: var(--boxel-header-min-height, 1.875rem); /* 30px */
    background-color: var(--boxel-header-background-color, var(--boxel-100));
    color: var(--boxel-header-text-color, var(--boxel-dark));
    border-top-right-radius: calc(var(--boxel-border-radius) - 1px);
    border-top-left-radius: calc(var(--boxel-border-radius) - 1px);
    font: 600 var(--boxel-font-xs);
    letter-spacing: var(--boxel-lsp-xl);
    text-transform: uppercase;
    transition:
      background-color var(--boxel-transition),
      color var(--boxel-transition);
  }
  .boxel-header--large {
    padding: var(--boxel-sp-xl);
    font: 700 var(--boxel-font-lg);
    letter-spacing: normal;
    text-transform: none;
  }
  .boxel-header--medium {
    padding: 0;
    margin-bottom: var(--boxel-sp);
    font: 700 var(--boxel-font);
    letter-spacing: normal;
    text-transform: none;
  }
  .boxel-header--no-background {
    background-color: transparent;
  }
  .boxel-header--highlighted {
    background-color: var(--boxel-highlight);
  }
  .boxel-header__content {
    display: flex;
    align-items: center;
  }
  .boxel-header__content button {
    --boxel-icon-button-width: var(--boxel-header-min-height, 1.875rem);
    --boxel-icon-button-height: var(--boxel-header-min-height, 1.875rem);

    min-height: var(--boxel-icon-button-height);
    padding: 0 var(--boxel-sp-xxxs);
    background: none;
    border: none;
    font: inherit;
    letter-spacing: inherit;
    text-transform: inherit;
  }
`);

const Header: TemplateOnlyComponent<Signature> = <template>
  <header
    class={{cn
      "boxel-header"
      boxel-header--no-background=@noBackground
      boxel-header--highlighted=@isHighlighted
      boxel-header--large=(eq @size "large")
      boxel-header--medium=(eq @size "medium")
    }}
    {{attachStyles styles}}
    data-test-boxel-header
    ...attributes
  >
    {{#if @label}}
      <span data-test-boxel-header-label>
        {{@label}}
      </span>
    {{/if}}

    {{yield}}

    {{#if (has-block "actions")}}
      <div class="boxel-header__content" data-test-boxel-header-content>
        {{yield to="actions"}}
      </div>
    {{/if}}
  </header>
</template>

export default Header;
